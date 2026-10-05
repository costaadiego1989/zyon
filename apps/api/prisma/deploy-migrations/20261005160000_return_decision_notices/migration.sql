CREATE TABLE "return_notice_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "return_id" TEXT NOT NULL REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ticket_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('email', 'whatsapp')),
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMP(3),
  "provider_message_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "return_notice_deliveries_once" ON "return_notice_deliveries"("return_id", "type", "channel");
CREATE INDEX "return_notice_deliveries_queue" ON "return_notice_deliveries"("status", "next_attempt_at", "lease_until");
CREATE INDEX "return_notice_deliveries_merchant_id_ticket_id_idx" ON "return_notice_deliveries"("merchant_id", "ticket_id");
