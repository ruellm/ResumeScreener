"use server";

import { notFound } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { RESUMES_BUCKET, resumeStorageKey } from "@/lib/storage-keys";
import { findDuplicates, limitError } from "@/lib/submission-intake";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fileError,
  JOB_CLOSED_MESSAGE,
  MAX_FILES_PER_BATCH,
  type ConfirmedUpload,
  type PreparedFile,
} from "@/lib/uploads";

const TOO_MANY_FILES = `Upload at most ${MAX_FILES_PER_BATCH} files at a time.`;

const prepareSchema = z.object({
  jobId: z.string().min(1),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        size: z.number().int().min(0),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        allowDuplicate: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(MAX_FILES_PER_BATCH, TOO_MANY_FILES),
});

const confirmSchema = z.object({
  jobId: z.string().min(1),
  submissionIds: z.array(z.string().min(1)).min(1).max(MAX_FILES_PER_BATCH, TOO_MANY_FILES),
});

export async function prepareUploads(
  input: unknown,
): Promise<ActionResult<{ files: PreparedFile[] }>> {
  const user = await requireBusinessUser();

  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { jobId, files } = parsed.data;
  const businessId = user.business.id;

  const job = await db.job.findFirst({
    where: { id: jobId, businessId },
    select: { id: true, status: true },
  });
  if (!job) notFound();
  if (job.status !== "ACTIVE") return { ok: false, error: JOB_CLOSED_MESSAGE };

  const settings = await db.settings.findUniqueOrThrow({
    where: { id: 1 },
    select: { maxFileSizeMb: true },
  });

  const results: (PreparedFile | undefined)[] = files.map((file) => {
    const error = fileError(file.name, file.size, settings.maxFileSizeMb);
    return error ? { status: "error", error } : undefined;
  });

  const inBatch = new Set<string>();
  files.forEach((file, index) => {
    if (results[index]) return;
    if (inBatch.has(file.sha256)) {
      results[index] = { status: "error", error: "This file is in the batch more than once." };
    }
    inBatch.add(file.sha256);
  });

  // The hash is the browser's until the worker replaces it with its own.
  const latest = await findDuplicates(jobId, businessId, [...inBatch]);
  files.forEach((file, index) => {
    const existing = latest.get(file.sha256);
    if (results[index] || !existing || file.allowDuplicate) return;
    results[index] = {
      status: "duplicate",
      existingSubmissionId: existing.id,
      existingDate: existing.createdAt.toISOString(),
    };
  });

  const accepted = files.flatMap((file, index) => (results[index] ? [] : [{ file, index }]));
  if (accepted.length > 0) {
    const batchBytes = accepted.reduce((sum, { file }) => sum + file.size, 0);
    const error = await limitError(user.business, accepted.length, batchBytes);
    if (error) return { ok: false, error };
  }

  const bucket = supabaseAdmin.storage.from(RESUMES_BUCKET);
  await Promise.all(
    accepted.map(async ({ file, index }) => {
      const submission = await db.submission.create({
        data: {
          jobId,
          businessId,
          source: "WEB",
          status: "RECEIVED",
          originalFilename: file.name,
          fileSizeBytes: file.size,
          sha256: file.sha256,
        },
        select: { id: true },
      });
      const path = resumeStorageKey({ businessId, jobId, submissionId: submission.id });

      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error) {
        console.error("createSignedUploadUrl failed", error);
        await db.submission.delete({ where: { id: submission.id } });
        results[index] = { status: "error", error: "Could not prepare the upload. Try again." };
        return;
      }
      results[index] = {
        status: "ready",
        submissionId: submission.id,
        path: data.path,
        token: data.token,
      };
    }),
  );

  return { ok: true, files: results as PreparedFile[] };
}

function isMissing(error: unknown) {
  const { code, statusCode, status } = error as {
    code?: string;
    statusCode?: string;
    status?: number;
  };
  return code === "NoSuchKey" || statusCode === "404" || status === 404;
}

export async function confirmUpload(
  input: unknown,
): Promise<ActionResult<{ results: ConfirmedUpload[] }>> {
  const user = await requireBusinessUser();

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { jobId, submissionIds } = parsed.data;
  const businessId = user.business.id;

  const job = await db.job.findFirst({
    where: { id: jobId, businessId },
    select: { id: true },
  });
  if (!job) notFound();

  const rows = await db.submission.findMany({
    where: { id: { in: submissionIds }, jobId, businessId, status: "RECEIVED" },
    select: { id: true, fileSizeBytes: true },
  });
  const sizes = new Map(rows.map((row) => [row.id, row.fileSizeBytes]));
  const bucket = supabaseAdmin.storage.from(RESUMES_BUCKET);

  const results = await Promise.all(
    submissionIds.map(async (submissionId): Promise<ConfirmedUpload> => {
      const expectedSize = sizes.get(submissionId);
      if (expectedSize === undefined) {
        return { submissionId, ok: false, error: "Upload not found." };
      }
      const path = resumeStorageKey({ businessId, jobId, submissionId });

      const { data, error } = await bucket.info(path);
      if (error && !isMissing(error)) {
        // Storage could not be asked. Keep the row; it may still be fine.
        console.error("storage info failed", error);
        return { submissionId, ok: false, error: "Could not check the upload. Try again." };
      }

      if (!error && data.size === expectedSize) {
        await db.submission.updateMany({
          where: { id: submissionId, status: "RECEIVED" },
          data: { status: "QUEUED", availableAt: new Date(), storageKey: path },
        });
        return { submissionId, ok: true };
      }

      // Never uploaded, or not the file that was announced.
      if (!error) await bucket.remove([path]);
      await db.submission.deleteMany({ where: { id: submissionId, status: "RECEIVED" } });
      return { submissionId, ok: false, error: "The upload did not complete. Try again." };
    }),
  );

  return { ok: true, results };
}
