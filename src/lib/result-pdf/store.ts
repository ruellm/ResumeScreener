import "server-only";
import { db } from "@/lib/db";
import { RESULTS_BUCKET, resultPdfStorageKey } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderResultPdf } from "./render";

// Renders the result PDF for a submission's current evaluation, stores it in
// the results bucket and records the key. Returns the key.
export async function storeResultPdf(submissionId: string) {
  const submission = await db.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { evaluation: true },
  });
  const { evaluation } = submission;
  if (!evaluation) throw new Error(`Submission ${submissionId} has no evaluation.`);

  const pdf = await renderResultPdf({ evaluation, submission, generatedAt: new Date() });

  const key = resultPdfStorageKey({
    businessId: submission.businessId,
    jobId: submission.jobId,
    submissionId: submission.id,
  });
  const { error } = await supabaseAdmin.storage
    .from(RESULTS_BUCKET)
    .upload(key, pdf, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Result PDF upload failed: ${error.message}`);

  await db.evaluation.update({ where: { id: evaluation.id }, data: { resultPdfKey: key } });
  return key;
}

export async function removeResultPdf(key: string) {
  const { error } = await supabaseAdmin.storage.from(RESULTS_BUCKET).remove([key]);
  if (error) throw new Error(`Result PDF removal failed: ${error.message}`);
}
