ALTER TYPE "ReturnStatus" ADD VALUE IF NOT EXISTS 'EXCHANGE_COMPLETED';
ALTER TABLE "support_tickets"
  ADD COLUMN "buyer_id" TEXT,
  ADD COLUMN "buyer_read_at" TIMESTAMP(3),
  ADD COLUMN "merchant_read_at" TIMESTAMP(3),
  ADD COLUMN "assigned_to" TEXT,
  ADD COLUMN "merged_into_id" TEXT;
CREATE INDEX "support_tickets_buyer_id_updated_at_idx" ON "support_tickets"("buyer_id", "updated_at");
ALTER TABLE "support_ticket_messages" ADD COLUMN "client_message_id" TEXT;
CREATE UNIQUE INDEX "support_ticket_messages_ticket_id_sender_type_client_message_id_key"
  ON "support_ticket_messages"("ticket_id", "sender_type", "client_message_id");
ALTER TABLE "returns" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'refund',
  ADD COLUMN "request_key" TEXT, ADD COLUMN "order_snapshot" JSONB, ADD COLUMN "resolution" JSONB;
CREATE UNIQUE INDEX "returns_merchant_id_buyer_id_request_key_key" ON "returns"("merchant_id", "buyer_id", "request_key");
CREATE TABLE "support_attachments" (
  "id" TEXT NOT NULL PRIMARY KEY, "ticket_id" TEXT NOT NULL, "merchant_id" TEXT NOT NULL,
  "uploaded_by" TEXT NOT NULL, "storage_key" TEXT NOT NULL, "content_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "support_attachments_ticket_id_idx" ON "support_attachments"("ticket_id");
CREATE TABLE "return_drafts" (
  "merchant_id" TEXT NOT NULL, "buyer_id" TEXT NOT NULL, "data" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("merchant_id", "buyer_id")
);
-- Recover ownership of historical return tickets, including the duplicate form path.
UPDATE "support_tickets" t SET "buyer_id" = r."buyer_id"
  FROM "returns" r WHERE t."merchant_id" = r."merchant_id"
  AND (t."return_id" = r."id" OR (t."source" = 'return_request' AND t."session_id" = r."id"));
-- Non-destructive alias for the confirmed duplicate creation path. History stays intact.
UPDATE "support_tickets" duplicate SET "merged_into_id" = canonical."id"
  FROM "support_tickets" canonical
  WHERE duplicate."source" = 'return_request' AND duplicate."return_id" IS NULL
  AND duplicate."session_id" = canonical."return_id"
  AND duplicate."merchant_id" = canonical."merchant_id"
  AND canonical."return_id" IS NOT NULL AND duplicate."id" <> canonical."id";
