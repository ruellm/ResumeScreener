import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { removeResultPdf, storeResultPdf } from "@/lib/result-pdf/store";
import type { Claim, SubmissionRef } from "./claim";
import { log, MAX_ATTEMPTS, RETRY_BACKOFF_SECONDS, workerEnv, workerId } from "./config";
import { PermanentError } from "./errors";
import { evaluate, recordFailedUsage, type EvaluationOutcome } from "./stages/evaluate";
import { extract } from "./stages/extract";

class LeaseLostError extends Error {}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// The row must still be held by this worker on the same attempt. A worker
// whose lease expired and was claimed again, even by itself, writes nothing.
async function guardedUpdate(claim: Claim, data: Prisma.SubmissionUpdateManyMutationInput) {
  const { count } = await db.submission.updateMany({
    where: { id: claim.id, lockedBy: workerId, attempts: claim.attempts },
    data,
  });
  if (count === 0) throw new LeaseLostError();
}

// Same guard as guardedUpdate. The lease end is computed in SQL so every
// lease write uses the database clock, like the claim and the expiry check.
async function extendLease(claim: Claim, status?: "EVALUATING") {
  const setStatus = status
    ? Prisma.sql`status = ${status}::"SubmissionStatus",`
    : Prisma.empty;
  const count = await db.$executeRaw`
    UPDATE "Submission"
    SET ${setStatus}
        "lockedUntil" = now() + make_interval(secs => ${workerEnv.WORKER_LEASE_SECONDS}),
        "updatedAt" = now()
    WHERE id = ${claim.id}
      AND "lockedBy" = ${workerId}
      AND attempts = ${claim.attempts}`;
  if (count === 0) throw new LeaseLostError();
}

// Keeps the lease alive while a stage runs. Stops by itself once the lease
// is lost; the run then drops its result at its next write.
function startLeaseRenewal(claim: Claim) {
  const timer = setInterval(
    async () => {
      try {
        await extendLease(claim);
      } catch (error) {
        if (error instanceof LeaseLostError) clearInterval(timer);
        else log(`${claim.id} lease renewal error: ${describe(error)}`);
      }
    },
    (workerEnv.WORKER_LEASE_SECONDS * 1000) / 3,
  );
  return timer;
}

// Saves the result and marks the submission DONE together, under the same
// guard as every other write. A rerun replaces the earlier evaluation.
// Returns the key of the result PDF that belonged to the replaced evaluation.
async function complete(claim: Claim, outcome: EvaluationOutcome) {
  try {
    const previous = await db.evaluation.findUnique({
      where: { submissionId: claim.id },
      select: { resultPdfKey: true },
    });

    // A longer timeout than Prisma's 5 seconds. A slow database moment here
    // would otherwise throw away an evaluation that was already paid for.
    await db.$transaction(
      async (tx) => {
        const { count } = await tx.submission.updateMany({
          where: { id: claim.id, lockedBy: workerId, attempts: claim.attempts },
          data: {
            status: "DONE",
            completedAt: new Date(),
            error: null,
            lockedUntil: null,
            lockedBy: null,
          },
        });
        if (count === 0) throw new LeaseLostError();

        await tx.evaluation.deleteMany({ where: { submissionId: claim.id } });
        await tx.evaluation.create({ data: outcome.evaluation });
        await tx.usageRecord.create({ data: outcome.usage });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return previous?.resultPdfKey ?? null;
  } catch (error) {
    await recordFailedUsage(outcome.usage);
    throw error;
  }
}

// The result is already saved when this runs. A failure here only means
// there is no PDF yet, and the download route makes one on demand.
async function refreshResultPdf(submissionId: string, previousKey: string | null) {
  try {
    if (previousKey) await removeResultPdf(previousKey);
    await storeResultPdf(submissionId);
  } catch (error) {
    log(`${submissionId} result PDF not stored: ${describe(error)}`);
  }
}

export async function recordFailure(submission: SubmissionRef, error: string) {
  await logEvent({
    type: "submission.failed",
    message: "Submission failed",
    businessId: submission.businessId,
    jobId: submission.jobId,
    meta: { submissionId: submission.id, error },
  });
}

async function handleError(claim: Claim, submission: SubmissionRef, error: unknown) {
  const message = describe(error);
  const permanent = error instanceof PermanentError;
  const attempt = `attempt ${claim.attempts}/${MAX_ATTEMPTS}${permanent ? ", permanent" : ""}`;
  // The stored message is the readable one. The cause is only logged.
  const cause =
    error instanceof Error && error.cause
      ? ` [${describe(error.cause).slice(0, 300)}]`
      : "";

  if (!permanent && claim.attempts < MAX_ATTEMPTS) {
    const backoff = RETRY_BACKOFF_SECONDS[claim.attempts - 1];
    await guardedUpdate(claim, {
      status: "QUEUED",
      availableAt: new Date(Date.now() + backoff * 1000),
      error: message,
      lockedUntil: null,
      lockedBy: null,
    });
    log(`${claim.id} retry in ${backoff}s (${attempt}): ${message}${cause}`);
    return;
  }

  await guardedUpdate(claim, {
    status: "FAILED",
    completedAt: new Date(),
    error: message,
    lockedUntil: null,
    lockedBy: null,
  });
  await recordFailure(submission, message);
  log(`${claim.id} FAILED (${attempt}): ${message}${cause}`);
}

export async function processSubmission(claim: Claim) {
  const renewal = startLeaseRenewal(claim);
  try {
    const submission = await db.submission.findFirst({
      where: { id: claim.id, lockedBy: workerId, attempts: claim.attempts },
      select: {
        id: true,
        jobId: true,
        businessId: true,
        source: true,
        fileSizeBytes: true,
        storageKey: true,
      },
    });
    if (!submission) throw new LeaseLostError();

    try {
      const extraction = await extract(submission);
      await guardedUpdate(claim, extraction);

      await extendLease(claim, "EVALUATING");
      log(`${claim.id} EVALUATING (extracted as ${extraction.extractionMethod})`);

      const outcome = await evaluate(submission, extraction);
      const previousPdfKey = await complete(claim, outcome);
      log(`${claim.id} DONE (${outcome.evaluation.verdict}, score ${outcome.evaluation.score})`);
      await refreshResultPdf(claim.id, previousPdfKey);
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      await handleError(claim, submission, error);
    }
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
    log(`${claim.id} lease lost on attempt ${claim.attempts}, dropping`);
  } finally {
    clearInterval(renewal);
  }
}
