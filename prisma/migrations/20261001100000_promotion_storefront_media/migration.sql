ALTER TABLE "discounts"
  ADD COLUMN "image_url" VARCHAR(500),
  ADD COLUMN "image_storage_provider" VARCHAR(40),
  ADD COLUMN "image_storage_key" VARCHAR(255),
  ADD COLUMN "show_on_storefront" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cta_url" VARCHAR(500);

ALTER TABLE "discounts"
  ADD CONSTRAINT "discounts_sort_order_check" CHECK ("sort_order" >= 0);

CREATE INDEX "discounts_show_on_storefront_is_active_sort_order_idx"
  ON "discounts"("show_on_storefront", "is_active", "sort_order");
