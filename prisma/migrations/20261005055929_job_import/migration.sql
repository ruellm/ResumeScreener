-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'evaluation',
ALTER COLUMN "jobId" DROP NOT NULL,
ALTER COLUMN "source" DROP NOT NULL;

