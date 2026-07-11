-- WIN-15: initial domain for note ingestion, auditing and human validation.
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REVIEWER');
CREATE TYPE "NoteStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'OK', 'PENDING_VALIDATION', 'APPROVED', 'REJECTED', 'READ_FAILED', 'FAILED');
CREATE TYPE "ProcessingStage" AS ENUM ('RECEIVED', 'EXTRACTING', 'ANALYZING', 'FINALIZING', 'COMPLETED', 'FAILED');
CREATE TYPE "NoteClassification" AS ENUM ('OK', 'SUSPICIOUS', 'INCOMPATIBLE');
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED');
CREATE TYPE "ValidationDecision" AS ENUM ('FINDING_CORRECT', 'FALSE_POSITIVE', 'NOTE_VALID', 'SUSPICION_CONFIRMED');
CREATE TYPE "NotificationType" AS ENUM ('VALIDATION_REQUIRED', 'NOTE_PROCESSED', 'NOTE_APPROVED', 'NOTE_REJECTED', 'PROCESSING_FAILED');

CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'REVIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "works" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "works_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "original_file_path" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "original_mime_type" TEXT NOT NULL,
    "original_size_bytes" BIGINT NOT NULL,
    "extracted_data" JSONB,
    "extraction_markdown" TEXT,
    "document_number" TEXT,
    "supplier_name" TEXT,
    "supplier_tax_id" TEXT,
    "issued_at" DATE,
    "total_amount" DECIMAL(14,2),
    "status" "NoteStatus" NOT NULL DEFAULT 'RECEIVED',
    "processing_stage" "ProcessingStage" NOT NULL DEFAULT 'RECEIVED',
    "classification" "NoteClassification",
    "read_confidence" DECIMAL(5,4),
    "failure_code" TEXT,
    "failure_message" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notes_read_confidence_check" CHECK ("read_confidence" IS NULL OR ("read_confidence" >= 0 AND "read_confidence" <= 1)),
    CONSTRAINT "notes_original_size_bytes_check" CHECK ("original_size_bytes" > 0),
    CONSTRAINT "notes_version_check" CHECK ("version" > 0)
);

CREATE TABLE "note_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,4),
    "unit" TEXT,
    "unit_price" DECIMAL(14,4),
    "total_amount" DECIMAL(14,2),
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "note_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "note_items_line_number_check" CHECK ("line_number" > 0)
);

CREATE TABLE "audit_parameters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "value" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMPTZ(6),
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "audit_parameters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_parameters_validity_check" CHECK ("valid_until" IS NULL OR "valid_from" IS NULL OR "valid_until" > "valid_from")
);

CREATE TABLE "audit_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "severity" "FindingSeverity" NOT NULL DEFAULT 'WARNING',
    "configuration" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "audit_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rule_parameters" (
    "rule_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "input_name" TEXT,
    CONSTRAINT "rule_parameters_pkey" PRIMARY KEY ("rule_id", "parameter_id")
);

CREATE TABLE "findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "note_item_id" UUID,
    "rule_id" UUID,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "needs_validation" BOOLEAN NOT NULL DEFAULT true,
    "evidence" JSONB,
    "expected_value" JSONB,
    "actual_value" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "validations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "finding_id" UUID,
    "validator_id" UUID NOT NULL,
    "decision" "ValidationDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "validations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "validations_reason_check" CHECK (length(trim("reason")) > 0)
);

CREATE TABLE "note_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" TEXT NOT NULL,
    "from_status" "NoteStatus",
    "to_status" "NoteStatus",
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "note_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "note_id" UUID,
    "finding_id" UUID,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");
CREATE UNIQUE INDEX "works_code_key" ON "works"("code");
CREATE INDEX "works_active_idx" ON "works"("active");
CREATE INDEX "notes_work_id_created_at_idx" ON "notes"("work_id", "created_at" DESC);
CREATE INDEX "notes_status_created_at_idx" ON "notes"("status", "created_at" DESC);
CREATE INDEX "notes_classification_idx" ON "notes"("classification");
CREATE INDEX "notes_supplier_tax_id_idx" ON "notes"("supplier_tax_id");
CREATE INDEX "notes_document_number_idx" ON "notes"("document_number");
CREATE UNIQUE INDEX "note_items_note_id_line_number_key" ON "note_items"("note_id", "line_number");
CREATE INDEX "note_items_note_id_idx" ON "note_items"("note_id");
CREATE UNIQUE INDEX "audit_parameters_work_id_key_key" ON "audit_parameters"("work_id", "key");
CREATE UNIQUE INDEX "audit_parameters_global_key_key" ON "audit_parameters"("key") WHERE "work_id" IS NULL;
CREATE INDEX "audit_parameters_category_active_idx" ON "audit_parameters"("category", "active");
CREATE UNIQUE INDEX "audit_rules_code_key" ON "audit_rules"("code");
CREATE INDEX "audit_rules_work_id_active_priority_idx" ON "audit_rules"("work_id", "active", "priority");
CREATE INDEX "audit_rules_category_active_idx" ON "audit_rules"("category", "active");
CREATE INDEX "rule_parameters_parameter_id_idx" ON "rule_parameters"("parameter_id");
CREATE INDEX "findings_note_id_status_idx" ON "findings"("note_id", "status");
CREATE INDEX "findings_needs_validation_status_created_at_idx" ON "findings"("needs_validation", "status", "created_at");
CREATE INDEX "findings_rule_id_idx" ON "findings"("rule_id");
CREATE INDEX "validations_note_id_created_at_idx" ON "validations"("note_id", "created_at" DESC);
CREATE INDEX "validations_finding_id_created_at_idx" ON "validations"("finding_id", "created_at" DESC);
CREATE INDEX "validations_validator_id_created_at_idx" ON "validations"("validator_id", "created_at" DESC);
CREATE INDEX "note_events_note_id_created_at_idx" ON "note_events"("note_id", "created_at");
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at" DESC);
CREATE INDEX "notifications_note_id_idx" ON "notifications"("note_id");
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_profile_id_idx" ON "push_subscriptions"("profile_id");

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "note_items" ADD CONSTRAINT "note_items_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_parameters" ADD CONSTRAINT "audit_parameters_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_rules" ADD CONSTRAINT "audit_rules_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rule_parameters" ADD CONSTRAINT "rule_parameters_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "audit_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rule_parameters" ADD CONSTRAINT "rule_parameters_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "audit_parameters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "findings" ADD CONSTRAINT "findings_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "findings" ADD CONSTRAINT "findings_note_item_id_fkey" FOREIGN KEY ("note_item_id") REFERENCES "note_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "findings" ADD CONSTRAINT "findings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "audit_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "validations" ADD CONSTRAINT "validations_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "validations" ADD CONSTRAINT "validations_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "validations" ADD CONSTRAINT "validations_validator_id_fkey" FOREIGN KEY ("validator_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "note_events" ADD CONSTRAINT "note_events_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_events" ADD CONSTRAINT "note_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
