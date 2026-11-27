CREATE TABLE "recovery_messages" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "config_id" TEXT,
  "snapshot" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'dispatching',
  "provider_message_id" TEXT,
  "reason" TEXT,
  "sent_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "read_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "recovery_messages_merchant_correlation" ON "recovery_messages" ("merchant_id", "correlation_id");
CREATE INDEX "recovery_messages_provider" ON "recovery_messages" ("merchant_id", "config_id", "provider_message_id");
