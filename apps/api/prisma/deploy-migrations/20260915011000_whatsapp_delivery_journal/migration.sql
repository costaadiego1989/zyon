CREATE TABLE "whatsapp_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "config_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "processing_token" TEXT NOT NULL,
  "response" JSONB,
  "provider_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "whatsapp_deliveries_merchant_id_state_idx" ON "whatsapp_deliveries"("merchant_id", "state");
CREATE INDEX "whatsapp_deliveries_provider_message_id_idx" ON "whatsapp_deliveries"("provider_message_id");
