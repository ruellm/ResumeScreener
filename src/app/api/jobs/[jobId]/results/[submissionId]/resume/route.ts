import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireJob } from "@/lib/job-access";
import { RESUMES_BUCKET } from "@/lib/storage-keys";
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
    select: { storageKey: true, originalFilename: true },
  });
  if (!submission?.storageKey) notFound();

  const { data } = await supabaseAdmin.storage
    .from(RESUMES_BUCKET)
    .createSignedUrl(submission.storageKey, LINK_SECONDS, {
      download: submission.originalFilename,
    });
  // The file may have been purged.
  if (!data) notFound();

  return NextResponse.redirect(data.signedUrl);
}
