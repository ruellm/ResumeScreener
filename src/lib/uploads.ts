// Shared by the upload form and the server actions, so both apply the same rules.

export const MAX_FILES_PER_BATCH = 50;

export const JOB_CLOSED_MESSAGE = "This job is closed. Reopen it to evaluate resumes.";

export function fileError(name: string, size: number, maxFileSizeMb: number) {
  if (!name.toLowerCase().endsWith(".pdf")) return "Only PDF files are accepted.";
  if (size <= 0) return "The file is empty.";
  if (size > maxFileSizeMb * 1024 * 1024) {
    return `The file is larger than ${maxFileSizeMb} MB.`;
  }
  return null;
}

// One per file passed to prepareUploads, in the same order.
export type PreparedFile =
  | { status: "ready"; submissionId: string; path: string; token: string }
  | { status: "duplicate"; existingSubmissionId: string; existingDate: string }
  | { status: "error"; error: string };

export type ConfirmedUpload =
  | { submissionId: string; ok: true }
  | { submissionId: string; ok: false; error: string };

export const SUBMISSION_STATUS_LABELS = {
  RECEIVED: "Uploaded",
  QUEUED: "Queued",
  EXTRACTING: "Reading",
  EVALUATING: "Evaluating",
  DONE: "Done",
  FAILED: "Failed",
} as const;

export type SubmissionStatusRow = {
  id: string;
  status: "RECEIVED" | "QUEUED" | "EXTRACTING" | "EVALUATING" | "DONE" | "FAILED";
  error: string | null;
  originalFilename: string;
  candidateName: string | null;
  verdict: "PASS" | "MAYBE" | "FAIL" | null;
  // Failed for trying to instruct the screener.
  rejected: boolean;
  score: number | null;
};
