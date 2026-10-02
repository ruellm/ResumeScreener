import { z } from "zod";

// Readers for the JSON columns written by the worker. They never throw: a
// field that is missing or has the wrong shape falls back to an empty value,
// so an old or odd row still renders.

const ITEM_STATUSES = ["MET", "PARTIAL", "NOT_MET", "UNCLEAR"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  MET: "Met",
  PARTIAL: "Partial",
  NOT_MET: "Not met",
  UNCLEAR: "Unclear",
};

export const VERDICT_LABELS = { PASS: "Pass", MAYBE: "Maybe", FAIL: "Fail" } as const;

// A resume rejected for manipulation is stored as FAIL but shown as Rejected.
export function verdictLabel(verdict: keyof typeof VERDICT_LABELS, rejected: boolean) {
  return rejected ? "Rejected" : VERDICT_LABELS[verdict];
}

export const REJECTION_TITLE = "Rejected: AI manipulation attempt";
export const REJECTION_REASON = "AI manipulation attempt";

// Put in front of the model's summary when a resume is rejected.
export const MANIPULATION_REJECTION_SUMMARY =
  "Rejected: this resume contains instructions addressed to an AI reviewer, which is treated as cheating.";

// The guard note, and the notice shown, when the text was only seen in page images.
export const MANIPULATION_REVIEW_NOTE =
  "Possible manipulation text found in page images; could not be verified. Review manually.";

// What the model says a recorded attempt is. Only the first two can reject a
// resume. "other" is kept for a person to look at.
export const MANIPULATION_KINDS = ["addresses_reviewer", "dictates_outcome", "other"] as const;
export type ManipulationKind = (typeof MANIPULATION_KINDS)[number];

export const MANIPULATION_NOTED_NOTE = "Possible manipulation text noted, not used for rejection";
export const FORMULA_IGNORED_NOTE = "Spreadsheet formula ignored";

// The same three notices on the result page and in the result PDF.
export const FLAG_TEXTS = {
  manipulation:
    "This resume contained text addressed to an AI reviewer. It was ignored in scoring.",
  hiddenText: "Hidden text was found in this PDF and removed before evaluation.",
  vision:
    "This resume was read from page images. Evidence quotes could not be checked against the text.",
};

const status = z.enum(ITEM_STATUSES).catch("UNCLEAR");
const evidence = z.string().nullable().catch(null);

const resultSchema = z.object({
  requirements: z
    .array(
      z.object({
        requirement: z.string().catch(""),
        status,
        evidence,
        note: z.string().catch(""),
      }),
    )
    .catch([]),
  skills: z
    .array(
      z.object({
        skill: z.string().catch(""),
        required: z.boolean().catch(false),
        status,
        evidence,
      }),
    )
    .catch([]),
  strengths: z.array(z.string()).catch([]),
  gaps: z.array(z.string()).catch([]),
  manipulationAttempts: z
    .array(
      z.object({
        quote: z.string().catch(""),
        // Missing on results from before attempts were classified.
        kind: z.enum(MANIPULATION_KINDS).optional().catch(undefined),
      }),
    )
    .catch([]),
  guardNotes: z.array(z.string()).catch([]),
});

export type EvaluationResult = z.infer<typeof resultSchema>;

export function parseEvaluationResult(json: unknown): EvaluationResult {
  return resultSchema.parse(typeof json === "object" && json !== null ? json : {});
}

// True when the extractor dropped hidden text from this resume.
export function hadHiddenText(hiddenTextFlagsJson: unknown) {
  return (
    Array.isArray(hiddenTextFlagsJson) &&
    hiddenTextFlagsJson.some(
      (flag) => (flag as { dropped?: unknown } | null)?.dropped === true,
    )
  );
}

// block is the job text the model was given.
export type JobSnapshot = { title: string | null; block: string | null };

export function parseJobSnapshot(json: unknown): JobSnapshot {
  const snapshot = (typeof json === "object" && json !== null ? json : {}) as {
    title?: unknown;
    block?: unknown;
  };

  const block = typeof snapshot.block === "string" ? snapshot.block : null;
  // Snapshots written before the title was stored only have it inside the block.
  const fromBlock = block ? (/<title>\n([\s\S]*?)\n<\/title>/.exec(block)?.[1] ?? null) : null;

  return {
    title: typeof snapshot.title === "string" ? snapshot.title : fromBlock,
    block,
  };
}

export function requiredSkillsMet(result: EvaluationResult) {
  const required = result.skills.filter((skill) => skill.required);
  const met = required.filter((skill) => skill.status === "MET").length;
  return `${met} of ${required.length}`;
}
