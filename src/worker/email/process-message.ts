import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, isUniqueViolation } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { GoogleNotConnectedError } from "@/lib/google/system-auth";
import { isAllowedSender } from "@/lib/senders";
import { createStoredSubmission, findDuplicates, limitError } from "@/lib/submission-intake";
import { log } from "../config";
import type { Labels, Mailbox, MailMessage } from "./mailbox";
import {
  ignoreReason,
  jobAliases,
  parseFrom,
  pdfParts,
  readHeaders,
  storedSubject,
  type PdfPart,
} from "./parse-message";
import { REASONS, type SkippedFile } from "./reasons";
import { sendReply } from "./reply";
import { verifySender } from "./verify-sender";

export const MAX_PDFS_PER_EMAIL = 20;

export type IntakeContext = { mailbox: Mailbox; labels: Labels; systemAccount: string };

type Outcome =
  | { status: "accepted" }
  | { status: "ignored" | "error"; reason: string }
  // reply: the sender is verified and allowed, so they are told why.
  | { status: "rejected"; reason: string; reply: boolean };

type Fields = Prisma.InboundEmailUpdateManyMutationInput;

type AcceptedFile = { filename: string; bytes: Buffer; sha256: string };

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reject(reason: string, reply = false): Outcome {
  return { status: "rejected", reason, reply };
}

async function readPdf(mailbox: Mailbox, messageId: string, part: PdfPart) {
  if (part.data) return Buffer.from(part.data, "base64url");
  return mailbox.getAttachment(messageId, part.attachmentId!);
}

// Sorts the attached PDFs into files to take and files to skip, each with a reason.
async function checkFiles(
  mailbox: Mailbox,
  message: MailMessage,
  parts: PdfPart[],
  job: { id: string; businessId: string },
  maxFileSizeMb: number,
) {
  const maxBytes = maxFileSizeMb * 1024 * 1024;
  const tooLarge = `The file is larger than ${maxFileSizeMb} MB.`;
  const skipped: SkippedFile[] = [];
  const files: AcceptedFile[] = [];
  const skip = (part: PdfPart, reason: string) => skipped.push({ filename: part.filename, reason });

  for (const [index, part] of parts.entries()) {
    if (index >= MAX_PDFS_PER_EMAIL) {
      skip(part, `Only the first ${MAX_PDFS_PER_EMAIL} PDF files in an email are processed.`);
      continue;
    }
    if (part.size > maxBytes) {
      skip(part, tooLarge);
      continue;
    }
    const bytes = await readPdf(mailbox, message.id, part);
    if (bytes.length === 0) skip(part, "The file is empty.");
    else if (bytes.length > maxBytes) skip(part, tooLarge);
    else if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
      skip(part, "File is not a valid PDF.");
    } else {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (files.some((file) => file.sha256 === sha256)) {
        skip(part, "This file is in the email more than once.");
      } else {
        files.push({ filename: part.filename, bytes, sha256 });
      }
    }
  }

  const earlier = await findDuplicates(
    job.id,
    job.businessId,
    files.map((file) => file.sha256),
  );
  const fresh = files.filter((file) => {
    if (!earlier.has(file.sha256)) return true;
    skipped.push({
      filename: file.filename,
      reason: "This resume was already submitted to this job.",
    });
    return false;
  });
  return { files: fresh, skipped };
}

// Steps in order; the first one that fails decides. Writes what it learns
// into fields as it goes, so a rejected row still shows who sent what.
async function decide(
  ctx: IntakeContext,
  gmailMessageId: string,
  inboundEmailId: string,
  fields: Fields,
): Promise<Outcome> {
  const message = await ctx.mailbox.getMessage(gmailMessageId);
  const headers = readHeaders(message);
  const from = parseFrom(headers);

  fields.subject = storedSubject(headers);
  fields.rfcMessageId = headers.first("Message-ID")?.trim() || null;
  fields.fromAddress = from;
  const internalDate = Number(message.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) fields.receivedAt = new Date(internalDate);

  const ignored = ignoreReason(headers, ctx.systemAccount);
  if (ignored) return { status: "ignored", reason: ignored };

  if (!from) return reject(REASONS.invalidFrom);

  const auth = verifySender(headers.all("Authentication-Results"), from);
  fields.authSummaryJson = auth as Prisma.InputJsonObject;
  if (!auth.verifiedBy) return reject(REASONS.unverified);

  const aliases = jobAliases(headers, ctx.systemAccount);
  const jobs = await db.job.findMany({
    where: { emailAlias: { in: aliases } },
    include: { business: true },
  });
  const job = aliases.flatMap((alias) => jobs.find((row) => row.emailAlias === alias) ?? [])[0];
  if (!job) return reject(REASONS.noJob);

  fields.businessId = job.businessId;
  fields.jobId = job.id;
  if (!job.business.isActive) return reject(REASONS.businessInactive);
  if (!(await isAllowedSender(job.businessId, from))) return reject(REASONS.notAllowed);

  if (job.status !== "ACTIVE") return reject(REASONS.jobClosed, true);

  const parts = pdfParts(message);
  fields.pdfCount = parts.length;
  if (parts.length === 0) return reject(REASONS.noPdfs, true);

  const settings = await db.settings.findUniqueOrThrow({
    where: { id: 1 },
    select: { maxFileSizeMb: true },
  });
  const { files, skipped } = await checkFiles(
    ctx.mailbox,
    message,
    parts,
    job,
    settings.maxFileSizeMb,
  );
  fields.skippedJson = skipped as Prisma.InputJsonArray;

  if (files.length > 0) {
    const batchBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
    const overLimit = await limitError(job.business, files.length, batchBytes);
    if (overLimit) return reject(overLimit, true);
  }

  let accepted = 0;
  for (const file of files) {
    try {
      await createStoredSubmission({
        jobId: job.id,
        businessId: job.businessId,
        source: "EMAIL",
        originalFilename: file.filename,
        sha256: file.sha256,
        bytes: file.bytes,
        senderEmail: from,
        emailMessageId: message.id,
        inboundEmailId,
      });
      accepted += 1;
    } catch (error) {
      log(`email ${message.id}: ${file.filename} not stored: ${describe(error)}`);
      skipped.push({ filename: file.filename, reason: "The file could not be stored. Send it again." });
    }
    fields.acceptedCount = accepted;
  }

  if (accepted === 0) return reject(REASONS.noValidPdfs, true);
  return { status: "accepted" };
}

function labelChange(labels: Labels, status: string) {
  // Ignored and failed messages stay unread so someone looks at them.
  if (status === "accepted") return { add: [labels.processed], remove: ["UNREAD"] };
  if (status === "rejected") return { add: [labels.rejected], remove: ["UNREAD"] };
  return { add: [labels.rejected] };
}

async function applyLabel(ctx: IntakeContext, gmailMessageId: string, status: string) {
  try {
    await ctx.mailbox.modifyMessage(gmailMessageId, labelChange(ctx.labels, status));
  } catch (error) {
    // The next poll sees the message again and labels it then.
    log(`email ${gmailMessageId}: label not applied: ${describe(error)}`);
  }
}

async function logOutcome(id: string, fields: Fields, outcome: Outcome) {
  if (typeof fields.businessId !== "string") return;
  const scope = {
    businessId: fields.businessId,
    jobId: typeof fields.jobId === "string" ? fields.jobId : undefined,
  };
  const from = typeof fields.fromAddress === "string" ? fields.fromAddress : null;

  if (outcome.status === "accepted") {
    await logEvent({
      ...scope,
      type: "email.accepted",
      message: "Email accepted",
      meta: { inboundEmailId: id, from, count: Number(fields.acceptedCount ?? 0) },
    });
  } else if (outcome.status === "rejected") {
    await logEvent({
      ...scope,
      type: "email.rejected",
      message: "Email rejected",
      meta: { inboundEmailId: id, from, reason: outcome.reason },
    });
  }
}

// Claims the message and handles it. Returns false when another worker has
// it, or it was handled before.
export async function processMessage(
  ctx: IntakeContext,
  ref: { id: string; threadId: string },
): Promise<boolean> {
  let row: { id: string };
  try {
    row = await db.inboundEmail.create({
      data: {
        gmailMessageId: ref.id,
        threadId: ref.threadId,
        receivedAt: new Date(),
        status: "processing",
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.inboundEmail.findUnique({
      where: { gmailMessageId: ref.id },
      select: { status: true },
    });
    // Finished earlier but still listed: its label never got applied.
    if (existing && existing.status !== "processing") {
      await applyLabel(ctx, ref.id, existing.status);
    }
    return false;
  }

  const fields: Fields = {};
  let outcome: Outcome;
  try {
    outcome = await decide(ctx, ref.id, row.id, fields);
  } catch (error) {
    const kept = await db.submission.count({ where: { inboundEmailId: row.id } });
    if (error instanceof GoogleNotConnectedError && kept === 0) {
      // Nothing was taken in yet, so the message is picked up again later.
      await db.inboundEmail.delete({ where: { id: row.id } });
      throw error;
    }
    log(`email ${ref.id} error: ${describe(error)}`);
    outcome = { status: "error", reason: `Processing failed: ${describe(error).slice(0, 200)}` };
  }

  const replyWanted = outcome.status === "accepted" || (outcome.status === "rejected" && outcome.reply);
  const { count } = await db.inboundEmail.updateMany({
    where: { id: row.id, status: "processing" },
    data: {
      ...fields,
      status: outcome.status,
      reason: outcome.status === "accepted" ? null : outcome.reason,
      replyWanted,
    },
  });
  if (count === 0) {
    log(`email ${ref.id}: took too long and was already closed, result dropped`);
    return true;
  }

  log(
    `email ${ref.id} ${outcome.status}` +
      (outcome.status === "accepted"
        ? ` (${Number(fields.acceptedCount ?? 0)} of ${Number(fields.pdfCount ?? 0)} PDFs)`
        : `: ${outcome.reason}`),
  );
  await applyLabel(ctx, ref.id, outcome.status);
  await logOutcome(row.id, fields, outcome);

  if (outcome.status === "rejected" && outcome.reply) await sendReply(ctx.mailbox, row.id);
  return true;
}
