import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env.server";
import { getDrive, type DriveClient } from "@/lib/google/drive";
import { createMissingFolders } from "@/lib/google/drive-folders";
import { GOOGLE_CONNECTION_ID } from "@/lib/google/oauth";
import { GoogleNotConnectedError } from "@/lib/google/system-auth";
import { log, workerEnv } from "../config";
import { recordPoll } from "../heartbeat";
import { auditDrive, claimAudit } from "./audit";
import { pollChanges } from "./changes";
import { syncFailureNotes } from "./failure-notes";
import { syncBusinessSharing } from "./sharing";
import { dueWriteBacks, writeBackResult } from "./write-back";

let lastPoll = 0;
let notConnectedLogged = false;
let task: Promise<void> | null = null;

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function notConnected() {
  if (!notConnectedLogged) log("drive: Google account not connected, Drive is not checked");
  notConnectedLogged = true;
}

// Sharing of the businesses whose allowed senders changed. The flag is
// cleared first, so a change made during the sync is not lost. businessIds
// limits the run to those businesses.
export async function syncFlaggedBusinesses(drive: DriveClient, businessIds?: string[]) {
  const businesses = await db.business.findMany({
    where: { driveSyncNeeded: true, id: businessIds && { in: businessIds } },
    select: { id: true, name: true, driveFolderId: true },
  });
  for (const business of businesses) {
    await db.business.update({ where: { id: business.id }, data: { driveSyncNeeded: false } });
    try {
      await syncBusinessSharing(drive, business, { audit: false });
    } catch (error) {
      await db.business.update({ where: { id: business.id }, data: { driveSyncNeeded: true } });
      throw error;
    }
  }
}

// Each part runs even when the one before it failed.
async function step(name: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) throw error;
    log(`drive ${name} error: ${describe(error)}`);
  }
}

async function run() {
  const [settings, connection] = await Promise.all([
    db.settings.findUniqueOrThrow({
      where: { id: 1 },
      select: { driveIntakeEnabled: true, driveRootFolderId: true },
    }),
    db.googleConnection.findUnique({
      where: { id: GOOGLE_CONNECTION_ID },
      select: { status: true },
    }),
  ]);
  const rootId = settings.driveRootFolderId;
  if (!settings.driveIntakeEnabled || !rootId) return;
  if (connection?.status !== "ok") {
    notConnected();
    return;
  }
  if (notConnectedLogged) log("drive: Google account connected again");
  notConnectedLogged = false;

  const drive = await getDrive();
  await step("folders", () => createMissingFolders(drive, rootId));
  await step("sharing", () => syncFlaggedBusinesses(drive));
  await step("changes", async () => {
    await pollChanges(drive, { systemAccount: serverEnv.GOOGLE_SYSTEM_ACCOUNT });
    await recordPoll("drive");
  });
  await step("failure notes", () => syncFailureNotes(drive));
  await step("results", async () => {
    for (const id of await dueWriteBacks()) await writeBackResult(drive, id);
  });
  await step("audit", async () => {
    if (!(await claimAudit())) return;
    const removed = await auditDrive(drive, rootId);
    log(`drive audit: ${removed} permission(s) removed`);
  });
}

// Runs beside the queue, like the purge. Does nothing while a run is going.
export function checkDrive() {
  if (task || Date.now() - lastPoll < workerEnv.DRIVE_POLL_MS) return;
  lastPoll = Date.now();

  task = run()
    .catch((error) => {
      if (error instanceof GoogleNotConnectedError) notConnected();
      else log(`drive error: ${describe(error)}`);
    })
    .finally(() => {
      task = null;
    });
}

export function driveTask() {
  return task;
}
