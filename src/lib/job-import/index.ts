import "server-only";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { JOB_LIMITS } from "@/lib/job-schema";
import { blockedSite, blockedSiteMessage } from "./blocked-sites";
import { ImportError } from "./errors";
import { extractPosting, POSTING_MAX_CHARS } from "./extract";
import { safeFetch } from "./fetch";
import type { ImportRequest } from "./input";
import { mapPosting, newImportMeter, type MappedPosting } from "./map";

const DAY_MS = 24 * 60 * 60 * 1000;
const OTHER_DETAILS_HEADING = "Other details:";

export type ImportSource = "structured data" | "page text" | "pasted text";

export type ImportedJob = {
  fields: {
    title: string;
    roleOverview: string;
    requirements: string;
    idealCandidateProfile: string;
    passingCriteria: string;
  };
  skills: { id: string; name: string; category: string; isRequired: boolean }[];
  // Null when text was pasted without saying where it came from.
  postUrl: string | null;
  host: string | null;
  postSnapshot: string;
  source: ImportSource;
};

type ImportInput = { businessId: string; userId: string } & ImportRequest;

// The parts that reach outside. Tests replace them.
export type ImportDeps = { fetchPage: typeof safeFetch; map: typeof mapPosting };

const defaultDeps: ImportDeps = { fetchPage: safeFetch, map: mapPosting };

export async function importLimitReached(businessId: string, limit: number) {
  const used = await db.usageRecord.count({
    where: { businessId, kind: "job_import", createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  return used >= limit;
}

// Adds the leftover details to the overview, as much as still fits.
function withOtherDetails(roleOverview: string, otherDetails: string) {
  if (!otherDetails) return roleOverview;
  const addition = `\n\n${OTHER_DETAILS_HEADING}\n${otherDetails}`;
  const room = JOB_LIMITS.roleOverview - roleOverview.length;
  if (room < OTHER_DETAILS_HEADING.length + 20) return roleOverview;
  return roleOverview + addition.slice(0, room).trimEnd();
}

// Fetches or takes the posting, has the model read it into the job form and
// returns what to put in each field. Throws ImportError with a message for the user.
export async function importJobPosting(
  input: ImportInput,
  deps: ImportDeps = defaultDeps,
): Promise<ImportedJob> {
  // Before anything else: a site that is known to refuse is not even asked,
  // and the attempt costs the business nothing.
  const blocked = input.url !== undefined ? blockedSite(input.url) : null;
  if (blocked) throw new ImportError("siteBlocked", { message: blockedSiteMessage(blocked) });

  const settings = await db.settings.findUniqueOrThrow({
    where: { id: 1 },
    select: { importModel: true, importDailyLimit: true },
  });
  if (await importLimitReached(input.businessId, settings.importDailyLimit)) {
    throw new ImportError("overLimit");
  }

  let source: ImportSource = "pasted text";
  let posting: string;
  let postUrl: string | null = null;
  if (input.url !== undefined) {
    const page = await deps.fetchPage(input.url);
    const extracted = extractPosting(page.body, page.url, page.contentType);
    source = extracted.source;
    posting = extracted.text;
    postUrl = page.url;
  } else {
    posting = input.text.trim().slice(0, POSTING_MAX_CHARS);
    // Kept so the job still links to the post. It is never fetched.
    postUrl = input.sourceUrl ?? null;
  }

  const catalogue = await db.skill.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true },
  });

  const meter = newImportMeter();
  let mapped: MappedPosting | undefined;
  try {
    mapped = await deps.map(
      {
        model: settings.importModel,
        posting,
        skillNames: catalogue.map((skill) => skill.name),
      },
      meter,
    );
  } finally {
    // Every call that reached the model counts, also one that failed.
    if (meter.calls > 0) {
      await db.usageRecord.create({
        data: {
          businessId: input.businessId,
          kind: "job_import",
          model: settings.importModel,
          inputTokens: meter.inputTokens,
          outputTokens: meter.outputTokens,
          cacheCreationTokens: meter.cacheCreationTokens,
          cacheReadTokens: meter.cacheReadTokens,
          durationMs: meter.durationMs,
          succeeded: mapped !== undefined,
          fileSizeBytes: Buffer.byteLength(posting),
        },
      });
    }
  }

  // Only skills that exist, under their real names, each once.
  const byName = new Map(catalogue.map((skill) => [skill.name.toLowerCase(), skill]));
  const skills = new Map<string, ImportedJob["skills"][number]>();
  for (const { name, required } of mapped.skills) {
    const skill = byName.get(name.toLowerCase());
    if (!skill || skills.size >= JOB_LIMITS.skills) continue;
    skills.set(skill.id, { ...skill, isRequired: required || skills.get(skill.id)?.isRequired === true });
  }

  const host = postUrl ? new URL(postUrl).host : null;
  await logEvent({
    type: "job.imported",
    message: "Job posting imported",
    businessId: input.businessId,
    meta: { actorId: input.userId, host, source },
  });

  return {
    fields: {
      title: mapped.title,
      roleOverview: withOtherDetails(mapped.roleOverview, mapped.otherDetails),
      requirements: mapped.requirements,
      idealCandidateProfile: mapped.idealCandidateProfile,
      passingCriteria: mapped.passingCriteria,
    },
    skills: [...skills.values()],
    postUrl,
    host,
    postSnapshot: posting,
    source,
  };
}
