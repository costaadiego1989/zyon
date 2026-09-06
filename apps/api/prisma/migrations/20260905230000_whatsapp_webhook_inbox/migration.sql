CREATE TABLE "whatsapp_webhook_inbox" (
  "id" TEXT NOT NULL,
  "dedup_key" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('message', 'status')),
  "merchant_id" TEXT NOT NULL,
  "config_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "stream_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'processing', 'processed', 'dead')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_webhook_inbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_webhook_inbox_dedup_key_key"
  ON "whatsapp_webhook_inbox"("dedup_key");
CREATE INDEX "whatsapp_webhook_inbox_status_available_at_lease_expires_at_idx"
  ON "whatsapp_webhook_inbox"("status", "available_at", "lease_expires_at");
CREATE INDEX "whatsapp_webhook_inbox_stream_key_status_created_at_idx"
  ON "whatsapp_webhook_inbox"("stream_key", "status", "created_at");
