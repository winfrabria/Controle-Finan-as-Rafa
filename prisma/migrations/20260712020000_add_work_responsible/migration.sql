ALTER TABLE "works"
ADD COLUMN "responsible_profile_id" UUID;

CREATE INDEX "works_responsible_profile_id_idx"
ON "works"("responsible_profile_id");

ALTER TABLE "works"
ADD CONSTRAINT "works_responsible_profile_id_fkey"
FOREIGN KEY ("responsible_profile_id") REFERENCES "profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
