import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { getDrive, type DriveClient } from "@/lib/google/drive";
import { removeOwnDriveFile, removeSubmissionDriveFiles } from "@/lib/google/drive-cleanup";
import { effectiveRetentionDays, expiredSubmissions, retentionCutoff } from "@/lib/retention";
import { RESULTS_BUCKET, RESUMES_BUCKET, resumeStorageKey } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { log } from "./config";

const BATCH_SIZE = 200;

export type BusinessPurge = {
  businessId: string;
  name: string;
  retentionDays: number;
  // Deleted, or on a dry run the number that would be.
  submissions: number;
  // Left in place because a stored file could not be removed.
  skipped: number;
};

export type PurgeReport = {
  businesses: BusinessPurge[];
  events: number;
  emails: number;
  driveItems: number;
};

// Throws when the objects could not be removed.
export type RemoveObjects = (bucket: string, keys: string[]) => Promise<void>;

type PurgeOptions = {
  dryRun: boolean;
  removeObjects?: RemoveObjects;
  // Left out, the system account's Drive is used when it is connected.
  drive?: DriveClient | null;
  // Stops between batches when the worker shuts down.
  signal?: AbortSignal;
};

type Row = {
  id: string;
  jobId: string;
  businessId: string;
  storageKey: string | null;
  driveFileId: string | null;
  evaluation: { resultPdfKey: string | null; resultDriveFileId: string | null } | null;
};

// Null when Drive cannot be reached. Files there are then left behind.
type GetDrive = () => Promise<DriveClient | null>;

export function lazyDrive(given: DriveClient | null | undefined): GetDrive {
  let resolved: Promise<DriveClient | null> | undefined;
  return () =>
    (resolved ??=
      given !== undefined
        ? Promise.resolve(given)
        : getDrive().catch((error) => {
            log(`purge: Drive not available, files there are left in place: ${describe(error)}`);
            return null;
          }));
}

async function removeFromStorage(bucket: string, keys: string[]) {
  const { error } = await supabaseAdmin.storage.from(bucket).remove(keys);
  if (error) throw new Error(error.message);
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function keyParts(row: Row) {
  return { businessId: row.businessId, jobId: row.jobId, submissionId: row.id };
}

// A row without a result PDF has no key for the results bucket.
const OBJECTS: { bucket: string; key: (row: Row) => string | null }[] = [
  { bucket: RESUMES_BUCKET, key: (row) => row.storageKey ?? resumeStorageKey(keyParts(row)) },
  { bucket: RESULTS_BUCKET, key: (row) => row.evaluation?.resultPdfKey ?? null },
];

// Returns the ids of the rows that still have a stored file.
async function removeStoredFiles(rows: Row[], removeObjects: RemoveObjects) {
  const failed = new Set<string>();
  for (const { bucket, key } of OBJECTS) {
    // A row that already failed keeps its other file too.
    const pending = rows.flatMap((row) => {
      const objectKey = key(row);
      return objectKey && !failed.has(row.id) ? [{ row, objectKey }] : [];
    });
    if (pending.length === 0) continue;
    try {
      await removeObjects(
        bucket,
        pending.map((entry) => entry.objectKey),
      );
      continue;
    } catch {
      // One bad object should not hold back the rest, so go one by one.
    }
    for (const { row, objectKey } of pending) {
      try {
        await removeObjects(bucket, [objectKey]);
      } catch (error) {
        failed.add(row.id);
        log(`purge: ${bucket} file of ${row.id} not removed, row kept: ${describe(error)}`);
      }
    }
  }
  return failed;
}

export async function purgeBusiness(
  where: ReturnType<typeof expiredSubmissions>,
  removeObjects: RemoveObjects,
  drive: GetDrive,
  signal?: AbortSignal,
) {
  let submissions = 0;
  let skipped = 0;
  // Walks forward by id so a skipped row is not picked again in this run.
  let after: string | undefined;

  while (!signal?.aborted) {
    const rows = await db.submission.findMany({
      where: { ...where, ...(after && { id: { gt: after } }) },
      select: {
        id: true,
        jobId: true,
        businessId: true,
        storageKey: true,
        driveFileId: true,
        evaluation: { select: { resultPdfKey: true, resultDriveFileId: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;

    // Files first. A row whose file is still there stays for the next run.
    const failed = await removeStoredFiles(rows, removeObjects);
    skipped += failed.size;

    // Still finished only: a row may have been queued again in the meantime.
    const { count } = await db.submission.deleteMany({
      where: {
        id: { in: rows.filter((row) => !failed.has(row.id)).map((row) => row.id) },
        status: { in: ["DONE", "FAILED"] },
      },
    });
    submissions += count;

    // What the submission left in its Drive folder goes too, as far as Google allows.
    for (const row of rows) {
      if (failed.has(row.id) || !row.driveFileId) continue;
      const client = await drive();
      if (!client) break;
      await removeSubmissionDriveFiles(
        client,
        { driveFileId: row.driveFileId, resultDriveFileId: row.evaluation?.resultDriveFileId ?? null },
        (message) => log(`purge: ${message}`),
      );
    }

    if (rows.length < BATCH_SIZE) break;
  }
  return { submissions, skipped };
}

// Old Drive intake rows, with the note files written for skipped uploads.
export async function purgeDriveItems(
  where: Prisma.DriveIntakeItemWhereInput,
  dryRun: boolean,
  drive: GetDrive,
) {
  if (dryRun) return db.driveIntakeItem.count({ where });

  let deleted = 0;
  for (;;) {
    const items = await db.driveIntakeItem.findMany({
      where,
      select: { id: true, noteDriveFileId: true },
      take: BATCH_SIZE,
    });
    if (items.length === 0) break;

    for (const item of items) {
      if (!item.noteDriveFileId) continue;
      const client = await drive();
      if (!client) break;
      await removeOwnDriveFile(client, item.noteDriveFileId, (message) => log(`purge: ${message}`));
    }
    deleted += (
      await db.driveIntakeItem.deleteMany({ where: { id: { in: items.map((item) => item.id) } } })
    ).count;
    if (items.length < BATCH_SIZE) break;
  }
  return deleted;
}

// Deletes finished submissions past their business's retention, with their
// stored files and what they left in Drive, inbound email and Drive intake
// rows of the same age, and event log rows past the longest retention. Usage
// records are kept.
export async function purge({
  dryRun,
  removeObjects = removeFromStorage,
  drive: givenDrive,
  signal,
}: PurgeOptions): Promise<PurgeReport> {
  const drive = lazyDrive(givenDrive);
  const now = new Date();
  const [settings, businesses] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { id: 1 } }),
    db.business.findMany({
      select: { id: true, name: true, retentionDays: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const report: PurgeReport = { businesses: [], events: 0, emails: 0, driveItems: 0 };
  const purgeEmails = async (where: Prisma.InboundEmailWhereInput) => {
    report.emails += dryRun
      ? await db.inboundEmail.count({ where })
      : (await db.inboundEmail.deleteMany({ where })).count;
  };
  for (const business of businesses) {
    const retentionDays = effectiveRetentionDays(business, settings);
    const where = expiredSubmissions(business.id, retentionDays, now);

    const { submissions, skipped } = dryRun
      ? { submissions: await db.submission.count({ where }), skipped: 0 }
      : await purgeBusiness(where, removeObjects, drive, signal);

    if (!dryRun && submissions > 0) {
      await logEvent({
        type: "retention.purged",
        message: "Submissions past retention deleted",
        businessId: business.id,
        meta: { count: submissions, retentionDays },
      });
    }
    await purgeEmails({
      businessId: business.id,
      receivedAt: { lt: retentionCutoff(retentionDays, now) },
    });
    report.driveItems += await purgeDriveItems(
      { businessId: business.id, createdAt: { lt: retentionCutoff(retentionDays, now) } },
      dryRun,
      drive,
    );
    report.businesses.push({
      businessId: business.id,
      name: business.name,
      retentionDays,
      submissions,
      skipped,
    });
  }

  // Mail that never matched a business is kept for the longest retention.
  await purgeEmails({
    businessId: null,
    receivedAt: { lt: retentionCutoff(settings.maxRetentionDays, now) },
  });

  const oldEvents = { createdAt: { lt: retentionCutoff(settings.maxRetentionDays, now) } };
  report.events = dryRun
    ? await db.eventLog.count({ where: oldEvents })
    : (await db.eventLog.deleteMany({ where: oldEvents })).count;

  return report;
}

// Takes the daily purge if it is due. One statement, so two workers checking
// at the same moment cannot both get it.
export async function claimPurge() {
  const rows = await db.$queryRaw<{ id: number }[]>`
    UPDATE "Settings"
    SET "lastPurgeAt" = now()
    WHERE id = 1
      AND ("lastPurgeAt" IS NULL OR "lastPurgeAt" < now() - interval '24 hours')
    RETURNING id`;
  return rows.length > 0;
}

// Null when the purge is not due.
export async function purgeIfDue(options: Omit<PurgeOptions, "dryRun"> = {}) {
  if (!(await claimPurge())) return null;
  return purge({ ...options, dryRun: false });
}

export function describePurge(report: PurgeReport) {
  const touched = report.businesses.filter((business) => business.submissions > 0);
  const submissions = touched.reduce((sum, business) => sum + business.submissions, 0);
  const skipped = report.businesses.reduce((sum, business) => sum + business.skipped, 0);
  return (
    `${submissions} submission(s) deleted across ${touched.length} business(es), ` +
    `${report.events} old event(s) deleted, ${report.emails} old email record(s) and ${report.driveItems} old Drive record(s) deleted` +
    (skipped > 0 ? `, ${skipped} submission(s) kept because a file was not removed` : "")
  );
}
