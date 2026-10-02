import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function checkDb(): Promise<"ok" | "error"> {
  try {
    await db.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}

async function checkBuckets() {
  const { data } = await supabaseAdmin.storage.listBuckets();
  const isPrivate = (name: string) =>
    data?.some((bucket) => bucket.name === name && !bucket.public) ?? false;

  return { resumes: isPrivate("resumes"), results: isPrivate("results") };
}

export async function GET() {
  const [dbStatus, buckets] = await Promise.all([checkDb(), checkBuckets()]);
  const healthy = dbStatus === "ok" && buckets.resumes && buckets.results;

  return NextResponse.json(
    { db: dbStatus, buckets },
    { status: healthy ? 200 : 503 },
  );
}
