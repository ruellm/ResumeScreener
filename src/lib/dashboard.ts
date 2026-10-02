import "server-only";
import { Prisma, type SubmissionStatus, type Verdict } from "@prisma/client";
import { db } from "@/lib/db";

export const DASHBOARD_PAGE_SIZE = 50;

const VERDICT_FILTERS = ["pass", "maybe", "fail", "rejected"] as const;
const STATUS_FILTERS = ["in_progress", "done", "failed"] as const;
const SOURCES = ["WEB", "EMAIL", "DRIVE"] as const;
const SORTS = ["received", "score"] as const;

export type DashboardFilters = {
  verdict: (typeof VERDICT_FILTERS)[number] | null;
  status: (typeof STATUS_FILTERS)[number] | null;
  source: (typeof SOURCES)[number] | null;
  flagged: boolean;
  q: string;
  sort: (typeof SORTS)[number];
  page: number;
};

const IN_PROGRESS: SubmissionStatus[] = ["QUEUED", "EXTRACTING", "EVALUATING"];

type Query = Record<string, string | string[] | undefined>;

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]) {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

// Anything unknown in the address is ignored, so a mistyped link still loads.
export function parseDashboardFilters(query: Query): DashboardFilters {
  const page = Number(query.page);
  return {
    verdict: pick(query.verdict, VERDICT_FILTERS),
    status: pick(query.status, STATUS_FILTERS),
    source: pick(query.source, SOURCES),
    flagged: query.flagged === "1",
    q: typeof query.q === "string" ? query.q.trim().slice(0, 100) : "",
    sort: pick(query.sort, SORTS) ?? "received",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

// Always carries tab=dashboard, so a reload stays on the Dashboard tab.
export function dashboardHref(jobId: string, filters: Partial<DashboardFilters> = {}) {
  const params = new URLSearchParams({ tab: "dashboard" });
  if (filters.verdict) params.set("verdict", filters.verdict);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  if (filters.flagged) params.set("flagged", "1");
  if (filters.q) params.set("q", filters.q);
  if (filters.sort && filters.sort !== "received") params.set("sort", filters.sort);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return `/app/jobs/${jobId}?${params}`;
}

// Manipulation attempts were recorded: the JSON column holds a non-empty list.
const HAS_ATTEMPTS: Prisma.EvaluationWhereInput = {
  AND: [
    { manipulationAttemptsJson: { not: Prisma.DbNull } },
    { NOT: { manipulationAttemptsJson: { equals: [] } } },
  ],
};

// RECEIVED rows are uploads that were never confirmed. They are not
// submissions yet and are left out of everything on the dashboard.
function baseWhere(jobId: string): Prisma.SubmissionWhereInput {
  return { jobId, status: { not: "RECEIVED" } };
}

function filterWhere(jobId: string, filters: DashboardFilters): Prisma.SubmissionWhereInput {
  const and: Prisma.SubmissionWhereInput[] = [baseWhere(jobId)];

  if (filters.verdict === "rejected") {
    and.push({ evaluation: { is: { rejectedForManipulation: true } } });
  } else if (filters.verdict) {
    and.push({
      evaluation: {
        is: {
          verdict: filters.verdict.toUpperCase() as Verdict,
          rejectedForManipulation: false,
        },
      },
    });
  }

  if (filters.status === "in_progress") and.push({ status: { in: IN_PROGRESS } });
  if (filters.status === "done") and.push({ status: "DONE" });
  if (filters.status === "failed") and.push({ status: "FAILED" });

  if (filters.source) and.push({ source: filters.source });

  if (filters.flagged) {
    and.push({ OR: [{ hasHiddenText: true }, { evaluation: { is: HAS_ATTEMPTS } }] });
  }

  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" as const };
    and.push({
      OR: [{ originalFilename: contains }, { evaluation: { is: { candidateName: contains } } }],
    });
  }

  return { AND: and };
}

const rowSelect = {
  id: true,
  receivedAt: true,
  source: true,
  originalFilename: true,
  status: true,
  error: true,
  extractionMethod: true,
  hasHiddenText: true,
  evaluation: {
    select: {
      candidateName: true,
      verdict: true,
      score: true,
      rejectedForManipulation: true,
      manipulationAttemptsJson: true,
    },
  },
} satisfies Prisma.SubmissionSelect;

export type DashboardRow = Prisma.SubmissionGetPayload<{ select: typeof rowSelect }>;

export async function dashboardRows(jobId: string, filters: DashboardFilters) {
  const where = filterWhere(jobId, filters);
  const take = DASHBOARD_PAGE_SIZE;
  const skip = (filters.page - 1) * take;
  const total = await db.submission.count({ where });

  if (filters.sort === "received") {
    const rows = await db.submission.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: rowSelect,
    });
    return { rows, total };
  }

  // By score, highest first, with the rows that have no score at the end.
  // Postgres would put those first, so they are fetched as a second part.
  const scored = { AND: [where, { evaluation: { isNot: null } }] };
  const unscored = { AND: [where, { evaluation: { is: null } }] };
  const scoredCount = await db.submission.count({ where: scored });

  const first =
    skip < scoredCount
      ? await db.submission.findMany({
          where: scored,
          orderBy: [{ evaluation: { score: "desc" } }, { receivedAt: "desc" }, { id: "desc" }],
          skip,
          take,
          select: rowSelect,
        })
      : [];
  const rest =
    first.length < take
      ? await db.submission.findMany({
          where: unscored,
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          skip: Math.max(0, skip - scoredCount),
          take: take - first.length,
          select: rowSelect,
        })
      : [];
  return { rows: [...first, ...rest], total };
}

export type VerdictCounts = { pass: number; maybe: number; fail: number; rejected: number };

// Per job: how many submissions currently hold each verdict. A resume
// rejected for manipulation counts as rejected, not as fail.
export async function verdictCounts(jobIds: string[]) {
  const counts = new Map<string, VerdictCounts>(
    jobIds.map((id) => [id, { pass: 0, maybe: 0, fail: 0, rejected: 0 }]),
  );
  if (jobIds.length === 0) return counts;

  const rows = await db.$queryRaw<
    { jobId: string; verdict: Verdict; rejected: boolean; count: bigint }[]
  >`
    SELECT s."jobId", e.verdict::text AS verdict,
           e."rejectedForManipulation" AS rejected, count(*) AS count
    FROM "Evaluation" e
    JOIN "Submission" s ON s.id = e."submissionId"
    WHERE s."jobId" IN (${Prisma.join(jobIds)}) AND s.status <> 'RECEIVED'
    GROUP BY 1, 2, 3`;

  for (const row of rows) {
    const entry = counts.get(row.jobId);
    if (!entry) continue;
    const key = row.rejected ? "rejected" : (row.verdict.toLowerCase() as "pass" | "maybe" | "fail");
    entry[key] += Number(row.count);
  }
  return counts;
}

export async function dashboardCounts(jobId: string) {
  const [byStatus, verdicts] = await Promise.all([
    db.submission.groupBy({ by: ["status"], where: baseWhere(jobId), _count: true }),
    verdictCounts([jobId]),
  ]);
  const count = (statuses: SubmissionStatus[]) =>
    byStatus
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row._count, 0);

  return {
    total: byStatus.reduce((sum, row) => sum + row._count, 0),
    ...verdicts.get(jobId)!,
    failed: count(["FAILED"]),
    inProgress: count(IN_PROGRESS),
  };
}
