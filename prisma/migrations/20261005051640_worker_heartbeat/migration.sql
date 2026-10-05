-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "lastDrivePollAt" TIMESTAMP(3),
ADD COLUMN     "lastMailPollAt" TIMESTAMP(3),
ADD COLUMN     "workerSeenAt" TIMESTAMP(3);

