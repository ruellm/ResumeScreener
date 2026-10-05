"use server";

import { requireBusinessUser } from "@/lib/auth";
import { importJobPosting, type ImportedJob } from "@/lib/job-import";
import { ImportError } from "@/lib/job-import/errors";
import { parseImportInput } from "@/lib/job-import/input";

export type ImportJobResult =
  | { ok: true; imported: ImportedJob }
  // openPaste: the link could not be used, so the paste box is the way on.
  | { ok: false; error: string; openPaste: boolean };

const PASTE_INSTEAD = ["unreachable", "blocked", "notAllowed", "tooLarge", "notHtml", "siteBlocked"];

export async function importJob(input: unknown): Promise<ImportJobResult> {
  const user = await requireBusinessUser();

  const parsed = parseImportInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error, openPaste: false };

  try {
    const imported = await importJobPosting({
      businessId: user.business.id,
      userId: user.id,
      ...parsed.request,
    });
    return { ok: true, imported };
  } catch (error) {
    if (error instanceof ImportError) {
      return { ok: false, error: error.message, openPaste: PASTE_INSTEAD.includes(error.code) };
    }
    console.error("importJob failed:", error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: "The import did not work. Try again or fill in the form manually.",
      openPaste: false,
    };
  }
}
