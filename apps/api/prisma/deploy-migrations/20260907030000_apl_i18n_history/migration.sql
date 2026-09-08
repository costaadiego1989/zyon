-- ============================================================================
-- Advanced Product Layout — Wave 3
-- Adds:
--   * locale TEXT NOT NULL DEFAULT 'pt-BR' on the four content tables (i18n)
--   * product_content_history table (snapshot per replaceAll; supports revert)
--
-- Note: parent_block_id self-FK was planned but not added to the Prisma
-- schema in Wave 1; tracking edits-by-block in history snapshot instead.
--
-- Backwards compatibility:
--   * Existing rows receive 'pt-BR' from the column DEFAULT (no data loss).
--   * History table adds without touching the live tables beyond the column.
-- ============================================================================

-- ----- product_content_blocks: locale ------------------------------------------
ALTER TABLE "product_content_blocks"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'pt-BR';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'product_content_blocks_product_id_locale_order_idx'
  ) THEN
    CREATE INDEX "product_content_blocks_product_id_locale_order_idx"
      ON "product_content_blocks"("product_id", "locale", "order");
  END IF;
END $$;

-- ----- product_faqs: locale -----------------------------------------------------
ALTER TABLE "product_faqs"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'pt-BR';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'product_faqs_product_id_locale_order_idx'
  ) THEN
    CREATE INDEX "product_faqs_product_id_locale_order_idx"
      ON "product_faqs"("product_id", "locale", "order");
  END IF;
END $$;

-- ----- product_testimonials: locale --------------------------------------------
ALTER TABLE "product_testimonials"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'pt-BR';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'product_testimonials_product_id_locale_idx'
  ) THEN
    CREATE INDEX "product_testimonials_product_id_locale_idx"
      ON "product_testimonials"("product_id", "locale");
  END IF;
END $$;

-- ----- product_videos: locale ---------------------------------------------------
ALTER TABLE "product_videos"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'pt-BR';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'product_videos_product_id_locale_idx'
  ) THEN
    CREATE INDEX "product_videos_product_id_locale_idx"
      ON "product_videos"("product_id", "locale");
  END IF;
END $$;

-- ----- product_content_history --------------------------------------------------
CREATE TABLE IF NOT EXISTS "product_content_history" (
  "id"                    TEXT        NOT NULL,
  "product_id"            TEXT        NOT NULL,
  "locale"                TEXT        NOT NULL DEFAULT 'pt-BR',
  "snapshot"              JSON        NOT NULL,
  "version"               INTEGER     NOT NULL,
  "saved_by"              TEXT        NOT NULL,
  "restored_from_version" INTEGER,
  "saved_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_content_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_content_history_version_per_product_unique"
    UNIQUE ("product_id", "locale", "version")
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'product_content_history_product_id_locale_version_idx'
  ) THEN
    CREATE INDEX "product_content_history_product_id_locale_version_idx"
      ON "product_content_history"("product_id", "locale", "version" DESC);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_content_history_product_id_fkey'
  ) THEN
    ALTER TABLE "product_content_history"
      ADD CONSTRAINT "product_content_history_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;
  END IF;
END $$;
