import "server-only";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const JOB_ACTIVITY_ROWS = 20;

export type IntakeActivityRow = {
  id: string;
  received: string;
  source: "Email" | "Drive";
  // The sender of the email, or who put the file in the folder.
  from: string | null;
  files: string[];
  status: string;
  reason: string | null;
};

export const INTAKE_STATUS_LABELS: Record<string, string> = {
  processing: "Processing",
  accepted: "Accepted",
  rejected: "Rejected",
  skipped: "Skipped",
  ignored: "Ignored",
  error: "Error",
};

function skippedNames(json: unknown) {
  if (!Array.isArray(json)) return [];
  return json.flatMap((entry) => (typeof entry?.filename === "string" ? [entry.filename] : []));
}

// What came in for one job by email and through Drive, newest first. Mail
// that never matched a job is not here: it has no job to show under.
export async function jobIntakeActivity(jobId: string, businessId: string) {
  const [emails, driveItems] = await Promise.all([
    db.inboundEmail.findMany({
      where: { jobId, businessId },
      orderBy: { receivedAt: "desc" },
      take: JOB_ACTIVITY_ROWS,
    }),
    db.driveIntakeItem.findMany({
      where: { jobId, businessId },
      orderBy: { createdAt: "desc" },
      take: JOB_ACTIVITY_ROWS,
    }),
  ]);
  const accepted = await db.submission.findMany({
    where: { jobId, inboundEmailId: { in: emails.map((email) => email.id) } },
    orderBy: { createdAt: "asc" },
    select: { inboundEmailId: true, originalFilename: true },
  });

  const rows = [
    ...emails.map((email) => ({
      at: email.receivedAt,
      row: {
        id: email.id,
        received: formatDateTime(email.receivedAt),
        source: "Email",
        from: email.fromAddress,
        files: [
          ...accepted
            .filter((submission) => submission.inboundEmailId === email.id)
            .map((submission) => submission.originalFilename),
          ...skippedNames(email.skippedJson),
        ],
        status: INTAKE_STATUS_LABELS[email.status] ?? email.status,
        reason: email.reason,
      } satisfies IntakeActivityRow,
    })),
    ...driveItems.map((item) => ({
      at: item.createdAt,
      row: {
        id: item.id,
        received: formatDateTime(item.createdAt),
        source: "Drive",
        from: item.uploaderEmail,
        files: [item.fileName],
        status: INTAKE_STATUS_LABELS[item.status] ?? item.status,
        reason: item.reason,
      } satisfies IntakeActivityRow,
    })),
  ];

  return rows
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, JOB_ACTIVITY_ROWS)
    .map(({ row }) => row);
}
