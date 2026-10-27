ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "conversation_state" JSONB;
ALTER TABLE "whatsapp_webhook_inbox" ADD COLUMN IF NOT EXISTS "response_state" JSONB;
CREATE TABLE "whatsapp_native_assets" (
  "id" TEXT NOT NULL PRIMARY KEY, "merchant_id" TEXT NOT NULL, "config_id" TEXT NOT NULL,
  "name" TEXT NOT NULL, "kind" TEXT NOT NULL, "source_hash" TEXT NOT NULL, "provider_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending', "last_error" TEXT, "retry_after" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "whatsapp_native_assets_config_id_kind_name_key" ON "whatsapp_native_assets"("config_id", "kind", "name");
CREATE INDEX "whatsapp_native_assets_merchant_id_config_id_idx" ON "whatsapp_native_assets"("merchant_id", "config_id");
