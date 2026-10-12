ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "conversation_state" JSONB;
ALTER TABLE "whatsapp_webhook_inbox" ADD COLUMN IF NOT EXISTS "response_state" JSONB;
CREATE TABLE IF NOT EXISTS "storefront_wishlist_items" (
  "id" TEXT NOT NULL PRIMARY KEY, "merchant_id" TEXT NOT NULL, "owner_key" TEXT NOT NULL,
  "product_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "storefront_wishlist_items_merchant_id_owner_key_product_id_key"
  ON "storefront_wishlist_items"("merchant_id", "owner_key", "product_id");
CREATE INDEX IF NOT EXISTS "storefront_wishlist_items_merchant_id_owner_key_created_at_idx"
  ON "storefront_wishlist_items"("merchant_id", "owner_key", "created_at");
