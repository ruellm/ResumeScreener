import { db } from "@/lib/db";

const HEARTBEAT_INTERVAL_MS = 15_000;

let lastBeat = 0;

// Lets the pages tell whether a worker is running. Called on every pass of
// the loop, writes at most once per interval. Returns whether it wrote.
export async function heartbeat() {
  if (Date.now() - lastBeat < HEARTBEAT_INTERVAL_MS) return false;
  lastBeat = Date.now();
  await db.settings.update({ where: { id: 1 }, data: { workerSeenAt: new Date() } });
  return true;
}

// After a check of the mailbox or of Drive ran to the end.
export async function recordPoll(kind: "mail" | "drive") {
  const now = new Date();
  await db.settings.update({
    where: { id: 1 },
    data: kind === "mail" ? { lastMailPollAt: now } : { lastDrivePollAt: now },
  });
}
