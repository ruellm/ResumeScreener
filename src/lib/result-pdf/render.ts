import path from "node:path";
import type { Evaluation, Submission } from "@prisma/client";
import PDFDocument from "pdfkit";
import {
  FLAG_TEXTS,
  hadHiddenText,
  ITEM_STATUS_LABELS,
  MANIPULATION_REVIEW_NOTE,
  parseEvaluationResult,
  parseJobSnapshot,
  REJECTION_TITLE,
  verdictLabel,
} from "@/lib/evaluation-result";

export type ResultPdfInput = {
  evaluation: Pick<
    Evaluation,
    | "verdict"
    | "score"
    | "summary"
    | "resultJson"
    | "jobSnapshotJson"
    | "candidateName"
    | "candidateEmail"
    | "candidatePhone"
    | "evidenceVerified"
    | "rejectedForManipulation"
    | "preRejectionScore"
  >;
  submission: Pick<Submission, "originalFilename" | "hiddenTextFlagsJson">;
  generatedAt: Date;
};

// Liberation Sans is embedded for all text. pdfkit's built-in Helvetica only
// covers a small character set and is not embedded in the file.
const FONT_DIR = path.join(process.cwd(), "src", "lib", "result-pdf", "fonts");
const REGULAR = path.join(FONT_DIR, "LiberationSans-Regular.ttf");
const BOLD = path.join(FONT_DIR, "LiberationSans-Bold.ttf");

const MARGIN = 50;
const FOOTER_SPACE = 70;
const DISCLAIMER = "AI-assisted screening. Verify before making hiring decisions.";
const CELL_PADDING = 6;
const RED = "#b91c1c";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

type Doc = PDFKit.PDFDocument;
type Column = { header: string; width: number };

function contentWidth(doc: Doc) {
  return doc.page.width - MARGIN * 2;
}

function heading(doc: Doc, text: string) {
  // Keep a heading together with at least a little of what follows it.
  if (doc.y > doc.page.height - FOOTER_SPACE - 60) doc.addPage();
  doc.moveDown(0.9).font(BOLD).fontSize(12).text(text, MARGIN);
  doc.moveDown(0.3).font(REGULAR).fontSize(10);
}

function bullets(doc: Doc, items: string[]) {
  if (items.length === 0) {
    doc.text("None.", MARGIN);
    return;
  }
  const width = contentWidth(doc) - 12;
  for (const item of items) {
    if (doc.y + doc.heightOfString(item, { width }) > doc.page.height - FOOTER_SPACE) {
      doc.addPage();
    }
    const top = doc.y;
    doc.text("•", MARGIN, top, { lineBreak: false });
    doc.text(item, MARGIN + 12, top, { width });
  }
  doc.x = MARGIN;
}

function table(doc: Doc, columns: Column[], rows: string[][]) {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

  const drawRow = (cells: string[], font: string) => {
    doc.font(font).fontSize(9);
    const height =
      Math.max(
        ...cells.map((text, index) =>
          doc.heightOfString(text || " ", { width: columns[index].width - CELL_PADDING }),
        ),
      ) + CELL_PADDING;
    if (doc.y + height > doc.page.height - FOOTER_SPACE) doc.addPage();

    const top = doc.y;
    let left = MARGIN;
    cells.forEach((text, index) => {
      doc.text(text, left, top + CELL_PADDING / 2, {
        width: columns[index].width - CELL_PADDING,
      });
      left += columns[index].width;
    });
    doc
      .moveTo(MARGIN, top + height)
      .lineTo(MARGIN + totalWidth, top + height)
      .lineWidth(0.5)
      .stroke();
    doc.x = MARGIN;
    doc.y = top + height;
  };

  drawRow(
    columns.map((column) => column.header),
    BOLD,
  );
  rows.forEach((cells) => drawRow(cells, REGULAR));
  doc.font(REGULAR).fontSize(10);
}

function quoted(evidence: string | null) {
  return evidence ? `"${evidence}"` : "";
}

// The one place the result uses colour: a red box for a rejected resume.
function rejectionBanner(doc: Doc, quotes: string[], scoreBefore: number | null) {
  doc.moveDown(0.8);
  const top = doc.y;
  const left = MARGIN + 10;
  const width = contentWidth(doc) - 20;

  doc.fillColor(RED).font(BOLD).fontSize(12).text(REJECTION_TITLE, left, top + 8, { width });
  doc.fillColor("black").font(REGULAR).fontSize(10).moveDown(0.2);
  quotes.forEach((quote) => doc.text(quoted(quote), left, doc.y, { width }));
  if (scoreBefore !== null) {
    doc.moveDown(0.2).text(`Score before rejection: ${scoreBefore}`, left, doc.y, { width });
  }

  const bottom = doc.y + 8;
  doc.rect(MARGIN, top, contentWidth(doc), bottom - top).lineWidth(1).strokeColor(RED).stroke();
  doc.strokeColor("black");
  doc.x = MARGIN;
  doc.y = bottom;
}

function footers(doc: Doc, filename: string) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    // Text below the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    const top = doc.page.height - 45;
    const width = contentWidth(doc);
    doc.font(REGULAR).fontSize(8);
    doc.text(DISCLAIMER, MARGIN, top, { width, lineBreak: false });
    doc.text(filename, MARGIN, top + 11, { width: width - 90, lineBreak: false, ellipsis: true });
    doc.text(`Page ${index + 1} of ${range.count}`, MARGIN, top + 11, {
      width,
      align: "right",
      lineBreak: false,
    });
  }
}

export function renderResultPdf({
  evaluation,
  submission,
  generatedAt,
}: ResultPdfInput): Promise<Buffer> {
  const result = parseEvaluationResult(evaluation.resultJson);
  const snapshot = parseJobSnapshot(evaluation.jobSnapshotJson);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
      bufferPages: true,
      font: REGULAR,
      info: { Title: "Resume Screening Result" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font(BOLD).fontSize(18).text("Resume Screening Result");
    doc.font(REGULAR).fontSize(11);
    if (snapshot.title) doc.text(snapshot.title);
    doc.fontSize(9).text(`Generated ${dateFormat.format(generatedAt)} UTC`);

    const { rejectedForManipulation: rejected } = evaluation;
    if (rejected) {
      rejectionBanner(
        doc,
        result.manipulationAttempts
          .filter((attempt) => attempt.kind !== "other")
          .map((attempt) => attempt.quote),
        evaluation.preRejectionScore,
      );
    }

    const contact = [evaluation.candidateEmail, evaluation.candidatePhone].filter(Boolean);
    if (evaluation.candidateName || contact.length > 0) {
      heading(doc, "Candidate");
      if (evaluation.candidateName) doc.font(BOLD).text(evaluation.candidateName).font(REGULAR);
      contact.forEach((line) => doc.text(line as string));
    }

    heading(doc, "Verdict");
    doc
      .font(BOLD)
      .fontSize(14)
      .text(`${verdictLabel(evaluation.verdict, rejected)}   Score ${evaluation.score} of 100`);
    doc.font(REGULAR).fontSize(10).moveDown(0.4).text(evaluation.summary);

    const hiddenText = hadHiddenText(submission.hiddenTextFlagsJson);
    // A rejected resume shows its quotes in the banner at the top instead.
    const unverifiedAttempts = !rejected && result.manipulationAttempts.length > 0;
    if (unverifiedAttempts || hiddenText || !evaluation.evidenceVerified) {
      heading(doc, "Flags");
      if (unverifiedAttempts) {
        doc.text(FLAG_TEXTS.manipulation);
        for (const attempt of result.manipulationAttempts) {
          doc.text(quoted(attempt.quote), MARGIN + 12, doc.y, {
            width: contentWidth(doc) - 12,
          });
        }
        doc.x = MARGIN;
        if (result.guardNotes.includes(MANIPULATION_REVIEW_NOTE)) {
          doc.text(MANIPULATION_REVIEW_NOTE, MARGIN);
        }
        doc.moveDown(0.4);
      }
      if (hiddenText) doc.text(FLAG_TEXTS.hiddenText, MARGIN).moveDown(0.4);
      if (!evaluation.evidenceVerified) doc.text(FLAG_TEXTS.vision, MARGIN);
    }

    heading(doc, "Requirements");
    table(
      doc,
      [
        { header: "Requirement", width: 150 },
        { header: "Status", width: 55 },
        { header: "Evidence", width: 150 },
        { header: "Note", width: 140 },
      ],
      result.requirements.map((item) => [
        item.requirement,
        ITEM_STATUS_LABELS[item.status],
        quoted(item.evidence),
        item.note,
      ]),
    );

    heading(doc, "Skills");
    table(
      doc,
      [
        { header: "Skill", width: 150 },
        { header: "Type", width: 65 },
        { header: "Status", width: 55 },
        { header: "Evidence", width: 225 },
      ],
      result.skills.map((item) => [
        item.skill,
        item.required ? "Required" : "Optional",
        ITEM_STATUS_LABELS[item.status],
        quoted(item.evidence),
      ]),
    );

    heading(doc, "Strengths");
    bullets(doc, result.strengths);

    heading(doc, "Gaps");
    bullets(doc, result.gaps);

    footers(doc, submission.originalFilename);
    doc.end();
  });
}
