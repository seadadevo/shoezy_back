-- CreateEnum
CREATE TYPE "exchange_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "inventory_movement_type" AS ENUM ('INITIAL_STOCK', 'MANUAL_SET', 'MANUAL_INCREMENT', 'MANUAL_DECREMENT', 'ORDER_PLACED', 'ORDER_CANCELLED', 'RETURN_RESTOCK', 'EXCHANGE_RETURNED', 'EXCHANGE_REPLACEMENT');

-- AlterTable
ALTER TABLE "product_media" ADD COLUMN     "storage_key" VARCHAR(255),
ADD COLUMN     "storage_provider" VARCHAR(40);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shipping_method_code" VARCHAR(80),
ADD COLUMN     "shipping_method_name" VARCHAR(150),
ADD COLUMN     "shipping_zone_code" VARCHAR(80),
ADD COLUMN     "shipping_zone_name" VARCHAR(150),
ADD COLUMN     "whatsapp_confirmation_number" VARCHAR(16),
ADD COLUMN     "whatsapp_store_name" VARCHAR(150);

-- CreateTable
CREATE TABLE "store_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "store_name" VARCHAR(150) NOT NULL DEFAULT 'Shoozy',
    "country_code" CHAR(2) NOT NULL DEFAULT 'TN',
    "currency" CHAR(3) NOT NULL DEFAULT 'TND',
    "currency_minor_unit" INTEGER NOT NULL DEFAULT 3,
    "whatsapp_number" VARCHAR(16),
    "support_phone" VARCHAR(32),
    "support_email" VARCHAR(320),
    "return_window_days" INTEGER NOT NULL DEFAULT 14,
    "exchange_window_days" INTEGER NOT NULL DEFAULT 14,
    "whatsapp_confirmation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_singleton_check" CHECK ("id" = 1);

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_areas" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'TN',
    "state" VARCHAR(120) NOT NULL,
    "city" VARCHAR(120),
    "area" VARCHAR(120),
    "state_key" VARCHAR(120) NOT NULL,
    "city_key" VARCHAR(120) NOT NULL DEFAULT '',
    "area_key" VARCHAR(120) NOT NULL DEFAULT '',

    CONSTRAINT "shipping_zone_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_zone_rates" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "shipping_method_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TND',
    "estimated_min_days" INTEGER,
    "estimated_max_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipping_zone_rates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "shipping_zone_rates" ADD CONSTRAINT "shipping_zone_rates_price_nonnegative_check" CHECK ("price_minor" >= 0);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "type" "inventory_movement_type" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "before_quantity" INTEGER NOT NULL,
    "after_quantity" INTEGER NOT NULL,
    "reference_type" VARCHAR(40),
    "reference_id" UUID,
    "reason" VARCHAR(255),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_quantities_check" CHECK ("before_quantity" >= 0 AND "after_quantity" >= 0 AND "after_quantity" - "before_quantity" = "quantity_delta");

-- CreateTable
CREATE TABLE "exchange_requests" (
    "id" UUID NOT NULL,
    "exchange_number" VARCHAR(50) NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "exchange_status" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500),
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exchange_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_items" (
    "id" UUID NOT NULL,
    "exchange_request_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "replacement_variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "exchange_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_quantity_positive_check" CHECK ("quantity" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zones_code_key" ON "shipping_zones"("code");

-- CreateIndex
CREATE INDEX "shipping_zone_areas_zone_id_idx" ON "shipping_zone_areas"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zone_areas_country_code_state_key_city_key_area_ke_key" ON "shipping_zone_areas"("country_code", "state_key", "city_key", "area_key");

-- CreateIndex
CREATE INDEX "shipping_zone_rates_shipping_method_id_is_active_idx" ON "shipping_zone_rates"("shipping_method_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zone_rates_zone_id_shipping_method_id_key" ON "shipping_zone_rates"("zone_id", "shipping_method_id");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_type_created_at_idx" ON "inventory_movements"("type", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_reference_type_reference_id_idx" ON "inventory_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_requests_exchange_number_key" ON "exchange_requests"("exchange_number");

-- CreateIndex
CREATE INDEX "exchange_requests_order_id_idx" ON "exchange_requests"("order_id");

-- CreateIndex
CREATE INDEX "exchange_requests_user_id_created_at_idx" ON "exchange_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "exchange_requests_status_created_at_idx" ON "exchange_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_items_exchange_request_id_key" ON "exchange_items"("exchange_request_id");

-- CreateIndex
CREATE INDEX "exchange_items_order_item_id_idx" ON "exchange_items"("order_item_id");

-- CreateIndex
CREATE INDEX "exchange_items_replacement_variant_id_idx" ON "exchange_items"("replacement_variant_id");

-- AddForeignKey
ALTER TABLE "shipping_zone_areas" ADD CONSTRAINT "shipping_zone_areas_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_rates" ADD CONSTRAINT "shipping_zone_rates_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zone_rates" ADD CONSTRAINT "shipping_zone_rates_shipping_method_id_fkey" FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_exchange_request_id_fkey" FOREIGN KEY ("exchange_request_id") REFERENCES "exchange_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_replacement_variant_id_fkey" FOREIGN KEY ("replacement_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
