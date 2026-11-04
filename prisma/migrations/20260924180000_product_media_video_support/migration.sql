-- CreateEnum
CREATE TYPE "product_media_type" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "product_media" ADD COLUMN "media_type" "product_media_type" NOT NULL DEFAULT 'IMAGE';
ALTER TABLE "product_media" ADD COLUMN "mime_type" VARCHAR(100);
ALTER TABLE "product_media" ALTER COLUMN "type" SET DEFAULT 'IMAGE';

-- Backfill media_type from existing type
UPDATE "product_media" SET "media_type" = 'VIDEO'::"product_media_type" WHERE "type" = 'VIDEO'::"media_type";

-- Ensure VIDEO cannot be primary cover at database level
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_video_cannot_be_primary"
  CHECK ("media_type" != 'VIDEO' OR "is_primary" = false);

-- Ensure at most one VIDEO per product at database level
CREATE UNIQUE INDEX "product_media_one_video_per_product_key"
  ON "product_media"("product_id")
  WHERE "media_type" = 'VIDEO' OR "type" = 'VIDEO';
