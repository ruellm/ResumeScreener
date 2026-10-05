import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobIntakeActivity } from "@/lib/intake-activity";
import { heartbeatSelect, toIntakeStatus } from "@/lib/intake-status";
import { requireJob } from "@/lib/job-access";

export const dynamic = "force-dynamic";

// The worker heartbeat and what came in for this job by email and Drive.
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { job } = await requireJob(jobId);

  const [settings, activity] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: heartbeatSelect }),
    jobIntakeActivity(job.id, job.businessId),
  ]);
  return NextResponse.json({ status: toIntakeStatus(settings), activity });
}
