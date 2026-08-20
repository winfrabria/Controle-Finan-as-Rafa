CREATE TYPE "PushDeliveryStatus" AS ENUM (
    'PENDING',
    'SENDING',
    'ACCEPTED',
    'FAILED',
    'CANCELLED'
);

CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 4,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" TEXT,
    "accepted_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_deliveries_notification_id_subscription_id_key"
    ON "push_deliveries"("notification_id", "subscription_id");

CREATE UNIQUE INDEX "push_deliveries_event_key_subscription_id_key"
    ON "push_deliveries"("event_key", "subscription_id");

CREATE INDEX "push_deliveries_status_available_at_created_at_idx"
    ON "push_deliveries"("status", "available_at", "created_at");

CREATE INDEX "push_deliveries_subscription_id_created_at_idx"
    ON "push_deliveries"("subscription_id", "created_at" DESC);

ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "push_subscriptions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
