import { db } from "@/lib/db";

// Calendar months are counted in UTC.
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

type LimitedBusiness = { id: string; monthlyEvalLimit: number | null };

// Whether `count` more evaluations would go over the monthly limit. Work that
// is already queued or running counts as used. Returns the numbers for the
// message when it would, and null when there is room or no limit.
export async function monthlyLimitExceeded(business: LimitedBusiness, count: number) {
  if (business.monthlyEvalLimit === null) return null;
  const [done, inProgress] = await Promise.all([
    countEvaluationsThisMonth(business.id),
    db.submission.count({
      where: {
        businessId: business.id,
        status: { in: ["QUEUED", "EXTRACTING", "EVALUATING"] },
      },
    }),
  ]);
  const used = done + inProgress;
  return used + count > business.monthlyEvalLimit
    ? { used, limit: business.monthlyEvalLimit }
    : null;
}

// Evaluations that count against Business.monthlyEvalLimit.
export function countEvaluationsThisMonth(businessId: string) {
  return db.usageRecord.count({
    where: { businessId, succeeded: true, createdAt: { gte: monthStart() } },
  });
}
