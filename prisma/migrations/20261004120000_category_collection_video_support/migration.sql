-- AlterTable
ALTER TABLE "categories"
  ADD COLUMN "video_url" VARCHAR(500),
  ADD COLUMN "video_mime_type" VARCHAR(100),
  ADD COLUMN "video_storage_provider" VARCHAR(40),
  ADD COLUMN "video_storage_key" VARCHAR(255);

-- AlterTable
ALTER TABLE "collections"
  ADD COLUMN "video_url" VARCHAR(500),
  ADD COLUMN "video_mime_type" VARCHAR(100),
  ADD COLUMN "video_storage_provider" VARCHAR(40),
  ADD COLUMN "video_storage_key" VARCHAR(255);
