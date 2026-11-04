-- AlterTable
ALTER TABLE "homepage_banners"
  ADD COLUMN "desktop_video_url" VARCHAR(500),
  ADD COLUMN "desktop_video_mime_type" VARCHAR(100),
  ADD COLUMN "desktop_video_storage_provider" VARCHAR(40),
  ADD COLUMN "desktop_video_storage_key" VARCHAR(255),
  ADD COLUMN "mobile_video_url" VARCHAR(500),
  ADD COLUMN "mobile_video_mime_type" VARCHAR(100),
  ADD COLUMN "mobile_video_storage_provider" VARCHAR(40),
  ADD COLUMN "mobile_video_storage_key" VARCHAR(255);
