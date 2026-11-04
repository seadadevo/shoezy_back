ALTER TYPE "notification_type" ADD VALUE 'SUPPORT_REQUEST';

CREATE TYPE "support_conversation_status" AS ENUM ('OPEN', 'PENDING', 'CLOSED');
CREATE TYPE "support_sender_type" AS ENUM ('CUSTOMER', 'ADMIN');

CREATE TABLE "support_conversations" (
  "id" UUID NOT NULL,
  "reference" VARCHAR(40) NOT NULL,
  "user_id" UUID,
  "guest_name" VARCHAR(120) NOT NULL,
  "guest_phone" VARCHAR(32) NOT NULL,
  "guest_email" VARCHAR(320),
  "order_id" UUID,
  "status" "support_conversation_status" NOT NULL DEFAULT 'OPEN',
  "guest_access_token_hash" CHAR(64),
  "admin_unread_count" INTEGER NOT NULL DEFAULT 0,
  "customer_unread_count" INTEGER NOT NULL DEFAULT 0,
  "admin_notification_generation" INTEGER NOT NULL DEFAULT 0,
  "admin_last_read_at" TIMESTAMPTZ,
  "customer_last_read_at" TIMESTAMPTZ,
  "last_message_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "closed_at" TIMESTAMPTZ,
  CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "support_conversations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "support_conversations_admin_unread_nonnegative" CHECK ("admin_unread_count" >= 0),
  CONSTRAINT "support_conversations_customer_unread_nonnegative" CHECK ("customer_unread_count" >= 0)
);
CREATE UNIQUE INDEX "support_conversations_reference_key" ON "support_conversations"("reference");
CREATE UNIQUE INDEX "support_conversations_guest_access_token_hash_key" ON "support_conversations"("guest_access_token_hash");
CREATE INDEX "support_conversations_status_last_message_at_idx" ON "support_conversations"("status", "last_message_at");
CREATE INDEX "support_conversations_last_message_at_idx" ON "support_conversations"("last_message_at");
CREATE INDEX "support_conversations_user_id_last_message_at_idx" ON "support_conversations"("user_id", "last_message_at");
CREATE INDEX "support_conversations_order_id_idx" ON "support_conversations"("order_id");
CREATE INDEX "support_conversations_admin_unread_count_last_message_at_idx" ON "support_conversations"("admin_unread_count", "last_message_at");

CREATE TABLE "support_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "sender_type" "support_sender_type" NOT NULL,
  "sender_user_id" UUID,
  "body" VARCHAR(2000) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "support_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "support_messages_body_nonempty" CHECK (length(btrim("body")) > 0)
);
CREATE INDEX "support_messages_conversation_id_created_at_id_idx" ON "support_messages"("conversation_id", "created_at", "id");
