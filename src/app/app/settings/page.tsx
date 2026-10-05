import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { folderUrl } from "@/lib/google/drive";
import { MAX_SENDERS } from "@/lib/senders";
import { GoogleDriveSection } from "./drive-activity";
import { EmailActivity } from "./email-activity";
import { SendersSection } from "./senders-section";

const RECENT_EMAILS = 20;
const RECENT_DRIVE_ITEMS = 20;

export default async function BusinessSettingsPage() {
  const user = await requireBusinessUser();

  const [senders, users, emails, driveItems, settings] = await Promise.all([
    db.allowedSender.findMany({
      where: { businessId: user.business.id },
      orderBy: { createdAt: "asc" },
    }),
    db.user.findMany({
      where: { businessId: user.business.id },
      select: { id: true, email: true },
    }),
    db.inboundEmail.findMany({
      where: { businessId: user.business.id },
      orderBy: { receivedAt: "desc" },
      take: RECENT_EMAILS,
    }),
    db.driveIntakeItem.findMany({
      where: { businessId: user.business.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_DRIVE_ITEMS,
    }),
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { driveIntakeEnabled: true } }),
  ]);
  const jobs = await db.job.findMany({
    where: { id: { in: driveItems.map((item) => item.jobId) }, businessId: user.business.id },
    select: { id: true, title: true },
  });
  const jobTitles = new Map(jobs.map((job) => [job.id, job.title]));
  const emailById = new Map(users.map((row) => [row.id, row.email]));

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SendersSection
        max={MAX_SENDERS}
        driveEnabled={settings.driveIntakeEnabled}
        senders={senders.map((sender) => ({
          id: sender.id,
          display: sender.display,
          kind: sender.kind,
          addedBy: emailById.get(sender.createdById) ?? null,
          addedOn: formatDate(sender.createdAt),
          driveStatus: sender.driveStatus,
          driveError: sender.driveError,
        }))}
      />
      <GoogleDriveSection
        enabled={settings.driveIntakeEnabled}
        folderUrl={user.business.driveFolderId ? folderUrl(user.business.driveFolderId) : null}
        rows={driveItems.map((item) => ({
          id: item.id,
          seen: formatDateTime(item.createdAt),
          fileName: item.fileName,
          uploader: item.uploaderEmail,
          job: jobTitles.get(item.jobId) ?? null,
          status: item.status,
          reason: item.reason,
        }))}
      />
      <EmailActivity
        rows={emails.map((email) => ({
          id: email.id,
          received: formatDateTime(email.receivedAt),
          from: email.fromAddress,
          subject: email.subject,
          status: email.status,
          reason: email.reason,
          acceptedCount: email.acceptedCount,
          replySent: email.replySentAt ? formatDateTime(email.replySentAt) : null,
        }))}
      />
    </div>
  );
}
