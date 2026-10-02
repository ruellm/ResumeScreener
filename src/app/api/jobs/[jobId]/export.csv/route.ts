import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env.server";
import {
  hadHiddenText,
  parseEvaluationResult,
  REJECTION_REASON,
  requiredSkillsMet,
} from "@/lib/evaluation-result";
import { requireJob } from "@/lib/job-access";
import { slugify } from "@/lib/slug";

const HEADER = [
  "Received",
  "Source",
  "File name",
  "Candidate name",
  "Email",
  "Phone",
  "Status",
  "Verdict",
  "Score",
  "Rejection reason",
  "Required skills met",
  "Manipulation attempt",
  "Hidden text removed",
  "Summary",
  "Error",
  "Result page",
];

const yesNo = (value: boolean) => (value ? "yes" : "no");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const { job } = await requireJob(jobId);

  const submissions = await db.submission.findMany({
    where: { jobId: job.id },
    orderBy: { receivedAt: "desc" },
    include: { evaluation: true },
  });

  const rows = submissions.map((submission) => {
    const { evaluation } = submission;
    const result = evaluation ? parseEvaluationResult(evaluation.resultJson) : null;
    return [
      submission.receivedAt.toISOString(),
      submission.source,
      submission.originalFilename,
      evaluation?.candidateName,
      evaluation?.candidateEmail,
      evaluation?.candidatePhone,
      submission.status,
      evaluation?.verdict,
      evaluation?.score,
      evaluation?.rejectedForManipulation ? REJECTION_REASON : "",
      result ? requiredSkillsMet(result) : "",
      result ? yesNo(result.manipulationAttempts.length > 0) : "",
      yesNo(hadHiddenText(submission.hiddenTextFlagsJson)),
      evaluation?.summary,
      submission.error,
      `${serverEnv.APP_BASE_URL}/app/jobs/${job.id}/results/${submission.id}`,
    ];
  });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(job.title) || "job"}-${date}.csv`;
  return new Response(toCsv([HEADER, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
