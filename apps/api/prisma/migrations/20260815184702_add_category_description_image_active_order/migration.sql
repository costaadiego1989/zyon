-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN "description" TEXT;
ALTER TABLE "product_categories" ADD COLUMN "image_url" TEXT;
ALTER TABLE "product_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "product_categories" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
