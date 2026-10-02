import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { RESUMES_BUCKET, resumeStorageKey } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";

const USAGE =
  "Usage: npm run upload-test -- <jobId> <file...>\n" +
  "       npm run upload-test -- --cleanup";

// Marks rows made by this script so cleanup can find them. Web uploads do not
// use this field.
const TEST_MARKER = "upload-test";

async function cleanup() {
  const rows = await db.submission.findMany({
    where: { emailMessageId: TEST_MARKER },
    select: { id: true, businessId: true, jobId: true },
  });
  if (rows.length === 0) {
    console.log("No test submissions.");
    return;
  }

  // Keys are rebuilt from the rows so an object is removed even when the row
  // never got its storageKey.
  const keys = rows.map((row) =>
    resumeStorageKey({ businessId: row.businessId, jobId: row.jobId, submissionId: row.id }),
  );
  const { data, error } = await supabaseAdmin.storage.from(RESUMES_BUCKET).remove(keys);
  if (error) throw new Error(`Storage cleanup failed: ${error.message}`);

  const { count } = await db.submission.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  console.log(`Deleted ${count} test submissions and ${data.length} storage objects.`);
}

async function upload(jobId: string, files: string[]) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, businessId: true },
  });
  if (!job) throw new Error(`Job ${jobId} not found.`);

  for (const file of files) {
    const data = readFileSync(file);
    const submission = await db.submission.create({
      data: {
        jobId: job.id,
        businessId: job.businessId,
        source: "WEB",
        status: "RECEIVED",
        originalFilename: path.basename(file),
        sha256: createHash("sha256").update(data).digest("hex"),
        fileSizeBytes: data.length,
        emailMessageId: TEST_MARKER,
      },
    });

    const storageKey = resumeStorageKey({
      businessId: job.businessId,
      jobId: job.id,
      submissionId: submission.id,
    });
    const { error } = await supabaseAdmin.storage
      .from(RESUMES_BUCKET)
      .upload(storageKey, data, { contentType: "application/pdf" });
    if (error) throw new Error(`Upload of ${file} failed: ${error.message}`);

    await db.submission.update({
      where: { id: submission.id },
      data: { storageKey, status: "QUEUED" },
    });
    console.log(`${submission.id}  ${submission.originalFilename}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--cleanup")) return cleanup();

  const [jobId, ...files] = args;
  if (!jobId || files.length === 0) throw new Error(USAGE);
  await upload(jobId, files);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
