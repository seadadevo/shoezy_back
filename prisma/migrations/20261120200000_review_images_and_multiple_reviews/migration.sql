-- DropIndex
DROP INDEX IF EXISTS "product_reviews_order_item_id_key";

-- AlterTable
ALTER TABLE "product_reviews" ALTER COLUMN "rating" DROP NOT NULL;
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
