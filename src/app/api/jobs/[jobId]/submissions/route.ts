import { notFound } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusRowSelect, toStatusRow } from "@/lib/submission-status";

const MAX_IDS = 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await requireBusinessUser();
  const { jobId } = await params;
  const businessId = user.business.id;

  const job = await db.job.findFirst({
    where: { id: jobId, businessId },
    select: { id: true },
  });
  if (!job) notFound();

  const ids = (request.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Pass 1 to ${MAX_IDS} ids.` }, { status: 400 });
  }

  const submissions = await db.submission.findMany({
    where: { id: { in: ids }, jobId, businessId },
    select: statusRowSelect,
  });
  return NextResponse.json(submissions.map(toStatusRow));
}
