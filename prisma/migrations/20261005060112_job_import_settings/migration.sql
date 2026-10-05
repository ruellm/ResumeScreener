-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "importDailyLimit" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "importModel" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001';

