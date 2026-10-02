import { createHash } from "node:crypto";
import type { ExtractionMethod, Prisma, Submission } from "@prisma/client";
import { db } from "@/lib/db";
import { PermanentError } from "../errors";
import { extractPdfWithFlags, type ResumeExtraction } from "../extraction/hidden-text";
import { rasterizePdf } from "../extraction/rasterize";
import { cleanText, EXTRACTED_TEXT_MAX_CHARS } from "../extraction/text";
import { downloadResume } from "../storage";

// With less visible text than this the PDF is treated as a scan.
const VISION_MIN_TEXT_CHARS = 200;

export type Extraction = {
  // Computed from the stored bytes. Replaces the hash the browser sent.
  sha256: string;
  hasHiddenText: boolean;
  extractionMethod: ExtractionMethod;
  extractedText: string | null;
  hiddenTextFlagsJson: Prisma.InputJsonArray;
  extractionMeta: Prisma.InputJsonObject;
};

async function parse(buffer: Buffer): Promise<ResumeExtraction> {
  try {
    return await extractPdfWithFlags(buffer);
  } catch (error) {
    // The same bytes fail the same way every time, so these never retry.
    // There is no fallback to an unscanned extraction: text that was not
    // checked for hidden content must not be stored.
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PermanentError("PDF is password protected.", { cause: error });
    }
    throw new PermanentError("PDF could not be read.", { cause: error });
  }
}

function capText(text: string) {
  let capped = text.slice(0, EXTRACTED_TEXT_MAX_CHARS);
  // Do not end on half of a surrogate pair.
  const last = capped.charCodeAt(capped.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) capped = capped.slice(0, -1);
  return capped;
}

export async function extract(
  submission: Pick<Submission, "storageKey">,
): Promise<Extraction> {
  const buffer = await downloadResume(submission.storageKey);

  const settings = await db.settings.findUniqueOrThrow({
    where: { id: 1 },
    select: { maxFileSizeMb: true },
  });
  if (buffer.length > settings.maxFileSizeMb * 1024 * 1024) {
    throw new PermanentError("File exceeds the size limit.");
  }
  if (buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new PermanentError("File is not a valid PDF.");
  }

  const parsed = await parse(buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const hiddenTextFlagsJson = parsed.flags as unknown as Prisma.InputJsonArray;
  // Only flags whose text was removed. A kept OCR layer is not hidden text.
  const hasHiddenText = parsed.flags.some((flag) => flag.dropped);

  // Counted without the page markers, which would push a long scan over the
  // threshold with no real text in it.
  const visibleChars = cleanText(parsed.visiblePages.join("\n")).length;
  if (visibleChars < VISION_MIN_TEXT_CHARS) {
    // The images are not kept. The evaluate stage renders them again.
    const images = await rasterizePdf(buffer);
    return {
      sha256,
      hasHiddenText,
      extractionMethod: "VISION",
      extractedText: null,
      hiddenTextFlagsJson,
      extractionMeta: {
        pageCount: parsed.pageCount,
        charCount: visibleChars,
        truncated: false,
        visionPages: images.length,
      },
    };
  }

  const text = cleanText(parsed.visibleText);
  const truncated = text.length > EXTRACTED_TEXT_MAX_CHARS;
  return {
    sha256,
    hasHiddenText,
    extractionMethod: "TEXT",
    extractedText: truncated ? capText(text) : text,
    hiddenTextFlagsJson,
    extractionMeta: {
      pageCount: parsed.pageCount,
      charCount: text.length,
      truncated,
      visionPages: 0,
    },
  };
}
