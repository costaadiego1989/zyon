-- The dashboard and public storefront use a stable public slug. Keep the
-- historical JSON copy for backward-compatible API responses, while enforcing
-- uniqueness and indexed lookup in a dedicated column.
ALTER TABLE "merchants"
  ADD COLUMN IF NOT EXISTS "store_slug" TEXT;

UPDATE "merchants"
SET "store_slug" = NULLIF("store_settings" ->> 'slug', '')
WHERE "store_slug" IS NULL
  AND "store_settings" ->> 'slug' IS NOT NULL;

-- A duplicate historical slug stops this migration instead of silently routing
-- one merchant to another. Resolve duplicates in the pre-deploy gate first.
CREATE UNIQUE INDEX IF NOT EXISTS "merchants_store_slug_key"
  ON "merchants"("store_slug");
