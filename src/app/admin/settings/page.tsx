import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { GOOGLE_CONNECTION_ID } from "@/lib/google/oauth";
import { GoogleSection } from "./google-section";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; googleError?: string }>;
}) {
  await requireSuperAdmin();

  const [settings, connection, { google, googleError }] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { id: 1 } }),
    db.googleConnection.findUnique({
      where: { id: GOOGLE_CONNECTION_ID },
      select: {
        email: true,
        status: true,
        lastError: true,
        connectedAt: true,
        lastUsedAt: true,
      },
    }),
    searchParams,
  ]);

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
      <GoogleSection connection={connection} message={google} error={googleError} />
    </div>
  );
}
