-- ============================================================================
-- Advanced Product Layout
-- Adds:
--   * product_content_blocks (JSON-blocks description surface, per-product, ordered)
--   * product_faqs (per-product Q&A)
--   * product_testimonials (customer testimonials curated per product)
--   * product_videos (customer-uploaded product videos, moderated)
-- All tables tenant-scoped via product_id -> products.merchant_id (no merchant_id
-- column needed at the table level; queries always join through products).
-- Migration is additive + nullable + indexed for safe deploy behind feature flag.
-- ============================================================================

-- ----- product_content_blocks -------------------------------------------------
CREATE TABLE IF NOT EXISTS "product_content_blocks" (
  "id"            TEXT        NOT NULL,
  "product_id"    TEXT        NOT NULL,
  "type"          TEXT        NOT NULL,
  "props"         JSON        NOT NULL DEFAULT '{}'::jsonb,
  "order"         INTEGER     NOT NULL DEFAULT 0,
  "is_enabled"    BOOLEAN     NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_content_blocks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_content_blocks_product_id_order_idx"
  ON "product_content_blocks"("product_id", "order");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_content_blocks_product_id_fkey'
  ) THEN
    ALTER TABLE "product_content_blocks"
      ADD CONSTRAINT "product_content_blocks_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ----- product_faqs -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "product_faqs" (
  "id"          TEXT        NOT NULL,
  "product_id"  TEXT        NOT NULL,
  "question"    TEXT        NOT NULL,
  "answer"      TEXT        NOT NULL,
  "order"       INTEGER     NOT NULL DEFAULT 0,
  "is_published" BOOLEAN    NOT NULL DEFAULT false,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_faqs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_faqs_product_id_order_idx"
  ON "product_faqs"("product_id", "order");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_faqs_product_id_fkey'
  ) THEN
    ALTER TABLE "product_faqs"
      ADD CONSTRAINT "product_faqs_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ----- product_testimonials ---------------------------------------------------
CREATE TABLE IF NOT EXISTS "product_testimonials" (
  "id"              TEXT        NOT NULL,
  "product_id"      TEXT        NOT NULL,
  "author_name"     TEXT        NOT NULL,
  "author_avatar_url" TEXT,
  "body"            TEXT        NOT NULL,
  "rating"          INTEGER,
  "source"          TEXT        NOT NULL DEFAULT 'curated', -- curated | customer_submission
  "buyer_id"        TEXT,
  "order_id"        TEXT,
  "moderation_status" TEXT      NOT NULL DEFAULT 'approved', -- pending | approved | rejected
  "is_published"    BOOLEAN     NOT NULL DEFAULT false,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_testimonials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_testimonials_rating_check"
    CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5))
);
CREATE INDEX IF NOT EXISTS "product_testimonials_product_id_idx"
  ON "product_testimonials"("product_id");
CREATE INDEX IF NOT EXISTS "product_testimonials_product_id_status_idx"
  ON "product_testimonials"("product_id", "moderation_status");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_testimonials_product_id_fkey'
  ) THEN
    ALTER TABLE "product_testimonials"
      ADD CONSTRAINT "product_testimonials_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ----- product_videos ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "product_videos" (
  "id"            TEXT        NOT NULL,
  "product_id"    TEXT        NOT NULL,
  "title"         TEXT        NOT NULL,
  "video_url"     TEXT        NOT NULL,
  "thumbnail_url" TEXT,
  "duration_seconds" INTEGER,
  "source"        TEXT        NOT NULL DEFAULT 'customer', -- merchant | customer
  "buyer_id"      TEXT,
  "moderation_status" TEXT    NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  "is_published"  BOOLEAN     NOT NULL DEFAULT false,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_videos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_videos_product_id_idx"
  ON "product_videos"("product_id");
CREATE INDEX IF NOT EXISTS "product_videos_product_id_status_idx"
  ON "product_videos"("product_id", "moderation_status");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_videos_product_id_fkey'
  ) THEN
    ALTER TABLE "product_videos"
      ADD CONSTRAINT "product_videos_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;
  END IF;
END $$;
