-- Additive assurance/feedback support for the selective verifier.
-- Versioned locally for review. Do not apply to a remote database here.

ALTER TYPE "AiRunKind" ADD VALUE IF NOT EXISTS 'VERIFICATION';
ALTER TYPE "FindingSource" ADD VALUE IF NOT EXISTS 'AI_VERIFICATION';

CREATE TYPE "AuditAssuranceBand" AS ENUM ('HIGH', 'MEDIUM', 'LIMITED');
CREATE TYPE "AuditFeedbackVerdict" AS ENUM (
  'CORRECT',
  'FALSE_ALERT',
  'MISSED_ISSUE',
  'INSUFFICIENT_EVIDENCE'
);
CREATE TYPE "AuditFeedbackStatus" AS ENUM (
  'PENDING_REVIEW',
  'ACKNOWLEDGED',
  'DISMISSED'
);

ALTER TABLE "notes"
  ADD COLUMN "original_file_sha256" VARCHAR(64),
  ADD COLUMN "original_page_count" INTEGER,
  ADD COLUMN "assurance_band" "AuditAssuranceBand",
  ADD COLUMN "assurance_reason" TEXT,
  ADD COLUMN "assurance_version" TEXT;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_original_file_sha256_check"
    CHECK (
      "original_file_sha256" IS NULL OR
      "original_file_sha256" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "notes_original_page_count_check"
    CHECK (
      "original_page_count" IS NULL OR
      "original_page_count" > 0
    );

CREATE TABLE "audit_feedbacks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "note_id" UUID NOT NULL,
  "note_version" INTEGER NOT NULL,
  "ai_run_id" UUID,
  "actor_id" UUID NOT NULL,
  "verdict" "AuditFeedbackVerdict" NOT NULL,
  "reason_code" TEXT NOT NULL,
  "comment" TEXT,
  "status" "AuditFeedbackStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "resolution_note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "audit_feedbacks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "audit_feedbacks_note_id_note_version_actor_id_key"
  ON "audit_feedbacks"("note_id", "note_version", "actor_id");
CREATE INDEX "audit_feedbacks_note_id_note_version_idx"
  ON "audit_feedbacks"("note_id", "note_version");
CREATE INDEX "audit_feedbacks_actor_id_created_at_idx"
  ON "audit_feedbacks"("actor_id", "created_at" DESC);
CREATE INDEX "audit_feedbacks_status_created_at_idx"
  ON "audit_feedbacks"("status", "created_at" DESC);
CREATE INDEX "audit_feedbacks_ai_run_id_idx"
  ON "audit_feedbacks"("ai_run_id");

ALTER TABLE "audit_feedbacks"
  ADD CONSTRAINT "audit_feedbacks_note_id_fkey"
    FOREIGN KEY ("note_id") REFERENCES "notes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "audit_feedbacks_ai_run_id_fkey"
    FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "audit_feedbacks_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "audit_feedbacks_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
