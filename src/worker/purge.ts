import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { effectiveRetentionDays, expiredSubmissions, retentionCutoff } from "@/lib/retention";
import {
  RESULTS_BUCKET,
  RESUMES_BUCKET,
  resultPdfStorageKey,
  resumeStorageKey,
} from "@/lib/storage-keys";
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

export type PurgeReport = { businesses: BusinessPurge[]; events: number; emails: number };

// Throws when the objects could not be removed.
export type RemoveObjects = (bucket: string, keys: string[]) => Promise<void>;

type PurgeOptions = {
  dryRun: boolean;
  removeObjects?: RemoveObjects;
  // Stops between batches when the worker shuts down.
  signal?: AbortSignal;
};

type Row = { id: string; jobId: string; businessId: string; storageKey: string | null };

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

const OBJECTS: { bucket: string; key: (row: Row) => string }[] = [
  { bucket: RESUMES_BUCKET, key: (row) => row.storageKey ?? resumeStorageKey(keyParts(row)) },
  { bucket: RESULTS_BUCKET, key: (row) => resultPdfStorageKey(keyParts(row)) },
];

// Returns the ids of the rows that still have a stored file.
async function removeStoredFiles(rows: Row[], removeObjects: RemoveObjects) {
  const failed = new Set<string>();
  for (const { bucket, key } of OBJECTS) {
    // A row that already failed keeps its other file too.
    const pending = rows.filter((row) => !failed.has(row.id));
    try {
      await removeObjects(bucket, pending.map(key));
      continue;
    } catch {
      // One bad object should not hold back the rest, so go one by one.
    }
    for (const row of pending) {
      try {
        await removeObjects(bucket, [key(row)]);
      } catch (error) {
        failed.add(row.id);
        log(`purge: ${bucket} file of ${row.id} not removed, row kept: ${describe(error)}`);
      }
    }
  }
  return failed;
}

async function purgeBusiness(
  where: ReturnType<typeof expiredSubmissions>,
  removeObjects: RemoveObjects,
  signal?: AbortSignal,
) {
  let submissions = 0;
  let skipped = 0;
  // Walks forward by id so a skipped row is not picked again in this run.
  let after: string | undefined;

  while (!signal?.aborted) {
    const rows = await db.submission.findMany({
      where: { ...where, ...(after && { id: { gt: after } }) },
      select: { id: true, jobId: true, businessId: true, storageKey: true },
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

    if (rows.length < BATCH_SIZE) break;
  }
  return { submissions, skipped };
}

// Deletes finished submissions past their business's retention, with their
// stored files, inbound email rows of the same age, and event log rows past
// the longest retention. Usage records are kept.
export async function purge({
  dryRun,
  removeObjects = removeFromStorage,
  signal,
}: PurgeOptions): Promise<PurgeReport> {
  const now = new Date();
  const [settings, businesses] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { id: 1 } }),
    db.business.findMany({
      select: { id: true, name: true, retentionDays: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const report: PurgeReport = { businesses: [], events: 0, emails: 0 };
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
      : await purgeBusiness(where, removeObjects, signal);

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
    `${report.events} old event(s) deleted, ${report.emails} old email record(s) deleted` +
    (skipped > 0 ? `, ${skipped} submission(s) kept because a file was not removed` : "")
  );
}
