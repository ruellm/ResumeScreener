-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "emailIntakeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailIntakeSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "inboundEmailId" TEXT;

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "rfcMessageId" TEXT,
    "fromAddress" TEXT,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT,
    "jobId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "authSummaryJson" JSONB,
    "pdfCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedJson" JSONB,
    "replyWanted" BOOLEAN NOT NULL DEFAULT false,
    "replyAttempts" INTEGER NOT NULL DEFAULT 0,
    "replySentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_gmailMessageId_key" ON "InboundEmail"("gmailMessageId");

-- CreateIndex
CREATE INDEX "InboundEmail_businessId_createdAt_idx" ON "InboundEmail"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundEmail_status_replySentAt_idx" ON "InboundEmail"("status", "replySentAt");

-- CreateIndex
CREATE INDEX "Submission_inboundEmailId_idx" ON "Submission"("inboundEmailId");

ALTER TABLE "InboundEmail" ENABLE ROW LEVEL SECURITY;
