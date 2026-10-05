import { createHash } from "node:crypto";
import type { Business, Job } from "@prisma/client";
import { db, isUniqueViolation } from "@/lib/db";
import { logEvent } from "@/lib/events";
import {
  FOLDER_MIME_TYPE,
  isDriveError,
  type DriveClient,
  type DriveFile,
} from "@/lib/google/drive";
import { normalizeGmail } from "@/lib/google/normalize-gmail";
import { GoogleNotConnectedError } from "@/lib/google/system-auth";
import { isAllowedEmailSender } from "@/lib/senders";
import { createStoredSubmission, findDuplicates, limitError } from "@/lib/submission-intake";
import { log } from "../config";

const MAX_PAGES_PER_POLL = 20;
const STUCK_AFTER_MINUTES = 15;

export const DRIVE_REASONS = {
  systemAccount: "Uploaded by the system account",
  businessInactive: "Business inactive",
  notAllowed: "Uploader not on the allowed list",
  jobClosed: "This job is not accepting resumes.",
  notPdf: "Only PDF files are accepted.",
  invalidPdf: "File is not a valid PDF.",
  duplicate: "This resume was already submitted to this job.",
  timedOut: "Processing timed out",
} as const;

type JobWithBusiness = Job & { business: Business };

type Outcome =
  | { status: "accepted"; submissionId: string }
  // note: the uploader is told why with a text file next to theirs.
  | { status: "skipped"; reason: string; note: boolean }
  | { status: "error"; reason: string };

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function skip(reason: string, note = true): Outcome {
  return { status: "skipped", reason, note };
}

async function decide(
  drive: DriveClient,
  file: DriveFile,
  job: JobWithBusiness,
  uploader: string | null,
  systemAccount: string,
): Promise<Outcome> {
  if (uploader && normalizeGmail(uploader) === normalizeGmail(systemAccount)) {
    return skip(DRIVE_REASONS.systemAccount, false);
  }
  if (!job.business.isActive) return skip(DRIVE_REASONS.businessInactive, false);
  if (!uploader || !(await isAllowedEmailSender(job.businessId, uploader))) {
    await logEvent({
      type: "drive.rejected",
      message: "Drive file rejected",
      businessId: job.businessId,
      jobId: job.id,
      meta: { driveFileId: file.id, fileName: file.name, uploader, reason: DRIVE_REASONS.notAllowed },
    });
    return skip(DRIVE_REASONS.notAllowed, false);
  }

  if (job.status !== "ACTIVE") return skip(DRIVE_REASONS.jobClosed);
  if (file.mimeType !== "application/pdf") return skip(DRIVE_REASONS.notPdf);

  const settings = await db.settings.findUniqueOrThrow({
    where: { id: 1 },
    select: { maxFileSizeMb: true },
  });
  const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
  const tooLarge = `The file is larger than ${settings.maxFileSizeMb} MB.`;
  if (file.size !== null && file.size > maxBytes) return skip(tooLarge);

  const bytes = await drive.download(file.id);
  if (bytes.length > maxBytes) return skip(tooLarge);
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") return skip(DRIVE_REASONS.invalidPdf);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if ((await findDuplicates(job.id, job.businessId, [sha256])).has(sha256)) {
    return skip(DRIVE_REASONS.duplicate);
  }
  const overLimit = await limitError(job.business, 1, bytes.length);
  if (overLimit) return skip(overLimit);

  const submissionId = await createStoredSubmission({
    jobId: job.id,
    businessId: job.businessId,
    source: "DRIVE",
    originalFilename: file.name.slice(0, 255),
    sha256,
    bytes,
    senderEmail: uploader,
    driveFileId: file.id,
  });
  return { status: "accepted", submissionId };
}

export function noteFileName(fileName: string) {
  return `${fileName.replace(/\.pdf$/i, "")}_SKIPPED.txt`;
}

async function writeNote(drive: DriveClient, file: DriveFile, folderId: string, reason: string) {
  const text = [
    "This file was not screened.",
    "",
    `File: ${file.name}`,
    `Reason: ${reason}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    "",
  ].join("\r\n");
  try {
    return await drive.createFile({
      name: noteFileName(file.name),
      parentId: folderId,
      mimeType: "text/plain",
      content: Buffer.from(text, "utf8"),
      kind: "note",
    });
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) throw error;
    log(`drive ${file.id}: note not written: ${describe(error)}`);
    return null;
  }
}

// Claims the file and handles it. Returns false when another worker has it,
// or it was handled before.
async function processFile(
  drive: DriveClient,
  file: DriveFile,
  job: JobWithBusiness,
  systemAccount: string,
) {
  const uploader = (file.ownerEmail ?? file.lastModifierEmail)?.toLowerCase() ?? null;
  let item: { id: string };
  try {
    item = await db.driveIntakeItem.create({
      data: {
        driveFileId: file.id,
        jobId: job.id,
        businessId: job.businessId,
        fileName: file.name.slice(0, 255),
        uploaderEmail: uploader,
        status: "processing",
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }

  let outcome: Outcome;
  let noteDriveFileId: string | null = null;
  try {
    outcome = await decide(drive, file, job, uploader, systemAccount);
    if (outcome.status === "skipped" && outcome.note) {
      noteDriveFileId = await writeNote(drive, file, job.driveFolderId!, outcome.reason);
    }
  } catch (error) {
    const kept = await db.submission.count({ where: { driveFileId: file.id, jobId: job.id } });
    if (error instanceof GoogleNotConnectedError && kept === 0) {
      // Nothing was taken in yet. The page token has not moved, so the file comes up again.
      await db.driveIntakeItem.delete({ where: { id: item.id } });
      throw error;
    }
    log(`drive ${file.id} error: ${describe(error)}`);
    outcome = { status: "error", reason: `Processing failed: ${describe(error).slice(0, 200)}` };
  }

  const { count } = await db.driveIntakeItem.updateMany({
    where: { id: item.id, status: "processing" },
    data: {
      status: outcome.status,
      reason: outcome.status === "accepted" ? null : outcome.reason,
      submissionId: outcome.status === "accepted" ? outcome.submissionId : null,
      noteDriveFileId,
    },
  });
  if (count === 0) log(`drive ${file.id}: took too long and was already closed`);
  else {
    log(
      `drive ${file.id} ${outcome.status}` +
        (outcome.status === "accepted" ? "" : `: ${outcome.reason}`),
    );
  }
  return true;
}

// Where the place in Drive's list of changes is kept.
export type TokenStore = {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
};

const settingsTokens: TokenStore = {
  async load() {
    const settings = await db.settings.findUniqueOrThrow({
      where: { id: 1 },
      select: { driveChangesPageToken: true },
    });
    return settings.driveChangesPageToken;
  },
  async save(driveChangesPageToken) {
    await db.settings.update({ where: { id: 1 }, data: { driveChangesPageToken } });
  },
};

// Reads what changed in Drive since the last poll and takes in new files in
// job folders. The page token is saved after every page, so a crash repeats
// at most one page. Returns how many files this worker handled.
export async function pollChanges(
  drive: DriveClient,
  { systemAccount, tokens = settingsTokens }: { systemAccount: string; tokens?: TokenStore },
) {
  let token = await tokens.load();
  if (!token) return 0;

  let handled = 0;
  for (let pages = 0; pages < MAX_PAGES_PER_POLL; pages++) {
    let page;
    try {
      page = await drive.listChanges(token);
    } catch (error) {
      if (!isDriveError(error, 400, 410)) throw error;
      // Google no longer knows the token. Changes since the last poll are lost.
      log(`drive: changes token rejected, starting again from now: ${describe(error)}`);
      await tokens.save(await drive.getStartPageToken());
      return handled;
    }

    const files = page.changes.flatMap((change) =>
      !change.removed &&
      change.file &&
      !change.file.trashed &&
      change.file.mimeType !== FOLDER_MIME_TYPE &&
      // Our own results and notes.
      !change.file.appProperties.screener
        ? [change.file]
        : [],
    );
    const jobs = await db.job.findMany({
      where: { driveFolderId: { in: [...new Set(files.flatMap((file) => file.parents))] } },
      include: { business: true },
    });
    for (const file of files) {
      const job = jobs.find((row) => file.parents.includes(row.driveFolderId!));
      if (job && (await processFile(drive, file, job, systemAccount))) handled += 1;
    }

    const next = page.nextPageToken ?? page.newStartPageToken;
    if (next) {
      token = next;
      await tokens.save(token);
    }
    if (!page.nextPageToken) break;
  }
  return handled;
}

// A worker that died mid-file leaves its row in processing.
export async function failStuckDriveItems() {
  const { count } = await db.driveIntakeItem.updateMany({
    where: {
      status: "processing",
      createdAt: { lt: new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000) },
    },
    data: { status: "error", reason: DRIVE_REASONS.timedOut },
  });
  if (count > 0) log(`drive: ${count} file(s) timed out in processing`);
}
