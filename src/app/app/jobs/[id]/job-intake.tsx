"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { IntakeActivityRow } from "@/lib/intake-activity";
import {
  everyLabel,
  isWorkerOffline,
  relativeTime,
  type IntakeStatus,
} from "@/lib/intake-status";

const REFRESH_MS = 30_000;
const CLOCK_MS = 5_000;

type JobIntake = {
  status: IntakeStatus;
  activity: IntakeActivityRow[];
  // The time the texts are worded against. Moves on a timer.
  now: number;
  refresh: () => Promise<void>;
};

const JobIntakeContext = createContext<JobIntake | null>(null);

// Null outside a job page, such as on the edit form.
export function useJobIntake() {
  return useContext(JobIntakeContext);
}

type JobIntakeProviderProps = {
  jobId: string;
  status: IntakeStatus;
  activity: IntakeActivityRow[];
  // When the server made the page, so the first render matches on both sides.
  renderedAt: number;
  children: React.ReactNode;
};

// Keeps the worker heartbeat and the job's email and Drive activity current
// for everything on the job page.
export function JobIntakeProvider({
  jobId,
  status: initialStatus,
  activity: initialActivity,
  renderedAt,
  children,
}: JobIntakeProviderProps) {
  const [data, setData] = useState({ status: initialStatus, activity: initialActivity });
  const [now, setNow] = useState(renderedAt);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/jobs/${jobId}/activity`).catch(() => null);
    // A redirect means the session ended and the login page came back.
    if (!response || !response.ok || response.redirected) return;
    setData((await response.json()) as { status: IntakeStatus; activity: IntakeActivityRow[] });
    setNow(Date.now());
  }, [jobId]);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
    const poll = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [refresh]);

  return (
    <JobIntakeContext.Provider value={{ ...data, now, refresh }}>
      {children}
    </JobIntakeContext.Provider>
  );
}

const OFFLINE_TEXT = "Intake is paused. The background worker may not be running.";

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
      {children}
    </p>
  );
}

// Under an intake panel: how often it is checked and when it last was.
export function LastCheck({ kind }: { kind: "email" | "drive" }) {
  const intake = useJobIntake();
  if (!intake) return null;
  const { status, now } = intake;
  if (isWorkerOffline(status.workerSeenAt, now)) return <Warning>{OFFLINE_TEXT}</Warning>;

  const every = kind === "email" ? status.emailPollMs : status.drivePollMs;
  const last = kind === "email" ? status.lastMailPollAt : status.lastDrivePollAt;
  return (
    <p className="text-sm text-muted-foreground">
      Checks every {everyLabel(every)}. Last check: {relativeTime(last, now)}.
    </p>
  );
}

// On the Evaluate tab, so uploads that stay Queued are explained.
export function WorkerOfflineWarning() {
  const intake = useJobIntake();
  if (!intake || !isWorkerOffline(intake.status.workerSeenAt, intake.now)) return null;
  return <Warning>{OFFLINE_TEXT}</Warning>;
}

export function IntakeActivity() {
  const intake = useJobIntake();
  if (!intake) return null;

  return (
    <section className="grid gap-2">
      <h2 className="font-medium">Email and Drive activity</h2>
      {intake.activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has come in by email or Drive yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Files</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {intake.activity.map((row) => (
              <TableRow key={`${row.source}-${row.id}`}>
                <TableCell>{row.received}</TableCell>
                <TableCell>{row.source}</TableCell>
                <TableCell>{row.from}</TableCell>
                <TableCell className="max-w-64 whitespace-normal break-words">
                  {row.files.join(", ")}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal">
                  {row.status}
                  {row.reason && (
                    <span className="block text-xs text-muted-foreground">{row.reason}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
