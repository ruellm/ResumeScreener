import { db } from "@/lib/db";
import { RESUMES_BUCKET, resumeStorageKey } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { log } from "./config";

const ORPHAN_AFTER_MINUTES = 60;
const BATCH_SIZE = 100;

// A RECEIVED row is an upload that was prepared in the browser and never
// confirmed. After an hour nobody is coming back for it.
export async function removeOrphanUploads() {
  const rows = await db.submission.findMany({
    where: {
      status: "RECEIVED",
      createdAt: { lt: new Date(Date.now() - ORPHAN_AFTER_MINUTES * 60_000) },
    },
    select: { id: true, businessId: true, jobId: true },
    take: BATCH_SIZE,
  });
  if (rows.length === 0) return;

  // Objects first. If this fails the rows stay and the next sweep retries.
  const { error } = await supabaseAdmin.storage
    .from(RESUMES_BUCKET)
    .remove(
      rows.map((row) =>
        resumeStorageKey({ businessId: row.businessId, jobId: row.jobId, submissionId: row.id }),
      ),
    );
  if (error) throw new Error(`Orphan upload cleanup failed: ${error.message}`);

  // Still RECEIVED only: a row may have been confirmed in the meantime.
  const { count } = await db.submission.deleteMany({
    where: { id: { in: rows.map((row) => row.id) }, status: "RECEIVED" },
  });
  log(`removed ${count} unconfirmed uploads older than ${ORPHAN_AFTER_MINUTES} minutes`);
}
