import { db } from "@/lib/db";
import { getDrive, isDriveError, type DriveClient } from "@/lib/google/drive";
import { GoogleNotConnectedError } from "@/lib/google/system-auth";
import { renderCurrentResultPdf } from "@/lib/result-pdf/store";
import { log } from "../config";

export const MAX_WRITE_ATTEMPTS = 5;

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function resultFileName(originalFilename: string) {
  return `${originalFilename.replace(/\.pdf$/i, "")}_RESULTS.pdf`;
}

// Evaluations of Drive resumes whose result PDF is not in the job folder yet.
export async function dueWriteBacks() {
  const rows = await db.evaluation.findMany({
    where: {
      resultDriveFileId: null,
      driveWriteAttempts: { lt: MAX_WRITE_ATTEMPTS },
      submission: { source: "DRIVE", status: "DONE", job: { driveFolderId: { not: null } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

// Puts the result PDF next to the resume. A re-evaluation is a new evaluation
// row, so the file of the earlier one is found by its tag and overwritten.
// A failure is counted and the next poll tries again.
export async function writeBackResult(drive: DriveClient, evaluationId: string) {
  const evaluation = await db.evaluation.findUnique({
    where: { id: evaluationId },
    select: {
      id: true,
      resultDriveFileId: true,
      driveWriteAttempts: true,
      submission: {
        select: { id: true, originalFilename: true, job: { select: { driveFolderId: true } } },
      },
    },
  });
  const folderId = evaluation?.submission.job.driveFolderId;
  if (!evaluation || !folderId || evaluation.resultDriveFileId) return;
  const { submission } = evaluation;

  // One worker gets each attempt.
  const attempt = evaluation.driveWriteAttempts + 1;
  const claimed = await db.evaluation.updateMany({
    where: {
      id: evaluation.id,
      resultDriveFileId: null,
      driveWriteAttempts: { equals: evaluation.driveWriteAttempts, lt: MAX_WRITE_ATTEMPTS },
    },
    data: { driveWriteAttempts: attempt },
  });
  if (claimed.count === 0) return;

  try {
    const pdf = await renderCurrentResultPdf(submission.id);
    const tags = { submission: submission.id };
    const [existing] = await drive.findOwnFiles(folderId, tags);

    let fileId = existing;
    if (existing) {
      await drive.updateFileContent(existing, "application/pdf", pdf);
    } else {
      fileId = await drive.createFile({
        name: resultFileName(submission.originalFilename),
        parentId: folderId,
        mimeType: "application/pdf",
        content: pdf,
        kind: "result",
        tags,
      });
    }
    await db.evaluation.updateMany({
      where: { id: evaluation.id },
      data: { resultDriveFileId: fileId },
    });
    log(`${submission.id} result ${existing ? "updated" : "written"} in Drive`);
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) {
      // Not the file's fault, so the try does not count.
      await db.evaluation.updateMany({
        where: { id: evaluation.id, driveWriteAttempts: attempt },
        data: { driveWriteAttempts: attempt - 1 },
      });
      throw error;
    }
    const gone = isDriveError(error, 404) ? " (is the job folder gone?)" : "";
    log(
      `${submission.id} result not written to Drive, attempt ${attempt}/${MAX_WRITE_ATTEMPTS}${gone}: ${describe(error)}`,
    );
  }
}

// Right after a Drive resume was evaluated. Never throws: the poll retries.
export async function writeBackSubmission(submissionId: string) {
  try {
    const [settings, evaluation] = await Promise.all([
      db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { driveIntakeEnabled: true } }),
      db.evaluation.findUnique({ where: { submissionId }, select: { id: true } }),
    ]);
    if (!settings.driveIntakeEnabled || !evaluation) return;
    await writeBackResult(await getDrive(), evaluation.id);
  } catch (error) {
    log(`${submissionId} result not written to Drive: ${describe(error)}`);
  }
}
