-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "preRejectionScore" INTEGER,
ADD COLUMN     "preRejectionVerdict" "Verdict",
ADD COLUMN     "rejectedForManipulation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "hasHiddenText" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: rows whose flags say hidden text was removed.
UPDATE "Submission"
SET "hasHiddenText" = true
WHERE jsonb_typeof("hiddenTextFlagsJson") = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("hiddenTextFlagsJson") AS flag
    WHERE flag ->> 'dropped' = 'true'
  );
