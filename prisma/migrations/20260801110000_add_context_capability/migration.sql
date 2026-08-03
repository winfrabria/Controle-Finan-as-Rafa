-- Context questions, one reanalysis round and scoped public capability cookies.
-- This migration is versioned locally for review only; do not apply remotely here.

CREATE TYPE "AuditResult" AS ENUM ('OK', 'SUSPICIOUS', 'NEEDS_CONTEXT', 'READ_FAILED');
CREATE TYPE "ContextQuestionType" AS ENUM ('TEXT', 'NUMBER', 'SINGLE_SELECT', 'BOOLEAN');
CREATE TYPE "ContextSubmissionStatus" AS ENUM ('SUBMITTED', 'REANALYSIS_QUEUED', 'REANALYSIS_COMPLETED', 'REANALYSIS_FAILED');

ALTER TYPE "ProcessingJobType" ADD VALUE IF NOT EXISTS 'CONTEXT_REANALYSIS';

ALTER TABLE "notes"
  ADD COLUMN "audit_result" "AuditResult",
  ADD COLUMN "context_round" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "context_submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "context_summary" TEXT,
  ADD COLUMN "public_protocol" TEXT,
  ADD COLUMN "public_token_hash" TEXT,
  ADD COLUMN "public_token_expires_at" TIMESTAMPTZ(6);

UPDATE "notes"
SET
  "public_protocol" = COALESCE("public_protocol", 'LEGACY-' || "id"::text),
  "public_token_hash" = COALESCE("public_token_hash", md5(gen_random_uuid()::text)),
  "public_token_expires_at" = COALESCE("public_token_expires_at", TIMESTAMPTZ 'epoch');

ALTER TABLE "notes"
  ALTER COLUMN "public_protocol" SET NOT NULL,
  ALTER COLUMN "public_token_hash" SET NOT NULL,
  ALTER COLUMN "public_token_expires_at" SET NOT NULL;

CREATE UNIQUE INDEX "notes_public_protocol_key" ON "notes"("public_protocol");
CREATE INDEX "notes_audit_result_created_at_idx" ON "notes"("audit_result", "created_at" DESC);

CREATE TABLE "note_context_questions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "note_id" UUID NOT NULL,
  "ai_run_id" UUID,
  "round" INTEGER NOT NULL DEFAULT 1,
  "position" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "type" "ContextQuestionType" NOT NULL,
  "options" JSONB NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "rationale" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_context_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "note_context_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "note_id" UUID NOT NULL,
  "round" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "answer_fingerprint" TEXT NOT NULL,
  "request_id" TEXT,
  "status" "ContextSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reanalysis_queued_at" TIMESTAMPTZ(6),
  "reanalysis_completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "note_context_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "note_context_answers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "question_id" UUID NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_context_answers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "processing_jobs" ADD COLUMN "context_submission_id" UUID;

CREATE UNIQUE INDEX "note_context_questions_note_id_round_position_key"
  ON "note_context_questions"("note_id", "round", "position");
CREATE UNIQUE INDEX "note_context_questions_note_id_round_code_key"
  ON "note_context_questions"("note_id", "round", "code");
CREATE INDEX "note_context_questions_note_id_round_idx"
  ON "note_context_questions"("note_id", "round");
CREATE UNIQUE INDEX "note_context_submissions_idempotency_key_key"
  ON "note_context_submissions"("idempotency_key");
CREATE UNIQUE INDEX "note_context_submissions_note_id_round_key"
  ON "note_context_submissions"("note_id", "round");
CREATE INDEX "note_context_submissions_note_id_submitted_at_idx"
  ON "note_context_submissions"("note_id", "submitted_at" DESC);
CREATE UNIQUE INDEX "processing_jobs_context_submission_id_key"
  ON "processing_jobs"("context_submission_id");
CREATE UNIQUE INDEX "note_context_answers_submission_id_question_id_key"
  ON "note_context_answers"("submission_id", "question_id");
CREATE INDEX "note_context_answers_question_id_idx"
  ON "note_context_answers"("question_id");

ALTER TABLE "note_context_questions" ADD CONSTRAINT "note_context_questions_note_id_fkey"
  FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_context_questions" ADD CONSTRAINT "note_context_questions_ai_run_id_fkey"
  FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "note_context_submissions" ADD CONSTRAINT "note_context_submissions_note_id_fkey"
  FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_context_answers" ADD CONSTRAINT "note_context_answers_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "note_context_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_context_answers" ADD CONSTRAINT "note_context_answers_question_id_fkey"
  FOREIGN KEY ("question_id") REFERENCES "note_context_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_context_submission_id_fkey"
  FOREIGN KEY ("context_submission_id") REFERENCES "note_context_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
