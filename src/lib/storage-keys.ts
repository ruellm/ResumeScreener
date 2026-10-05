export const RESUMES_BUCKET = "resumes";
export const RESULTS_BUCKET = "results";

type KeyParts = { businessId: string; jobId: string; submissionId: string };

// The uploaded resume, in the resumes bucket.
export function resumeStorageKey({ businessId, jobId, submissionId }: KeyParts) {
  return `${businessId}/${jobId}/${submissionId}.pdf`;
}

// The generated result PDF, in the results bucket. One object per evaluation,
// so a re-evaluation never overwrites a file that may still be cached.
// Older results sit at {submissionId}.pdf and are found through resultPdfKey.
export function resultPdfStorageKey({
  businessId,
  jobId,
  submissionId,
  evaluationId,
}: KeyParts & { evaluationId: string }) {
  return `${businessId}/${jobId}/${submissionId}/${evaluationId}.pdf`;
}
