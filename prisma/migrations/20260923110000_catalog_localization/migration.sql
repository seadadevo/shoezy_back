CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "product_translations" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "name" VARCHAR(220) NOT NULL,
  "short_description" VARCHAR(500),
  "description" TEXT,
  "material" VARCHAR(150),
  "seo_title" VARCHAR(255),
  "seo_description" VARCHAR(500),
  CONSTRAINT "product_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_translations_locale_check" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "product_translations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "product_translations_product_id_locale_key" ON "product_translations"("product_id", "locale");
CREATE INDEX "product_translations_locale_name_idx" ON "product_translations"("locale", "name");
CREATE INDEX "product_translations_name_trgm_idx" ON "product_translations" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "product_translations_description_trgm_idx" ON "product_translations" USING GIN ("description" gin_trgm_ops);

CREATE TABLE "brand_translations" (
  "id" UUID NOT NULL, "brand_id" UUID NOT NULL, "locale" VARCHAR(10) NOT NULL, "name" VARCHAR(150) NOT NULL, "description" TEXT,
  CONSTRAINT "brand_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brand_translations_locale_check" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "brand_translations_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "brand_translations_brand_id_locale_key" ON "brand_translations"("brand_id", "locale");
CREATE INDEX "brand_translations_locale_name_idx" ON "brand_translations"("locale", "name");
CREATE INDEX "brand_translations_name_trgm_idx" ON "brand_translations" USING GIN ("name" gin_trgm_ops);

CREATE TABLE "category_translations" (
  "id" UUID NOT NULL, "category_id" UUID NOT NULL, "locale" VARCHAR(10) NOT NULL, "name" VARCHAR(150) NOT NULL, "description" TEXT,
  CONSTRAINT "category_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "category_translations_locale_check" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "category_translations_category_id_locale_key" ON "category_translations"("category_id", "locale");
CREATE INDEX "category_translations_locale_name_idx" ON "category_translations"("locale", "name");
CREATE INDEX "category_translations_name_trgm_idx" ON "category_translations" USING GIN ("name" gin_trgm_ops);

CREATE TABLE "collection_translations" (
  "id" UUID NOT NULL, "collection_id" UUID NOT NULL, "locale" VARCHAR(10) NOT NULL, "name" VARCHAR(150) NOT NULL, "description" TEXT,
  CONSTRAINT "collection_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collection_translations_locale_check" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "collection_translations_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "collection_translations_collection_id_locale_key" ON "collection_translations"("collection_id", "locale");
CREATE INDEX "collection_translations_locale_name_idx" ON "collection_translations"("locale", "name");
CREATE INDEX "collection_translations_name_trgm_idx" ON "collection_translations" USING GIN ("name" gin_trgm_ops);

CREATE TABLE "product_option_translations" (
  "id" UUID NOT NULL, "option_id" UUID NOT NULL, "locale" VARCHAR(10) NOT NULL, "name" VARCHAR(80) NOT NULL,
  CONSTRAINT "product_option_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_option_translations_locale_check" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "product_option_translations_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "product_option_translations_option_id_locale_key" ON "product_option_translations"("option_id", "locale");
CREATE INDEX "product_option_translations_locale_name_idx" ON "product_option_translations"("locale", "name");

CREATE TABLE "product_option_value_translations" (
  "id" UUID NOT NULL, "option_value_id" UUID NOT NULL, "locale" VARCHAR(10) NOT NULL, "display_value" VARCHAR(100) NOT NULL,
  CONSTRAINT "product_option_value_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_option_value_translations_locale_check" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "product_option_value_translations_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "product_option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "product_option_value_translations_option_value_id_locale_key" ON "product_option_value_translations"("option_value_id", "locale");
CREATE INDEX "product_option_value_translations_locale_display_value_idx" ON "product_option_value_translations"("locale", "display_value");

INSERT INTO "product_translations" ("id", "product_id", "locale", "name", "short_description", "description", "material", "seo_title", "seo_description")
SELECT md5('product:' || "id"::text || ':en')::uuid, "id", 'en', "name", "short_description", "description", "material", "seo_title", "seo_description" FROM "products"
ON CONFLICT ("product_id", "locale") DO NOTHING;
INSERT INTO "brand_translations" ("id", "brand_id", "locale", "name", "description")
SELECT md5('brand:' || "id"::text || ':en')::uuid, "id", 'en', "name", "description" FROM "brands"
ON CONFLICT ("brand_id", "locale") DO NOTHING;
INSERT INTO "category_translations" ("id", "category_id", "locale", "name", "description")
SELECT md5('category:' || "id"::text || ':en')::uuid, "id", 'en', "name", "description" FROM "categories"
ON CONFLICT ("category_id", "locale") DO NOTHING;
INSERT INTO "collection_translations" ("id", "collection_id", "locale", "name", "description")
SELECT md5('collection:' || "id"::text || ':en')::uuid, "id", 'en', "name", "description" FROM "collections"
ON CONFLICT ("collection_id", "locale") DO NOTHING;
INSERT INTO "product_option_translations" ("id", "option_id", "locale", "name")
SELECT md5('option:' || "id"::text || ':en')::uuid, "id", 'en', "name" FROM "product_options"
ON CONFLICT ("option_id", "locale") DO NOTHING;
INSERT INTO "product_option_value_translations" ("id", "option_value_id", "locale", "display_value")
SELECT md5('option-value:' || "id"::text || ':en')::uuid, "id", 'en', COALESCE("display_value", "value") FROM "product_option_values"
ON CONFLICT ("option_value_id", "locale") DO NOTHING;
