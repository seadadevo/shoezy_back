-- DropForeignKey
ALTER TABLE "discount_redemptions" DROP CONSTRAINT "discount_redemptions_user_id_fkey";

-- AlterTable
ALTER TABLE "discount_redemptions" ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_first_name" VARCHAR(100),
ADD COLUMN     "customer_last_name" VARCHAR(100),
ADD COLUMN     "guest_access_token_hash" CHAR(64),
ADD COLUMN     "guest_session_token_hash" CHAR(64),
ALTER COLUMN "customer_email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "order_addresses" ADD COLUMN     "postal_code" VARCHAR(32);

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "shipping_policy" TEXT;

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(100),
    "metadata" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_user_id_created_at_idx" ON "admin_audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_entity_type_entity_id_created_at_idx" ON "admin_audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_guest_access_token_hash_key" ON "orders"("guest_access_token_hash");

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
