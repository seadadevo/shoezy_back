ALTER TYPE "discount_scope" ADD VALUE IF NOT EXISTS 'VARIANT';
ALTER TYPE "discount_scope" ADD VALUE IF NOT EXISTS 'COLLECTION';
ALTER TYPE "discount_scope" ADD VALUE IF NOT EXISTS 'CATALOG';

ALTER TABLE "discounts"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "archived_at" TIMESTAMPTZ;

ALTER TABLE "discount_targets" DROP CONSTRAINT "discount_targets_exactly_one_target_check";
ALTER TABLE "discount_targets"
  ADD COLUMN "variant_id" UUID,
  ADD COLUMN "collection_id" UUID,
  ADD CONSTRAINT "discount_targets_exactly_one_target_check"
    CHECK (num_nonnulls("product_id", "variant_id", "category_id", "collection_id") = 1),
  ADD CONSTRAINT "discount_targets_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "discount_targets_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "discount_targets_discount_variant_key" ON "discount_targets"("discount_id", "variant_id") WHERE "variant_id" IS NOT NULL;
CREATE UNIQUE INDEX "discount_targets_discount_collection_key" ON "discount_targets"("discount_id", "collection_id") WHERE "collection_id" IS NOT NULL;
CREATE INDEX "discount_targets_variant_id_idx" ON "discount_targets"("variant_id") WHERE "variant_id" IS NOT NULL;
CREATE INDEX "discount_targets_collection_id_idx" ON "discount_targets"("collection_id") WHERE "collection_id" IS NOT NULL;
CREATE INDEX "discounts_eligibility_idx" ON "discounts"("is_active", "archived_at", "starts_at", "ends_at");

ALTER TABLE "discount_redemptions" ADD COLUMN "released_at" TIMESTAMPTZ;
CREATE INDEX "discount_redemptions_active_usage_idx" ON "discount_redemptions"("discount_id", "user_id", "released_at");

CREATE TABLE "discount_translations" (
  "id" UUID NOT NULL,
  "discount_id" UUID NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  CONSTRAINT "discount_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "discount_translations_locale_check" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "discount_translations_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "discount_translations_discount_id_locale_key" ON "discount_translations"("discount_id", "locale");
CREATE INDEX "discount_translations_locale_name_idx" ON "discount_translations"("locale", "name");
CREATE INDEX "discount_translations_name_trgm_idx" ON "discount_translations" USING GIN ("name" gin_trgm_ops);

INSERT INTO "discount_translations" ("id", "discount_id", "locale", "name", "description")
SELECT md5('discount:' || "id"::text || ':en')::uuid, "id", 'en', "name", "description" FROM "discounts"
ON CONFLICT ("discount_id", "locale") DO NOTHING;
