CREATE TABLE "note_reads" (
    "profile_id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_reads_pkey" PRIMARY KEY ("profile_id", "note_id")
);

CREATE INDEX "note_reads_note_id_read_at_idx" ON "note_reads"("note_id", "read_at");

ALTER TABLE "note_reads" ADD CONSTRAINT "note_reads_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_reads" ADD CONSTRAINT "note_reads_note_id_fkey"
    FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
