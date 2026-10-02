import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireJob } from "@/lib/job-access";
import { storeResultPdf } from "@/lib/result-pdf/store";
import { RESULTS_BUCKET } from "@/lib/storage-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";

const LINK_SECONDS = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string; submissionId: string }> },
) {
  const { jobId, submissionId } = await params;
  const { job } = await requireJob(jobId);

  const submission = await db.submission.findFirst({
    where: { id: submissionId, jobId: job.id },
    select: {
      id: true,
      originalFilename: true,
      evaluation: { select: { resultPdfKey: true } },
    },
  });
  if (!submission?.evaluation) notFound();

  const download = `${submission.originalFilename.replace(/\.pdf$/i, "")}_RESULTS.pdf`;
  const bucket = supabaseAdmin.storage.from(RESULTS_BUCKET);

  const { resultPdfKey } = submission.evaluation;
  let signed = resultPdfKey
    ? await bucket.createSignedUrl(resultPdfKey, LINK_SECONDS, { download })
    : null;
  if (!signed?.data) {
    // Never rendered, or the stored object is gone. Make it now.
    const key = await storeResultPdf(submission.id);
    signed = await bucket.createSignedUrl(key, LINK_SECONDS, { download });
  }
  if (!signed.data) throw new Error(`Result PDF link failed: ${signed.error.message}`);

  return NextResponse.redirect(signed.data.signedUrl);
}
