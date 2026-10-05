import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { GOOGLE_CONNECTION_ID } from "@/lib/google/oauth";
import { folderUrl } from "@/lib/google/drive";
import { setDriveIntake, setEmailIntake } from "./actions";
import { GoogleSection } from "./google-section";
import { IntakeSection } from "./intake-section";
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
        <p>Job import model: {settings.importModel}</p>
        <p>Job imports per business per day: {settings.importDailyLimit}</p>
        <p>
          Last purge: {settings.lastPurgeAt ? formatDateTime(settings.lastPurgeAt) : "Never"}
        </p>
        <p>
          Worker last seen:{" "}
          {settings.workerSeenAt ? formatDateTime(settings.workerSeenAt) : "Never"}
        </p>
        <p>
          Last mail check:{" "}
          {settings.lastMailPollAt ? formatDateTime(settings.lastMailPollAt) : "Never"}
        </p>
        <p>
          Last Drive check:{" "}
          {settings.lastDrivePollAt ? formatDateTime(settings.lastDrivePollAt) : "Never"}
        </p>
      </div>
      <IntakeSection
        id="email-intake"
        title="Email intake"
        label="Read resumes sent by email"
        enabled={settings.emailIntakeEnabled}
        googleConnected={connection?.status === "ok"}
        setEnabled={setEmailIntake}
      >
        {settings.emailIntakeSince && (
          <p>Mail received before {formatDateTime(settings.emailIntakeSince)} is not read.</p>
        )}
      </IntakeSection>
      <IntakeSection
        id="drive-intake"
        title="Drive intake"
        label="Read resumes dropped into Google Drive folders"
        enabled={settings.driveIntakeEnabled}
        googleConnected={connection?.status === "ok"}
        setEnabled={setDriveIntake}
      >
        {settings.driveRootFolderId && (
          <p>
            <a
              href={folderUrl(settings.driveRootFolderId)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              Open the Resume Screener folder
            </a>
          </p>
        )}
        <p>
          Last sharing audit:{" "}
          {settings.driveLastAuditAt ? formatDateTime(settings.driveLastAuditAt) : "Never"}
        </p>
      </IntakeSection>
      <GoogleSection connection={connection} message={google} error={googleError} />
    </div>
  );
}
