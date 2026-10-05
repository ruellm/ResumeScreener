import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { MAX_SENDERS } from "@/lib/senders";
import { SendersSection } from "./senders-section";

export default async function BusinessSettingsPage() {
  const user = await requireBusinessUser();

  const [senders, users] = await Promise.all([
    db.allowedSender.findMany({
      where: { businessId: user.business.id },
      orderBy: { createdAt: "asc" },
    }),
    db.user.findMany({
      where: { businessId: user.business.id },
      select: { id: true, email: true },
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
    </div>
  );
}
