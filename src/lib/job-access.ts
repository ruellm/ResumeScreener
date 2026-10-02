import "server-only";
import { notFound } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";

// The signed-in business user and one of their jobs. A job of another
// business is a 404, the same as a job that does not exist.
export async function requireJob(jobId: string) {
  const user = await requireBusinessUser();
  const job = await db.job.findFirst({
    where: { id: jobId, businessId: user.business.id },
  });
  if (!job) notFound();
  return { user, job };
}
