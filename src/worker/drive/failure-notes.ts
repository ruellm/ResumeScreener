import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DriveClient } from "@/lib/google/drive";
import { removeOwnDriveFile } from "@/lib/google/drive-cleanup";
import { GoogleNotConnectedError } from "@/lib/google/system-auth";
import { log } from "../config";

const BATCH_SIZE = 50;

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function failureNoteName(fileName: string) {
  return `${fileName.replace(/\.pdf$/i, "")}_FAILED.txt`;
}

type FailedRow = {
  itemId: string;
  fileName: string;
  folderId: string;
  error: string | null;
};

// Tells the uploader, in the job folder, about resumes that could not be
// evaluated, and takes the note away again once a re-evaluation worked.
// A failure older than a day is not written up any more, so a folder that
// cannot be written to is not tried forever. businessIds limits the run.
export async function syncFailureNotes(
  drive: DriveClient,
  { businessIds }: { businessIds?: string[] } = {},
) {
  const scope = businessIds
    ? Prisma.sql`AND i."businessId" IN (${Prisma.join(businessIds)})`
    : Prisma.empty;

  const failed = await db.$queryRaw<FailedRow[]>`
    SELECT i.id AS "itemId", i."fileName", j."driveFolderId" AS "folderId", s.error
    FROM "DriveIntakeItem" i
    JOIN "Submission" s ON s.id = i."submissionId"
    JOIN "Job" j ON j.id = i."jobId"
    WHERE i.status = 'accepted'
      AND i."noteDriveFileId" IS NULL
      AND s.status = 'FAILED'
      AND s."completedAt" > now() - interval '1 day'
      AND j."driveFolderId" IS NOT NULL
      ${scope}
    LIMIT ${BATCH_SIZE}`;

  for (const row of failed) {
    const text = [
      "This resume could not be evaluated.",
      "",
      `File: ${row.fileName}`,
      `Reason: ${row.error ?? "Processing failed."}`,
      `Date: ${new Date().toISOString().slice(0, 10)}`,
      "",
    ].join("\r\n");
    try {
      const noteDriveFileId = await drive.createFile({
        name: failureNoteName(row.fileName),
        parentId: row.folderId,
        mimeType: "text/plain",
        content: Buffer.from(text, "utf8"),
        kind: "note",
      });
      await db.driveIntakeItem.updateMany({
        where: { id: row.itemId, noteDriveFileId: null },
        data: { noteDriveFileId },
      });
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) throw error;
      log(`drive: failure note for ${row.fileName} not written: ${describe(error)}`);
    }
  }

  const recovered = await db.$queryRaw<{ itemId: string; noteDriveFileId: string }[]>`
    SELECT i.id AS "itemId", i."noteDriveFileId"
    FROM "DriveIntakeItem" i
    JOIN "Submission" s ON s.id = i."submissionId"
    WHERE i.status = 'accepted'
      AND i."noteDriveFileId" IS NOT NULL
      AND s.status = 'DONE'
      ${scope}
    LIMIT ${BATCH_SIZE}`;

  for (const row of recovered) {
    await removeOwnDriveFile(drive, row.noteDriveFileId, log);
    await db.driveIntakeItem.updateMany({
      where: { id: row.itemId, noteDriveFileId: row.noteDriveFileId },
      data: { noteDriveFileId: null },
    });
  }

  return { written: failed.length, removed: recovered.length };
}
