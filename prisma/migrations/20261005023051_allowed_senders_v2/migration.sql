ALTER TABLE "AllowedSender"
  ADD COLUMN "kind" TEXT,
  ADD COLUMN "value" TEXT,
  ADD COLUMN "display" TEXT,
  ADD COLUMN "createdById" TEXT;

-- Existing rows become email entries. Gmail addresses lose dots and +tags, as in normalizeGmail.
UPDATE "AllowedSender"
SET "kind" = 'email',
    "display" = btrim("email"),
    "createdById" = '',
    "value" = CASE
      WHEN split_part(lower(btrim("email")), '@', 2) IN ('gmail.com', 'googlemail.com')
        THEN replace(split_part(split_part(lower(btrim("email")), '@', 1), '+', 1), '.', '')
          || '@' || split_part(lower(btrim("email")), '@', 2)
      ELSE lower(btrim("email"))
    END;

-- Two old rows can now mean the same address. The oldest stays.
DELETE FROM "AllowedSender" a
USING "AllowedSender" b
WHERE a."businessId" = b."businessId"
  AND a."value" = b."value"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

ALTER TABLE "AllowedSender"
  ALTER COLUMN "kind" SET NOT NULL,
  ALTER COLUMN "value" SET NOT NULL,
  ALTER COLUMN "display" SET NOT NULL,
  ALTER COLUMN "createdById" SET NOT NULL;

DROP INDEX "AllowedSender_businessId_email_key";

ALTER TABLE "AllowedSender" DROP COLUMN "email";

CREATE UNIQUE INDEX "AllowedSender_businessId_kind_value_key" ON "AllowedSender"("businessId", "kind", "value");
