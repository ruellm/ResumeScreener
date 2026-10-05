import "server-only";
import { db } from "@/lib/db";
import { getDrive, isDriveError, type DriveClient } from "./drive";

type Logger = (message: string) => void;

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Deletes a file of ours. Never throws: a file that stays behind is logged.
export async function removeOwnDriveFile(drive: DriveClient, fileId: string, log: Logger) {
  try {
    await drive.deleteFile(fileId);
  } catch (error) {
    if (!isDriveError(error, 404)) log(`Drive file ${fileId} not deleted: ${describe(error)}`);
  }
}

type DriveSubmission = { driveFileId: string | null; resultDriveFileId: string | null };

// Removes what a Drive submission left in the job folder: our result file,
// the note about a failed evaluation, and the uploaded resume if Google lets
// us. The uploader owns that file, so a refusal is normal. Never throws.
export async function removeSubmissionDriveFiles(
  drive: DriveClient,
  submission: DriveSubmission,
  log: Logger,
) {
  if (submission.resultDriveFileId) {
    await removeOwnDriveFile(drive, submission.resultDriveFileId, log);
  }
  if (!submission.driveFileId) return;

  const item = await db.driveIntakeItem.findUnique({
    where: { driveFileId: submission.driveFileId },
    select: { id: true, noteDriveFileId: true },
  });
  if (item?.noteDriveFileId) {
    await removeOwnDriveFile(drive, item.noteDriveFileId, log);
    await db.driveIntakeItem.updateMany({
      where: { id: item.id },
      data: { noteDriveFileId: null },
    });
  }

  try {
    await drive.deleteFile(submission.driveFileId);
  } catch (error) {
    log(
      isDriveError(error, 403, 404)
        ? `Drive file ${submission.driveFileId} left in place: Google did not allow deleting it`
        : `Drive file ${submission.driveFileId} not deleted: ${describe(error)}`,
    );
  }
}

// For the web app, after a submission was deleted. Never throws.
export async function removeDeletedSubmissionFromDrive(submission: DriveSubmission) {
  if (!submission.driveFileId && !submission.resultDriveFileId) return;
  try {
    await removeSubmissionDriveFiles(await getDrive(), submission, console.error);
  } catch (error) {
    console.error(`Drive files of a deleted submission not removed: ${describe(error)}`);
  }
}
