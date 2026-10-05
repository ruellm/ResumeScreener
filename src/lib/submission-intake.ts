import "server-only";
import type { SubmissionSource } from "@prisma/client";
import { db } from "@/lib/db";
import { RESUMES_BUCKET, resumeStorageKey } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { monthlyLimitExceeded } from "@/lib/usage";

// Rules shared by every way a resume can come in.

type LimitedBusiness = {
  id: string;
  monthlyEvalLimit: number | null;
  storageLimitMb: number | null;
};

const MB = 1024 * 1024;

// Both limits reject the whole batch, so nothing is half accepted.
// stagedIds: rows of this batch that are already saved. They are left out of
// the stored total, which would otherwise count them twice.
export async function limitError(
  business: LimitedBusiness,
  fileCount: number,
  batchBytes: number,
  stagedIds: string[] = [],
) {
  const over = await monthlyLimitExceeded(business, fileCount);
  if (over) {
    return `This batch would exceed your monthly evaluation limit (used ${over.used} of ${over.limit}).`;
  }

  if (business.storageLimitMb !== null) {
    const stored = await db.submission.aggregate({
      where: { businessId: business.id, id: { notIn: stagedIds } },
      _sum: { fileSizeBytes: true },
    });
    const usedBytes = stored._sum.fileSizeBytes ?? 0;
    if (usedBytes + batchBytes > business.storageLimitMb * MB) {
      const usedMb = (usedBytes / MB).toFixed(1);
      return `This batch would exceed your storage limit (${usedMb} MB of ${business.storageLimitMb} MB used).`;
    }
  }

  return null;
}

// The newest earlier submission of each file in this job, by hash. Failed
// ones do not count, so a file that failed can be sent again.
export async function findDuplicates(jobId: string, businessId: string, hashes: string[]) {
  const earlier = await db.submission.findMany({
    where: { jobId, businessId, sha256: { in: hashes }, status: { not: "FAILED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, sha256: true, createdAt: true },
  });
  // Later rows overwrite earlier ones, so the newest wins.
  return new Map(earlier.map((row) => [row.sha256, row]));
}

type StoredSubmissionInput = {
  jobId: string;
  businessId: string;
  source: SubmissionSource;
  originalFilename: string;
  sha256: string;
  bytes: Buffer;
  senderEmail?: string;
  emailMessageId?: string;
  inboundEmailId?: string;
  driveFileId?: string;
};

// Saves a file the server already holds: creates the row and stores the file.
// The row stays RECEIVED, so nothing evaluates it until it is queued. Leaves
// nothing behind when the file cannot be stored.
export async function stageSubmission({ bytes, ...fields }: StoredSubmissionInput) {
  const submission = await db.submission.create({
    data: { ...fields, status: "RECEIVED", fileSizeBytes: bytes.length },
    select: { id: true },
  });
  const storageKey = resumeStorageKey({
    businessId: fields.businessId,
    jobId: fields.jobId,
    submissionId: submission.id,
  });

  const { error } = await supabaseAdmin.storage
    .from(RESUMES_BUCKET)
    .upload(storageKey, bytes, { contentType: "application/pdf" });
  if (error) {
    await db.submission.delete({ where: { id: submission.id } });
    throw new Error(`Resume upload failed: ${error.message}`);
  }

  await db.submission.update({ where: { id: submission.id }, data: { storageKey } });
  return { id: submission.id, storageKey, sizeBytes: bytes.length };
}

export type StagedSubmission = Awaited<ReturnType<typeof stageSubmission>>;

export async function queueSubmissions(staged: StagedSubmission[]) {
  await db.submission.updateMany({
    where: { id: { in: staged.map((row) => row.id) }, status: "RECEIVED" },
    data: { status: "QUEUED", availableAt: new Date() },
  });
}

// Takes back staged files that will not be evaluated after all.
export async function discardSubmissions(staged: StagedSubmission[]) {
  if (staged.length === 0) return;
  const { error } = await supabaseAdmin.storage
    .from(RESUMES_BUCKET)
    .remove(staged.map((row) => row.storageKey));
  // The hourly cleanup of unconfirmed uploads removes what is left.
  if (error) console.error("staged resumes not removed from storage", error.message);
  await db.submission.deleteMany({
    where: { id: { in: staged.map((row) => row.id) }, status: "RECEIVED" },
  });
}

export async function createStoredSubmission(input: StoredSubmissionInput) {
  const staged = await stageSubmission(input);
  await queueSubmissions([staged]);
  return staged.id;
}
