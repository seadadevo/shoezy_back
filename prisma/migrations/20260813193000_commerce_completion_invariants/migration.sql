-- Extend review moderation states.
ALTER TYPE "review_status" ADD VALUE 'APPROVED';
ALTER TYPE "review_status" ADD VALUE 'REJECTED';

-- Discount precedence is explicit: lower values have higher precedence.
-- This deliberately has no default; existing rows require an approved value.
ALTER TABLE "discounts" ADD COLUMN "priority" INTEGER NOT NULL;

-- Historical orders may remain NULL; every new customer order supplies a key.
ALTER TABLE "orders" ADD COLUMN "idempotency_key" VARCHAR(128);

CREATE UNIQUE INDEX "discounts_priority_key"
  ON "discounts"("priority");

ALTER TABLE "discounts"
  ADD CONSTRAINT "discounts_priority_nonnegative_check"
  CHECK ("priority" >= 0);

CREATE UNIQUE INDEX "orders_idempotency_key_key"
  ON "orders"("idempotency_key");

CREATE UNIQUE INDEX "product_media_one_primary_per_product_key"
  ON "product_media"("product_id")
  WHERE "is_primary" = true;

ALTER TABLE "collections"
  ADD CONSTRAINT "collections_valid_date_window_check"
  CHECK (
    "ends_at" IS NULL
    OR "starts_at" IS NULL
    OR "ends_at" > "starts_at"
  );

CREATE UNIQUE INDEX "carts_one_active_per_user_key"
  ON "carts"("user_id")
  WHERE "user_id" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "discount_targets"
  ADD CONSTRAINT "discount_targets_exactly_one_target_check"
  CHECK (num_nonnulls("product_id", "category_id") = 1);

CREATE UNIQUE INDEX "discount_targets_discount_product_key"
  ON "discount_targets"("discount_id", "product_id")
  WHERE "product_id" IS NOT NULL;

CREATE UNIQUE INDEX "discount_targets_discount_category_key"
  ON "discount_targets"("discount_id", "category_id")
  WHERE "category_id" IS NOT NULL;

CREATE UNIQUE INDEX "discount_redemptions_discount_id_order_id_key"
  ON "discount_redemptions"("discount_id", "order_id");
