import { z } from "zod";
import { isHttpUrl, JOB_LIMITS } from "@/lib/job-schema";

export const PASTE_MIN_CHARS = 200;
export const PASTE_MAX_CHARS = 30_000;

const urlSchema = z.object({
  url: z.string().trim().min(1, "Enter the address of the job post.").max(JOB_LIMITS.postUrl),
});

const textSchema = z.object({
  text: z
    .string()
    .trim()
    .min(PASTE_MIN_CHARS, `Paste at least ${PASTE_MIN_CHARS} characters of the job description.`)
    .max(PASTE_MAX_CHARS, `Paste at most ${PASTE_MAX_CHARS} characters.`),
  // Where the pasted text came from. Stored as the job's link, never fetched.
  sourceUrl: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .trim()
      .max(JOB_LIMITS.postUrl, `The link must be at most ${JOB_LIMITS.postUrl} characters.`)
      .refine(isHttpUrl, "The link must start with http:// or https://.")
      .optional(),
  ),
});

export type ImportRequest =
  | { url: string; text?: undefined; sourceUrl?: undefined }
  | { text: string; sourceUrl?: string; url?: undefined };

type Parsed = { ok: true; request: ImportRequest } | { ok: false; error: string };

// A link to fetch, or pasted text with an optional link to keep. Never both.
export function parseImportInput(input: unknown): Parsed {
  const given = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const hasUrl = given.url !== undefined && given.url !== null;
  const hasText = given.text !== undefined && given.text !== null;
  if (hasUrl === hasText) {
    return { ok: false, error: "Give either a link or the text of the job post." };
  }

  const parsed = hasUrl ? urlSchema.safeParse(given) : textSchema.safeParse(given);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return { ok: true, request: parsed.data };
}
