-- Versioned AI Harness persistence. This migration is intentionally generated
-- for review/deploy and must not be applied automatically to the remote database.

CREATE TYPE "AiRunKind" AS ENUM ('EXTRACTION', 'AUDIT');
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ReasoningEffort" AS ENUM ('HIGH', 'XHIGH');
CREATE TYPE "ProcessingJobType" AS ENUM ('FULL_AUDIT');
CREATE TYPE "ProcessingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "FindingSource" AS ENUM ('UNIVERSAL_RULE', 'WORK_RULE', 'AI_DISCOVERY');

ALTER TYPE "NoteClassification" ADD VALUE IF NOT EXISTS 'NO_PARAMETER';

CREATE TABLE "processing_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "note_id" UUID NOT NULL,
  "type" "ProcessingJobType" NOT NULL DEFAULT 'FULL_AUDIT',
  "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" TEXT,
  "last_error_code" TEXT,
  "last_error" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "note_id" UUID NOT NULL,
  "processing_job_id" UUID,
  "kind" "AiRunKind" NOT NULL,
  "status" "AiRunStatus" NOT NULL DEFAULT 'RUNNING',
  "idempotency_key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "provider" TEXT,
  "reasoning_effort" "ReasoningEffort" NOT NULL DEFAULT 'HIGH',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "prompt_tokens" INTEGER,
  "completion_tokens" INTEGER,
  "total_tokens" INTEGER,
  "cost_usd" DECIMAL(14,8),
  "latency_ms" INTEGER,
  "structured_response" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "findings"
  ADD COLUMN "source" "FindingSource" NOT NULL DEFAULT 'UNIVERSAL_RULE',
  ADD COLUMN "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
  ADD COLUMN "justification" TEXT NOT NULL DEFAULT 'Achado anterior à versão do Harness',
  ADD COLUMN "references" JSONB,
  ADD COLUMN "rule_version" TEXT,
  ADD COLUMN "is_novel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "policy_version" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "ai_run_id" UUID;

ALTER TABLE "findings" ALTER COLUMN "justification" DROP DEFAULT;
ALTER TABLE "findings" ALTER COLUMN "policy_version" DROP DEFAULT;

ALTER TABLE "validations"
  ADD COLUMN "note_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "policy_version" TEXT,
  ADD COLUMN "finding_snapshot" JSONB,
  ADD COLUMN "ai_run_id" UUID;

ALTER TABLE "validations" ALTER COLUMN "note_version" DROP DEFAULT;

CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_id" UUID,
  "actor_email" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "request_id" TEXT,
  "data" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "processing_jobs_idempotency_key_key" ON "processing_jobs"("idempotency_key");
CREATE INDEX "processing_jobs_status_available_at_created_at_idx" ON "processing_jobs"("status", "available_at", "created_at");
CREATE INDEX "processing_jobs_note_id_created_at_idx" ON "processing_jobs"("note_id", "created_at" DESC);
CREATE UNIQUE INDEX "ai_runs_idempotency_key_key" ON "ai_runs"("idempotency_key");
CREATE INDEX "ai_runs_note_id_created_at_idx" ON "ai_runs"("note_id", "created_at" DESC);
CREATE INDEX "ai_runs_processing_job_id_idx" ON "ai_runs"("processing_job_id");
CREATE INDEX "ai_runs_status_created_at_idx" ON "ai_runs"("status", "created_at" DESC);
CREATE INDEX "findings_ai_run_id_idx" ON "findings"("ai_run_id");
CREATE INDEX "findings_source_created_at_idx" ON "findings"("source", "created_at");
CREATE INDEX "validations_ai_run_id_idx" ON "validations"("ai_run_id");
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at" DESC);
CREATE INDEX "admin_audit_logs_actor_id_created_at_idx" ON "admin_audit_logs"("actor_id", "created_at" DESC);
CREATE INDEX "admin_audit_logs_entity_type_entity_id_created_at_idx" ON "admin_audit_logs"("entity_type", "entity_id", "created_at" DESC);

ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_note_id_fkey"
  FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_note_id_fkey"
  FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_processing_job_id_fkey"
  FOREIGN KEY ("processing_job_id") REFERENCES "processing_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "findings" ADD CONSTRAINT "findings_ai_run_id_fkey"
  FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "validations" ADD CONSTRAINT "validations_ai_run_id_fkey"
  FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
