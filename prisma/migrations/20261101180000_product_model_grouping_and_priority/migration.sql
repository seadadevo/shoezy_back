-- AlterTable: Expand phase (nullable group_id)
ALTER TABLE "products" ADD COLUMN "group_id" UUID;
ALTER TABLE "products" ADD COLUMN "color_name" VARCHAR(100);
ALTER TABLE "products" ADD COLUMN "color_hex" VARCHAR(7);
ALTER TABLE "products" ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- Backfill phase: each existing product becomes its own model group
UPDATE "products" SET "group_id" = "id" WHERE "group_id" IS NULL;

-- AlterTable: Contract phase (enforce NOT NULL)
ALTER TABLE "products" ALTER COLUMN "group_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "products_group_id_idx" ON "products"("group_id");

-- CreateIndex
CREATE INDEX "products_status_priority_published_at_idx" ON "products"("status", "priority" DESC, "published_at" DESC);

-- Partial Unique Index: prevent duplicate color within the same group (excluding deleted and null colors)
CREATE UNIQUE INDEX "products_group_color_uniq"
  ON "products" ("group_id", lower("color_name"))
  WHERE "deleted_at" IS NULL AND "color_name" IS NOT NULL;

