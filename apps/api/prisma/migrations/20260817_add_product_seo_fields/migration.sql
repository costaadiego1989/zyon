-- Add SEO fields to products table
ALTER TABLE "products" ADD COLUMN "seo_title" TEXT;
ALTER TABLE "products" ADD COLUMN "meta_description" TEXT;
ALTER TABLE "products" ADD COLUMN "slug" TEXT;
ALTER TABLE "products" ADD COLUMN "og_title" TEXT;
ALTER TABLE "products" ADD COLUMN "og_description" TEXT;
ALTER TABLE "products" ADD COLUMN "twitter_card" TEXT;
ALTER TABLE "products" ADD COLUMN "keywords" TEXT[] DEFAULT '{}';
ALTER TABLE "products" ADD COLUMN "seo_generated_at" TIMESTAMP(3);

-- Unique index on slug
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- Index for slug lookups
CREATE INDEX "products_slug_idx" ON "products"("slug");
