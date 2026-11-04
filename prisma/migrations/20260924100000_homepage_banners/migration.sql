-- CreateEnum
CREATE TYPE "homepage_banner_placement" AS ENUM ('HERO_SLIDER', 'TOP_BAR', 'MIDDLE_BANNER', 'SIDE_BANNER');

-- CreateTable
CREATE TABLE "homepage_banners" (
    "id" UUID NOT NULL,
    "placement" "homepage_banner_placement" NOT NULL DEFAULT 'HERO_SLIDER',
    "cta_url" VARCHAR(500),
    "desktop_image_url" VARCHAR(500),
    "mobile_image_url" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "promotion_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "homepage_banners_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "homepage_banners_date_window_check" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"),
    CONSTRAINT "homepage_banners_sort_order_check" CHECK ("sort_order" >= 0)
);

-- CreateTable
CREATE TABLE "homepage_banner_translations" (
    "id" UUID NOT NULL,
    "banner_id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "subtitle" VARCHAR(255),
    "description" TEXT,
    "cta_label" VARCHAR(100),

    CONSTRAINT "homepage_banner_translations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "homepage_banner_translations_locale_check" CHECK ("locale" IN ('ar', 'en'))
);

-- CreateIndex
CREATE INDEX "homepage_banners_placement_is_active_sort_order_idx" ON "homepage_banners"("placement", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "homepage_banners_promotion_id_idx" ON "homepage_banners"("promotion_id");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_banner_translations_banner_id_locale_key" ON "homepage_banner_translations"("banner_id", "locale");

-- CreateIndex
CREATE INDEX "homepage_banner_translations_locale_title_idx" ON "homepage_banner_translations"("locale", "title");

-- CreateIndex
CREATE INDEX "homepage_banner_translations_title_trgm_idx" ON "homepage_banner_translations" USING GIN ("title" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "homepage_banners" ADD CONSTRAINT "homepage_banners_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "discounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_banner_translations" ADD CONSTRAINT "homepage_banner_translations_banner_id_fkey" FOREIGN KEY ("banner_id") REFERENCES "homepage_banners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
