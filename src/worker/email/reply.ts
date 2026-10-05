import MailComposer from "nodemailer/lib/mail-composer";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env.server";
import { VERDICT_LABELS } from "@/lib/evaluation-result";
import { jobTitleWithCode } from "@/lib/job-code";
import { loadResultPdf } from "@/lib/result-pdf/store";
import { log } from "../config";
import type { Mailbox } from "./mailbox";
import { REASONS, type SkippedFile } from "./reasons";

export const MAX_REPLY_ATTEMPTS = 5;
export const REPLY_FAILED = "Reply failed";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const RETRY_WAIT_SECONDS = 120;
const FOOTER = "AI-assisted screening. Verify before making hiring decisions.";

type Attachment = { filename: string; content: Buffer };

type Body = { lines: Line[]; attachments: Attachment[] };

// One line of the message. Both the text and the HTML body are made from these.
type Line =
  | { kind: "heading" | "text" | "muted"; text: string }
  | { kind: "item"; text: string }
  | { kind: "link"; url: string }
  | { kind: "gap" };

const text = (value: string): Line => ({ kind: "text", text: value });
const gap: Line = { kind: "gap" };

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toText(lines: Line[]) {
  return lines
    .map((line) => {
      if (line.kind === "gap") return "";
      if (line.kind === "link") return line.url;
      return line.kind === "item" ? `- ${line.text}` : line.text;
    })
    .join("\n");
}

function toHtml(lines: Line[]) {
  const body = lines
    .map((line) => {
      if (line.kind === "gap") return "<br>";
      if (line.kind === "link") {
        const url = escapeHtml(line.url);
        return `<div><a href="${url}">${url}</a></div>`;
      }
      const content = escapeHtml(line.text);
      if (line.kind === "heading") return `<div><strong>${content}</strong></div>`;
      if (line.kind === "muted") return `<div style="color:#666666">${content}</div>`;
      return `<div>${line.kind === "item" ? "&bull; " : ""}${content}</div>`;
    })
    .join("\n");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px">\n${body}\n</div>`;
}

function firstSentence(summary: string) {
  // A capital letter has to follow, so "e.g. five years" does not end the sentence.
  const match = /^[\s\S]*?[.!?](?=\s+[A-Z0-9"'(]|\s*$)/.exec(summary.trim());
  return (match?.[0] ?? summary.trim()).replace(/\s+/g, " ");
}

function skippedLines(skipped: SkippedFile[]): Line[] {
  if (skipped.length === 0) return [];
  return [
    gap,
    { kind: "heading", text: "Skipped files" },
    ...skipped.map((file): Line => ({ kind: "item", text: `${file.filename}: ${file.reason}` })),
  ];
}

function readSkipped(json: unknown): SkippedFile[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((entry) =>
    typeof entry?.filename === "string" && typeof entry?.reason === "string"
      ? [{ filename: entry.filename, reason: entry.reason }]
      : [],
  );
}

type Row = {
  id: string;
  jobId: string | null;
  reason: string | null;
  skippedJson: unknown;
};

// "Title (JOB-XXXXXXXX)", so the sender can tell which job a reply is about.
async function jobLabel(jobId: string | null) {
  if (!jobId) return null;
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { title: true, emailAlias: true },
  });
  return job ? jobTitleWithCode(job) : null;
}

// Null when there is nothing left to report, for example because every
// submission was deleted in the meantime.
async function resultsBody(row: Row): Promise<Body | null> {
  const [job, submissions] = await Promise.all([
    jobLabel(row.jobId),
    db.submission.findMany({
      where: { inboundEmailId: row.id },
      orderBy: { createdAt: "asc" },
      include: { evaluation: true },
    }),
  ]);
  const skipped = readSkipped(row.skippedJson);
  if (submissions.length === 0 && skipped.length === 0) return null;

  const done = submissions.flatMap((submission) =>
    submission.status === "DONE" && submission.evaluation
      ? [{ ...submission, evaluation: submission.evaluation }]
      : [],
  );
  const failed = submissions.filter((submission) => submission.status === "FAILED");

  const lines: Line[] = [{ kind: "heading", text: `Results for ${job ?? "your job"}` }];
  for (const submission of done) {
    const { evaluation } = submission;
    lines.push(
      gap,
      { kind: "heading", text: submission.originalFilename },
      text(`Candidate: ${evaluation.candidateName ?? "Name not found"}`),
      text(
        `Verdict: ${
          evaluation.rejectedForManipulation
            ? "Rejected for manipulation"
            : VERDICT_LABELS[evaluation.verdict]
        }`,
      ),
      text(`Score: ${evaluation.score}`),
      text(firstSentence(evaluation.summary)),
      {
        kind: "link",
        url: new URL(
          `/app/jobs/${submission.jobId}/results/${submission.id}`,
          serverEnv.APP_BASE_URL,
        ).toString(),
      },
    );
  }

  if (failed.length > 0) {
    lines.push(gap, { kind: "heading", text: "Could not be processed" });
    for (const submission of failed) {
      lines.push({
        kind: "item",
        text: `${submission.originalFilename}: ${submission.error ?? "Processing failed."}`,
      });
    }
  }
  lines.push(...skippedLines(skipped));

  let attachments: Attachment[] = [];
  for (const submission of done) {
    attachments.push({
      filename: `${submission.originalFilename.replace(/\.pdf$/i, "")}_RESULTS.pdf`,
      content: await loadResultPdf(submission.id, submission.evaluation.resultPdfKey),
    });
  }
  const totalBytes = attachments.reduce((sum, file) => sum + file.content.length, 0);
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    attachments = [];
    lines.push(
      gap,
      text("The result PDFs are too large to attach. Open the links above to see the results."),
    );
  }

  lines.push(gap, { kind: "muted", text: FOOTER });
  return { lines, attachments };
}

async function errorBody(row: Row): Promise<Body> {
  const job = await jobLabel(row.jobId);
  const lines: Line[] = job ? [{ kind: "heading", text: job }, gap] : [];
  if (row.reason === REASONS.jobClosed) {
    lines.push(text("This job is not accepting resumes."));
    return { lines, attachments: [] };
  }

  lines.push(text("Your email could not be processed."));
  if (row.reason === REASONS.noPdfs) {
    lines.push(text("No PDF attachments were found. Attach the resumes as PDF files and send again."));
  } else if (row.reason === REASONS.noValidPdfs) {
    lines.push(text("None of the attached PDF files could be accepted."));
  } else if (row.reason) {
    lines.push(text(row.reason));
  }
  lines.push(...skippedLines(readSkipped(row.skippedJson)));
  return { lines, attachments: [] };
}

function replySubject(subject: string | null) {
  const original = subject?.trim() || "Resume screening";
  return /^re:/i.test(original) ? original : `Re: ${original}`;
}

// One worker gets each attempt. A failed attempt waits before the next one,
// which also keeps a second worker off a send that is still running.
async function claimAttempt(id: string) {
  const rows = await db.$queryRaw<{ replyAttempts: number }[]>`
    UPDATE "InboundEmail"
    SET "replyAttempts" = "replyAttempts" + 1, "updatedAt" = now()
    WHERE id = ${id}
      AND "replyWanted"
      AND "replySentAt" IS NULL
      AND "replyAttempts" < ${MAX_REPLY_ATTEMPTS}
      AND ("replyAttempts" = 0
           OR "updatedAt" < now() - make_interval(secs => ${RETRY_WAIT_SECONDS}))
    RETURNING "replyAttempts"`;
  return rows[0]?.replyAttempts ?? null;
}

// Sends the reply for one inbound email, if it is still owed. Never throws:
// a failure is counted and the next loop tries again.
export async function sendReply(mailbox: Mailbox, inboundEmailId: string) {
  const attempt = await claimAttempt(inboundEmailId);
  if (attempt === null) return;

  const row = await db.inboundEmail.findUniqueOrThrow({ where: { id: inboundEmailId } });
  try {
    if (!row.fromAddress) throw new Error("No sender address.");
    const body = row.status === "accepted" ? await resultsBody(row) : await errorBody(row);
    if (!body) {
      await db.inboundEmail.update({ where: { id: row.id }, data: { replyWanted: false } });
      return;
    }

    const raw = await new MailComposer({
      from: { name: "Resume Screener", address: serverEnv.GOOGLE_SYSTEM_ACCOUNT },
      to: row.fromAddress,
      subject: replySubject(row.subject),
      inReplyTo: row.rfcMessageId ?? undefined,
      references: row.rfcMessageId ?? undefined,
      // Tells other mail systems not to answer this automatically.
      headers: { "Auto-Submitted": "auto-replied" },
      text: toText(body.lines),
      html: toHtml(body.lines),
      attachments: body.attachments.map((file) => ({
        ...file,
        contentType: "application/pdf",
      })),
    })
      .compile()
      .build();

    await mailbox.send(raw, row.threadId);
    await db.inboundEmail.update({ where: { id: row.id }, data: { replySentAt: new Date() } });
    log(`email ${row.gmailMessageId}: reply sent`);
  } catch (error) {
    log(
      `email ${row.gmailMessageId}: reply failed (attempt ${attempt}/${MAX_REPLY_ATTEMPTS}): ${describe(error)}`,
    );
    if (attempt >= MAX_REPLY_ATTEMPTS) {
      await db.inboundEmail.update({
        where: { id: row.id },
        data: { reason: row.reason ? `${row.reason}. ${REPLY_FAILED}` : REPLY_FAILED },
      });
    }
  }
}

// Replies that are owed now: error replies that did not go out, and results
// for emails whose resumes have all finished.
export async function dueReplies() {
  const rows = await db.inboundEmail.findMany({
    where: {
      status: { in: ["accepted", "rejected"] },
      replySentAt: null,
      replyWanted: true,
      replyAttempts: { lt: MAX_REPLY_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true },
  });

  const due: string[] = [];
  for (const row of rows) {
    if (row.status === "accepted") {
      const unfinished = await db.submission.count({
        where: { inboundEmailId: row.id, status: { notIn: ["DONE", "FAILED"] } },
      });
      if (unfinished > 0) continue;
    }
    due.push(row.id);
  }
  return due;
}
