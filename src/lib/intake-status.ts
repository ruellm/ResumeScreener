// What the pages show about the background worker. No server-only imports:
// the client components use the types and the helpers too.

export const DEFAULT_POLL_MS = 30_000;

// After this long without a sign of life the worker is taken to be down.
export const WORKER_OFFLINE_AFTER_MS = 3 * 60_000;

export type IntakeStatus = {
  // ISO times, null when it never happened.
  workerSeenAt: string | null;
  lastMailPollAt: string | null;
  lastDrivePollAt: string | null;
  emailPollMs: number;
  drivePollMs: number;
  emailEnabled: boolean;
  driveEnabled: boolean;
};

export function isWorkerOffline(workerSeenAt: string | null, now: number) {
  return workerSeenAt === null || now - new Date(workerSeenAt).getTime() > WORKER_OFFLINE_AFTER_MS;
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

export function everyLabel(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds % 60 === 0 ? plural(seconds / 60, "minute") : plural(seconds, "second");
}

export function relativeTime(iso: string | null, now: number) {
  if (iso === null) return "not yet";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${plural(seconds, "second")} ago`;
  if (seconds < 3600) return `${plural(Math.floor(seconds / 60), "minute")} ago`;
  if (seconds < 86_400) return `${plural(Math.floor(seconds / 3600), "hour")} ago`;
  return `${plural(Math.floor(seconds / 86_400), "day")} ago`;
}

// The worker reads the same variables. Anything unusable falls back to the default.
function pollMs(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1000 ? parsed : DEFAULT_POLL_MS;
}

type HeartbeatSettings = {
  workerSeenAt: Date | null;
  lastMailPollAt: Date | null;
  lastDrivePollAt: Date | null;
  emailIntakeEnabled: boolean;
  driveIntakeEnabled: boolean;
};

export const heartbeatSelect = {
  workerSeenAt: true,
  lastMailPollAt: true,
  lastDrivePollAt: true,
  emailIntakeEnabled: true,
  driveIntakeEnabled: true,
} as const;

export function toIntakeStatus(settings: HeartbeatSettings): IntakeStatus {
  return {
    workerSeenAt: settings.workerSeenAt?.toISOString() ?? null,
    lastMailPollAt: settings.lastMailPollAt?.toISOString() ?? null,
    lastDrivePollAt: settings.lastDrivePollAt?.toISOString() ?? null,
    emailPollMs: pollMs(process.env.EMAIL_POLL_MS),
    drivePollMs: pollMs(process.env.DRIVE_POLL_MS),
    emailEnabled: settings.emailIntakeEnabled,
    driveEnabled: settings.driveIntakeEnabled,
  };
}
