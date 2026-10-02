"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { requireJob } from "@/lib/job-access";
import {
  RESULTS_BUCKET,
  RESUMES_BUCKET,
  resultPdfStorageKey,
  resumeStorageKey,
} from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { JOB_CLOSED_MESSAGE } from "@/lib/uploads";
import { monthlyLimitExceeded } from "@/lib/usage";

const submissionRefSchema = z.object({
  jobId: z.string().min(1),
  submissionId: z.string().min(1),
});

const STILL_RUNNING = "This resume is still being processed.";

export async function reevaluateSubmission(input: unknown): Promise<ActionResult> {
  await requireBusinessUser();

  const parsed = submissionRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { jobId, submissionId } = parsed.data;

  const { user, job } = await requireJob(jobId);
  const submission = await db.submission.findFirst({
    where: { id: submissionId, jobId: job.id },
    select: { id: true, status: true, storageKey: true },
  });
  if (!submission) notFound();

  if (job.status !== "ACTIVE") return { ok: false, error: JOB_CLOSED_MESSAGE };
  if (submission.status !== "DONE" && submission.status !== "FAILED") {
    return { ok: false, error: STILL_RUNNING };
  }

  const stored = submission.storageKey
    ? await supabaseAdmin.storage.from(RESUMES_BUCKET).exists(submission.storageKey)
    : null;
  if (!stored?.data) {
    return {
      ok: false,
      error: "The original file is no longer stored, so it cannot be evaluated again.",
    };
  }

  const over = await monthlyLimitExceeded(user.business, 1);
  if (over) {
    return {
      ok: false,
      error: `Evaluating again would exceed your monthly evaluation limit (used ${over.used} of ${over.limit}).`,
    };
  }

  // The existing evaluation stays until the worker saves the new one.
  const { count } = await db.submission.updateMany({
    where: { id: submission.id, status: { in: ["DONE", "FAILED"] } },
    data: {
      status: "QUEUED",
      availableAt: new Date(),
      attempts: 0,
      error: null,
      lockedUntil: null,
      lockedBy: null,
    },
  });
  if (count === 0) return { ok: false, error: STILL_RUNNING };

  await logEvent({
    type: "submission.reevaluated",
    message: "Submission queued for re-evaluation",
    businessId: job.businessId,
    jobId: job.id,
    meta: { actorId: user.id, submissionId: submission.id },
  });

  revalidatePath(`/app/jobs/${job.id}/results/${submission.id}`);
  return { ok: true };
}

export async function deleteSubmission(input: unknown): Promise<ActionResult> {
  await requireBusinessUser();

  const parsed = submissionRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { jobId, submissionId } = parsed.data;

  const { user, job } = await requireJob(jobId);
  const submission = await db.submission.findFirst({
    where: { id: submissionId, jobId: job.id },
    select: { id: true },
  });
  if (!submission) notFound();

  // The status check is part of the delete, so a worker that picks the row
  // up at the same moment is not cut off mid-way. The evaluation goes with
  // the row. Usage records are kept: the evaluation was still paid for.
  const { count } = await db.submission.deleteMany({
    where: { id: submission.id, status: { notIn: ["EXTRACTING", "EVALUATING"] } },
  });
  if (count === 0) {
    return {
      ok: false,
      error: "This resume is being processed. Delete it when it has finished.",
    };
  }

  const keyParts = { businessId: job.businessId, jobId: job.id, submissionId: submission.id };
  const [resume, result] = await Promise.all([
    supabaseAdmin.storage.from(RESUMES_BUCKET).remove([resumeStorageKey(keyParts)]),
    supabaseAdmin.storage.from(RESULTS_BUCKET).remove([resultPdfStorageKey(keyParts)]),
  ]);
  if (resume.error || result.error) {
    console.error("files of a deleted submission were not removed", resume.error, result.error);
  }

  await logEvent({
    type: "submission.deleted",
    message: "Submission deleted",
    businessId: job.businessId,
    jobId: job.id,
    meta: { actorId: user.id, submissionId: submission.id },
  });

  revalidatePath(`/app/jobs/${job.id}`);
  return { ok: true };
}
