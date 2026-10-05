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
export async function limitError(business: LimitedBusiness, fileCount: number, batchBytes: number) {
  const over = await monthlyLimitExceeded(business, fileCount);
  if (over) {
    return `This batch would exceed your monthly evaluation limit (used ${over.used} of ${over.limit}).`;
  }

  if (business.storageLimitMb !== null) {
    const stored = await db.submission.aggregate({
      where: { businessId: business.id },
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
};

// For files the server already holds: creates the row, stores the file and
// queues it. Leaves nothing behind when the file cannot be stored.
export async function createStoredSubmission({ bytes, ...fields }: StoredSubmissionInput) {
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

  await db.submission.update({
    where: { id: submission.id },
    data: { status: "QUEUED", availableAt: new Date(), storageKey },
  });
  return submission.id;
}
