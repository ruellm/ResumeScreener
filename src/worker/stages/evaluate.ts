import type { Prisma, Submission } from "@prisma/client";
import { db } from "@/lib/db";
import { buildJobBlock, orderedJobSkills } from "@/lib/job-block";
import { countEvaluationsThisMonth } from "@/lib/usage";
import { log } from "../config";
import { PermanentError } from "../errors";
import { newMeter, requestEvaluation, type Meter } from "../evaluation/evaluate";
import { applyGuards } from "../evaluation/guards";
import { buildUserContent, PROMPT_VERSION, type ResumeInput } from "../evaluation/prompt";
import { evaluationSchema } from "../evaluation/schema";
import { rasterizePdf } from "../extraction/rasterize";
import { downloadResume } from "../storage";
import type { Extraction } from "./extract";

type SubmissionForEvaluation = Pick<
  Submission,
  "id" | "jobId" | "businessId" | "source" | "fileSizeBytes" | "storageKey"
>;

// What the pipeline saves together with marking the submission DONE.
export type EvaluationOutcome = {
  evaluation: Prisma.EvaluationUncheckedCreateInput;
  usage: Prisma.UsageRecordCreateInput;
};

const CANDIDATE_FIELD_MAX_CHARS = 200;

async function checkMonthlyLimit(businessId: string, limit: number | null) {
  if (limit === null) return;
  const used = await countEvaluationsThisMonth(businessId);
  if (used >= limit) throw new PermanentError("Monthly evaluation limit reached.");
}

// Tokens were spent on a call whose result was not saved.
export async function recordFailedUsage(usage: Prisma.UsageRecordCreateInput) {
  try {
    await db.usageRecord.create({ data: { ...usage, succeeded: false, verdict: null } });
  } catch (error) {
    log(`usage record for a failed evaluation was not saved: ${String(error)}`);
  }
}

function usageData(
  submission: SubmissionForEvaluation,
  model: string,
  meter: Meter,
): Prisma.UsageRecordCreateInput {
  return {
    businessId: submission.businessId,
    jobId: submission.jobId,
    source: submission.source,
    model,
    inputTokens: meter.inputTokens,
    outputTokens: meter.outputTokens,
    cacheCreationTokens: meter.cacheCreationTokens,
    cacheReadTokens: meter.cacheReadTokens,
    durationMs: meter.durationMs,
    fileSizeBytes: submission.fileSizeBytes,
  };
}

export async function evaluate(
  submission: SubmissionForEvaluation,
  extraction: Extraction,
): Promise<EvaluationOutcome> {
  const [job, settings] = await Promise.all([
    db.job.findUniqueOrThrow({
      where: { id: submission.jobId },
      include: {
        skills: { include: { skill: { select: { name: true } } } },
        business: { select: { monthlyEvalLimit: true } },
      },
    }),
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { evalModel: true } }),
  ]);
  const model = settings.evalModel;

  await checkMonthlyLimit(submission.businessId, job.business.monthlyEvalLimit);

  const skills = orderedJobSkills(job);
  const jobBlock = buildJobBlock(job);

  const resume: ResumeInput =
    extraction.extractedText !== null
      ? { method: "TEXT", text: extraction.extractedText }
      : {
          method: "VISION",
          pages: await rasterizePdf(await downloadResume(submission.storageKey)),
        };

  const meter = newMeter();
  try {
    const output = await requestEvaluation(
      submission.id,
      model,
      buildUserContent(jobBlock, resume),
      evaluationSchema(skills),
      meter,
    );
    const { result, evidenceVerified, rejection } = applyGuards(
      output,
      resume.method === "TEXT" ? resume.text : null,
    );

    return {
      evaluation: {
        submissionId: submission.id,
        verdict: result.verdict,
        score: result.score,
        summary: result.summary,
        resultJson: result,
        manipulationAttemptsJson: result.manipulationAttempts,
        jobSnapshotJson: {
          jobId: job.id,
          updatedAt: job.updatedAt.toISOString(),
          title: job.title,
          block: jobBlock,
        },
        candidateName: result.candidate.name?.slice(0, CANDIDATE_FIELD_MAX_CHARS),
        candidateEmail: result.candidate.email?.slice(0, CANDIDATE_FIELD_MAX_CHARS),
        candidatePhone: result.candidate.phone?.slice(0, CANDIDATE_FIELD_MAX_CHARS),
        evidenceVerified,
        rejectedForManipulation: rejection !== null,
        preRejectionScore: rejection?.score,
        preRejectionVerdict: rejection?.verdict,
        model,
        promptVersion: PROMPT_VERSION,
        inputTokens: meter.inputTokens,
        outputTokens: meter.outputTokens,
        cacheCreationTokens: meter.cacheCreationTokens,
        cacheReadTokens: meter.cacheReadTokens,
        durationMs: meter.durationMs,
      },
      usage: { ...usageData(submission, model, meter), verdict: result.verdict },
    };
  } catch (error) {
    if (meter.calls > 0) await recordFailedUsage(usageData(submission, model, meter));
    throw error;
  }
}
