/*
  Warnings:

  - Added the required column `evidenceVerified` to the `Evaluation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `jobSnapshotJson` to the `Evaluation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "candidateEmail" TEXT,
ADD COLUMN     "candidateName" TEXT,
ADD COLUMN     "candidatePhone" TEXT,
ADD COLUMN     "evidenceVerified" BOOLEAN NOT NULL,
ADD COLUMN     "jobSnapshotJson" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "durationMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "succeeded" BOOLEAN NOT NULL DEFAULT true;
