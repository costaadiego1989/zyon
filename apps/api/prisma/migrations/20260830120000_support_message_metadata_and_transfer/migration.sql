-- Add structured metadata to support ticket messages (nullable, backward compatible)
ALTER TABLE "support_ticket_messages" ADD COLUMN "metadata" JSONB;

-- Add return link + transfer tracking to support tickets (nullable, backward compatible)
ALTER TABLE "support_tickets" ADD COLUMN "return_id" TEXT;
ALTER TABLE "support_tickets" ADD COLUMN "origin_merchant_id" TEXT;
ALTER TABLE "support_tickets" ADD COLUMN "transferred_at" TIMESTAMP(3);

-- Index for return lookup
CREATE INDEX "support_tickets_return_id_idx" ON "support_tickets"("return_id");
