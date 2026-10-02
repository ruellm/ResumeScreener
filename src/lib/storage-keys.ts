export const RESUMES_BUCKET = "resumes";
export const RESULTS_BUCKET = "results";

type KeyParts = { businessId: string; jobId: string; submissionId: string };

// The uploaded resume, in the resumes bucket.
export function resumeStorageKey({ businessId, jobId, submissionId }: KeyParts) {
  return `${businessId}/${jobId}/${submissionId}.pdf`;
}

// The generated result PDF, in the results bucket.
export function resultPdfStorageKey({ businessId, jobId, submissionId }: KeyParts) {
  return `${businessId}/${jobId}/${submissionId}.pdf`;
}
