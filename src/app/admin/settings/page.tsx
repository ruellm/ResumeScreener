import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  await requireSuperAdmin();

  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsForm
        settings={{
          defaultRetentionDays: settings.defaultRetentionDays,
          minRetentionDays: settings.minRetentionDays,
          maxRetentionDays: settings.maxRetentionDays,
          maxFileSizeMb: settings.maxFileSizeMb,
        }}
      />
      <div className="grid gap-1 text-sm text-muted-foreground">
        <p>Evaluation model: {settings.evalModel}</p>
        <p>
          Last purge: {settings.lastPurgeAt ? formatDateTime(settings.lastPurgeAt) : "Never"}
        </p>
      </div>
    </div>
  );
}
