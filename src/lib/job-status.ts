import type { JobStatus } from "@prisma/client";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  ACTIVE: "Active",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

// The previous status is not stored, so Unarchive goes to Closed
// and Reopen is a separate, deliberate step.
export const JOB_STATUS_ACTIONS: Record<JobStatus, { label: string; to: JobStatus }[]> = {
  ACTIVE: [
    { label: "Close", to: "CLOSED" },
    { label: "Archive", to: "ARCHIVED" },
  ],
  CLOSED: [
    { label: "Reopen", to: "ACTIVE" },
    { label: "Archive", to: "ARCHIVED" },
  ],
  ARCHIVED: [{ label: "Unarchive", to: "CLOSED" }],
};
