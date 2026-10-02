import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type EventInput = {
  type: string;
  message: string;
  businessId?: string;
  jobId?: string;
  meta?: Prisma.InputJsonObject;
};

export async function logEvent({ type, message, businessId, jobId, meta }: EventInput) {
  await db.eventLog.create({
    data: { type, message, businessId, jobId, metaJson: meta },
  });
}
