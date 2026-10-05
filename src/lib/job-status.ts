import type { JobStatus } from "@prisma/client";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  ACTIVE: "Active",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

export const JOB_STATUS_ACTIONS: Record<JobStatus, { label: string; to: JobStatus }[]> = {
  ACTIVE: [
    { label: "Close", to: "CLOSED" },
    { label: "Archive", to: "ARCHIVED" },
  ],
  CLOSED: [
    { label: "Reopen", to: "ACTIVE" },
    { label: "Archive", to: "ARCHIVED" },
  ],
  ARCHIVED: [{ label: "Unarchive", to: "ACTIVE" }],
};
