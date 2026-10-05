import type { Prisma } from "@prisma/client";
import type { SubmissionStatusRow } from "@/lib/uploads";

// One shape for the status route and the Evaluate tab's list.
export const statusRowSelect = {
  id: true,
  source: true,
  status: true,
  error: true,
  originalFilename: true,
  evaluation: {
    select: { candidateName: true, verdict: true, score: true, rejectedForManipulation: true },
  },
} satisfies Prisma.SubmissionSelect;

type SelectedSubmission = Prisma.SubmissionGetPayload<{ select: typeof statusRowSelect }>;

export function toStatusRow({ evaluation, ...submission }: SelectedSubmission): SubmissionStatusRow {
  return {
    ...submission,
    candidateName: evaluation?.candidateName ?? null,
    verdict: evaluation?.verdict ?? null,
    rejected: evaluation?.rejectedForManipulation ?? false,
    score: evaluation?.score ?? null,
  };
}
