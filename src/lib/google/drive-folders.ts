import "server-only";
import { db } from "@/lib/db";
import { getDrive, type DriveClient } from "./drive";
import { GoogleNotConnectedError } from "./system-auth";

export const ROOT_FOLDER_NAME = "Resume Screener";

type BusinessRef = { id: string; name: string; driveFolderId: string | null };
type JobRef = { id: string; title: string; emailAlias: string; driveFolderId: string | null };

export function jobFolderName(job: Pick<JobRef, "title" | "emailAlias">) {
  return `${job.title} (JOB-${job.emailAlias.toUpperCase()})`;
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Creates the folder, or gives an existing one its current name.
// save stores the new id and returns false when another process got there first.
async function ensureFolder(
  drive: DriveClient,
  folder: { existingId: string | null; name: string; parentId: string },
  save: (folderId: string) => Promise<boolean>,
  reload: () => Promise<string | null>,
) {
  if (folder.existingId) {
    await drive.rename(folder.existingId, folder.name);
    return folder.existingId;
  }

  const created = await drive.createFolder(folder.name, folder.parentId);
  if (await save(created)) return created;

  await drive.deleteFile(created).catch(() => undefined);
  const winner = await reload();
  if (!winner) throw new Error(`Folder ${folder.name} could not be saved.`);
  return winner;
}

export function ensureBusinessFolder(drive: DriveClient, business: BusinessRef, rootId: string) {
  return ensureFolder(
    drive,
    { existingId: business.driveFolderId, name: business.name, parentId: rootId },
    async (driveFolderId) => {
      const { count } = await db.business.updateMany({
        where: { id: business.id, driveFolderId: null },
        // A new folder still has to be shared with the allowed senders.
        data: { driveFolderId, driveSyncNeeded: true },
      });
      return count > 0;
    },
    async () =>
      (await db.business.findUnique({ where: { id: business.id }, select: { driveFolderId: true } }))
        ?.driveFolderId ?? null,
  );
}

export function ensureJobFolder(drive: DriveClient, job: JobRef, businessFolderId: string) {
  return ensureFolder(
    drive,
    { existingId: job.driveFolderId, name: jobFolderName(job), parentId: businessFolderId },
    async (driveFolderId) => {
      const { count } = await db.job.updateMany({
        where: { id: job.id, driveFolderId: null },
        data: { driveFolderId },
      });
      return count > 0;
    },
    async () =>
      (await db.job.findUnique({ where: { id: job.id }, select: { driveFolderId: true } }))
        ?.driveFolderId ?? null,
  );
}

// Creates the folders of jobs that have none yet, a batch at a time. Covers
// jobs that existed before Drive intake was switched on and folders that
// could not be made when the job was saved. Returns how many were created.
// businessIds limits the run to those businesses.
export async function createMissingFolders(
  drive: DriveClient,
  rootId: string,
  { limit = 25, businessIds }: { limit?: number; businessIds?: string[] } = {},
) {
  const jobs = await db.job.findMany({
    where: { driveFolderId: null, businessId: businessIds && { in: businessIds } },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { business: { select: { id: true, name: true, driveFolderId: true } } },
  });

  // Jobs of one business share its folder, also when it was made in this run.
  const businessFolders = new Map<string, string>();
  let created = 0;
  for (const job of jobs) {
    try {
      const businessFolderId =
        businessFolders.get(job.businessId) ??
        job.business.driveFolderId ??
        (await ensureBusinessFolder(drive, job.business, rootId));
      businessFolders.set(job.businessId, businessFolderId);
      await ensureJobFolder(drive, job, businessFolderId);
      created += 1;
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) throw error;
      console.error(`Drive folder of job ${job.id} not created: ${describe(error)}`);
    }
  }
  return created;
}

async function intakeRoot() {
  const settings = await db.settings.findUniqueOrThrow({
    where: { id: 1 },
    select: { driveIntakeEnabled: true, driveRootFolderId: true },
  });
  return settings.driveIntakeEnabled ? settings.driveRootFolderId : null;
}

// For the web app, after a job was created or renamed. Never throws: saving
// the job must not depend on Google. The worker makes a folder that is missing.
export async function syncJobFolder(jobId: string) {
  try {
    const rootId = await intakeRoot();
    if (!rootId) return;
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: { business: { select: { id: true, name: true, driveFolderId: true } } },
    });
    if (!job) return;

    const drive = await getDrive();
    const businessFolderId =
      job.business.driveFolderId ?? (await ensureBusinessFolder(drive, job.business, rootId));
    await ensureJobFolder(drive, job, businessFolderId);
  } catch (error) {
    console.error(`Drive folder of job ${jobId} not updated: ${describe(error)}`);
  }
}

// For the web app, after a business was renamed. Never throws.
export async function syncBusinessFolder(businessId: string) {
  try {
    const rootId = await intakeRoot();
    if (!rootId) return;
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, driveFolderId: true },
    });
    // A business without a folder gets one with its first job.
    if (!business?.driveFolderId) return;
    await ensureBusinessFolder(await getDrive(), business, rootId);
  } catch (error) {
    console.error(`Drive folder of business ${businessId} not updated: ${describe(error)}`);
  }
}
