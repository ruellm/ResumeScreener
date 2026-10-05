// Stored on InboundEmail.reason and shown in the activity list.
export const REASONS = {
  invalidFrom: "Invalid From header",
  unverified: "Sender could not be verified",
  noJob: "No job code found",
  businessInactive: "Business inactive",
  notAllowed: "Sender not on the allowed list",
  jobClosed: "Job is not accepting resumes",
  noPdfs: "No PDF attachments found",
  noValidPdfs: "No valid PDF resumes",
  timedOut: "Processing timed out",
} as const;

export type SkippedFile = { filename: string; reason: string };
