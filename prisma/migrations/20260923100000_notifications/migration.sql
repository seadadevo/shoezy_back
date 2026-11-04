CREATE TYPE "notification_type" AS ENUM (
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'RETURN_REQUESTED',
  'RETURN_STATUS_UPDATED',
  'EXCHANGE_REQUESTED',
  'EXCHANGE_STATUS_UPDATED',
  'REVIEW_PENDING',
  'LOW_STOCK'
);

CREATE TYPE "notification_audience" AS ENUM ('USER', 'ADMIN');

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "type" "notification_type" NOT NULL,
  "entity_type" VARCHAR(50) NOT NULL,
  "entity_id" VARCHAR(100) NOT NULL,
  "template_key" VARCHAR(100) NOT NULL,
  "template_params" JSONB NOT NULL,
  "metadata" JSONB,
  "read_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "deduplication_key" VARCHAR(255) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "notifications_recipient_user_id_deduplication_key_key" ON "notifications"("recipient_user_id", "deduplication_key");
CREATE INDEX "notifications_recipient_user_id_created_at_idx" ON "notifications"("recipient_user_id", "created_at");
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx" ON "notifications"("recipient_user_id", "read_at", "created_at");
CREATE INDEX "notifications_type_created_at_idx" ON "notifications"("type", "created_at");

CREATE TABLE "notification_outbox" (
  "id" UUID NOT NULL,
  "audience" "notification_audience" NOT NULL,
  "recipient_user_id" UUID,
  "recipient_permission" VARCHAR(120),
  "type" "notification_type" NOT NULL,
  "entity_type" VARCHAR(50) NOT NULL,
  "entity_id" VARCHAR(100) NOT NULL,
  "template_key" VARCHAR(100) NOT NULL,
  "template_params" JSONB NOT NULL,
  "metadata" JSONB,
  "deduplication_key" VARCHAR(255) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ,
  "processed_at" TIMESTAMPTZ,
  "last_error" VARCHAR(500),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_outbox_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_outbox_audience_recipient_check" CHECK (
    ("audience" = 'USER' AND "recipient_user_id" IS NOT NULL AND "recipient_permission" IS NULL)
    OR
    ("audience" = 'ADMIN' AND "recipient_user_id" IS NULL AND "recipient_permission" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "notification_outbox_deduplication_key_key" ON "notification_outbox"("deduplication_key");
CREATE INDEX "notification_outbox_processed_at_available_at_locked_at_idx" ON "notification_outbox"("processed_at", "available_at", "locked_at");
CREATE INDEX "notification_outbox_recipient_user_id_idx" ON "notification_outbox"("recipient_user_id");
