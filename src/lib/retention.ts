import type { Business, Prisma, Settings } from "@prisma/client";
import { db } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionSettings = Pick<
  Settings,
  "defaultRetentionDays" | "minRetentionDays" | "maxRetentionDays"
>;

// A business override outside the current bounds is pulled back inside them.
export function effectiveRetentionDays(
  business: Pick<Business, "retentionDays">,
  settings: RetentionSettings,
) {
  const days = business.retentionDays ?? settings.defaultRetentionDays;
  return Math.min(Math.max(days, settings.minRetentionDays), settings.maxRetentionDays);
}

export function retentionCutoff(days: number, now = new Date()) {
  return new Date(now.getTime() - days * DAY_MS);
}

// Finished submissions past retention. Rows still in the queue are left alone.
export function expiredSubmissions(
  businessId: string,
  retentionDays: number,
  now?: Date,
): Prisma.SubmissionWhereInput {
  return {
    businessId,
    status: { in: ["DONE", "FAILED"] },
    receivedAt: { lt: retentionCutoff(retentionDays, now) },
  };
}

export type RetentionChange = { businessId: string; before: number; after: number };

export type PurgeImpact = { submissions: number; businesses: number };

// What the next purge deletes for the businesses whose retention gets
// shorter. Null when no business is shortened.
export async function shorteningImpact(changes: RetentionChange[]): Promise<PurgeImpact | null> {
  const shortened = changes.filter((change) => change.after < change.before);
  if (shortened.length === 0) return null;

  const counts = await Promise.all(
    shortened.map((change) =>
      db.submission.count({ where: expiredSubmissions(change.businessId, change.after) }),
    ),
  );
  return {
    submissions: counts.reduce((sum, count) => sum + count, 0),
    businesses: counts.filter((count) => count > 0).length,
  };
}
