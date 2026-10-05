import "server-only";
import { db } from "@/lib/db";
import { RESULTS_BUCKET, resultPdfStorageKey } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderResultPdf } from "./render";

async function renderCurrent(submissionId: string) {
  const submission = await db.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { evaluation: true },
  });
  const { evaluation } = submission;
  if (!evaluation) throw new Error(`Submission ${submissionId} has no evaluation.`);

  const pdf = await renderResultPdf({ evaluation, submission, generatedAt: new Date() });
  return { submission, evaluation, pdf };
}

// The result PDF of a submission's current evaluation, made now. Storage may
// hand out an overwritten file's old content for up to an hour, so a copy
// that has to be current is rendered instead of downloaded.
export async function renderCurrentResultPdf(submissionId: string) {
  return (await renderCurrent(submissionId)).pdf;
}

// Renders the result PDF for a submission's current evaluation, stores it in
// the results bucket and records the key. Returns the key.
export async function storeResultPdf(submissionId: string) {
  const { submission, evaluation, pdf } = await renderCurrent(submissionId);

  const key = resultPdfStorageKey({
    businessId: submission.businessId,
    jobId: submission.jobId,
    submissionId: submission.id,
    evaluationId: evaluation.id,
  });
  const { error } = await supabaseAdmin.storage
    .from(RESULTS_BUCKET)
    .upload(key, pdf, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Result PDF upload failed: ${error.message}`);

  await db.evaluation.update({ where: { id: evaluation.id }, data: { resultPdfKey: key } });
  return key;
}

// The result PDF's bytes. Renders it when it was never stored or is gone.
export async function loadResultPdf(submissionId: string, storedKey: string | null) {
  const bucket = supabaseAdmin.storage.from(RESULTS_BUCKET);
  let file = storedKey ? await bucket.download(storedKey) : null;
  if (!file?.data) file = await bucket.download(await storeResultPdf(submissionId));
  if (!file.data) throw new Error(`Result PDF download failed: ${file.error.message}`);
  return Buffer.from(await file.data.arrayBuffer());
}

export async function removeResultPdf(key: string) {
  const { error } = await supabaseAdmin.storage.from(RESULTS_BUCKET).remove([key]);
  if (error) throw new Error(`Result PDF removal failed: ${error.message}`);
}
