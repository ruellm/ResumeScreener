-- AlterTable
ALTER TABLE "AllowedSender" ADD COLUMN     "driveError" TEXT,
ADD COLUMN     "drivePermissionId" TEXT,
ADD COLUMN     "driveStatus" TEXT;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "driveFolderId" TEXT,
ADD COLUMN     "driveSyncNeeded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "driveWriteAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resultDriveFileId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "driveChangesPageToken" TEXT,
ADD COLUMN     "driveIntakeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "driveLastAuditAt" TIMESTAMP(3),
ADD COLUMN     "driveRootFolderId" TEXT;

-- CreateTable
CREATE TABLE "DriveIntakeItem" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploaderEmail" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "submissionId" TEXT,
    "noteDriveFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveIntakeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveIntakeItem_driveFileId_key" ON "DriveIntakeItem"("driveFileId");

-- CreateIndex
CREATE INDEX "DriveIntakeItem_businessId_createdAt_idx" ON "DriveIntakeItem"("businessId", "createdAt");


ALTER TABLE "DriveIntakeItem" ENABLE ROW LEVEL SECURITY;
