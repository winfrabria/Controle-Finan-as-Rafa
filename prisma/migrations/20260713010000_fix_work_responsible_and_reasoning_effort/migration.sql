ALTER TYPE "ReasoningEffort" ADD VALUE IF NOT EXISTS 'MAX' BEFORE 'HIGH';

ALTER TABLE "works"
ADD COLUMN IF NOT EXISTS "responsible_name" TEXT;

UPDATE "works" AS work
SET "responsible_name" = COALESCE(profile."full_name", profile."email")
FROM "profiles" AS profile
WHERE work."responsible_profile_id" = profile."id"
  AND work."responsible_name" IS NULL;
