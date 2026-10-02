-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPERADMIN', 'BUSINESS');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubmissionSource" AS ENUM ('WEB', 'EMAIL', 'DRIVE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('RECEIVED', 'QUEUED', 'EXTRACTING', 'EVALUATING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('TEXT', 'VISION');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('PASS', 'MAYBE', 'FAIL');

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "defaultRetentionDays" INTEGER NOT NULL DEFAULT 180,
    "minRetentionDays" INTEGER NOT NULL DEFAULT 180,
    "maxRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
    "evalModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "retentionDays" INTEGER,
    "monthlyEvalLimit" INTEGER,
    "storageLimitMb" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL,
    "businessId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowedSender" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "roleOverview" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "idealCandidateProfile" TEXT NOT NULL,
    "passingCriteria" TEXT NOT NULL,
    "postUrl" TEXT,
    "postSnapshot" TEXT,
    "postFetchedAt" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailAlias" TEXT NOT NULL,
    "driveFolderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSkill" (
    "jobId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSkill_pkey" PRIMARY KEY ("jobId","skillId")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "source" "SubmissionSource" NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT,
    "sha256" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "senderEmail" TEXT,
    "emailMessageId" TEXT,
    "driveFileId" TEXT,
    "extractedText" TEXT,
    "extractionMethod" "ExtractionMethod",
    "hiddenTextFlagsJson" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "score" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "manipulationAttemptsJson" JSONB,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "resultPdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "source" "SubmissionSource" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "verdict" "Verdict",
    "fileSizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "jobId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedSender_businessId_email_key" ON "AllowedSender"("businessId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Job_emailAlias_key" ON "Job"("emailAlias");

-- CreateIndex
CREATE INDEX "Job_businessId_status_idx" ON "Job"("businessId", "status");

-- CreateIndex
CREATE INDEX "Submission_jobId_sha256_idx" ON "Submission"("jobId", "sha256");

-- CreateIndex
CREATE INDEX "Submission_jobId_receivedAt_idx" ON "Submission"("jobId", "receivedAt");

-- CreateIndex
CREATE INDEX "Submission_businessId_receivedAt_idx" ON "Submission"("businessId", "receivedAt");

-- CreateIndex
CREATE INDEX "Submission_driveFileId_idx" ON "Submission"("driveFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_submissionId_key" ON "Evaluation"("submissionId");

-- CreateIndex
CREATE INDEX "UsageRecord_businessId_createdAt_idx" ON "UsageRecord"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_businessId_createdAt_idx" ON "EventLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_type_createdAt_idx" ON "EventLog"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowedSender" ADD CONSTRAINT "AllowedSender_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
