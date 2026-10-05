import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { MAX_SENDERS } from "@/lib/senders";
import { EmailActivity } from "./email-activity";
import { SendersSection } from "./senders-section";

const RECENT_EMAILS = 20;

export default async function BusinessSettingsPage() {
  const user = await requireBusinessUser();

  const [senders, users, emails] = await Promise.all([
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
  ]);
  const emailById = new Map(users.map((row) => [row.id, row.email]));

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SendersSection
        max={MAX_SENDERS}
        senders={senders.map((sender) => ({
          id: sender.id,
          display: sender.display,
          kind: sender.kind,
          addedBy: emailById.get(sender.createdById) ?? null,
          addedOn: formatDate(sender.createdAt),
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
