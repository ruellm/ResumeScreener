import type { JobStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { JOB_STATUS_LABELS } from "@/lib/job-status";

const VARIANTS = {
  ACTIVE: "default",
  CLOSED: "secondary",
  ARCHIVED: "outline",
} as const;

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge variant={VARIANTS[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}
