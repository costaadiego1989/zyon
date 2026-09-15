CREATE TABLE "storefront_wishlist_items" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "owner_key" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "storefront_wishlist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storefront_wishlist_items_merchant_id_owner_key_product_id_key"
  ON "storefront_wishlist_items"("merchant_id", "owner_key", "product_id");

CREATE INDEX "storefront_wishlist_items_merchant_id_owner_key_created_at_idx"
  ON "storefront_wishlist_items"("merchant_id", "owner_key", "created_at");

UPDATE "merchant_rules"
SET "quick_replies" = jsonb_set(
  COALESCE("quick_replies", '{}'::jsonb),
  '{product_detail}',
  COALESCE("quick_replies"->'product_detail', '[]'::jsonb)
    || CASE WHEN COALESCE("quick_replies"->'product_detail', '[]'::jsonb) ? 'Comparar'
      THEN '[]'::jsonb ELSE jsonb_build_array('Comparar') END
    || CASE WHEN COALESCE("quick_replies"->'product_detail', '[]'::jsonb) ? 'Lista de Desejos'
      THEN '[]'::jsonb ELSE jsonb_build_array('Lista de Desejos') END,
  true
)
WHERE "quick_replies" IS NULL
   OR jsonb_typeof("quick_replies") = 'object';
