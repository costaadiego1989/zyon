ALTER TABLE "whatsapp_webhook_inbox" DROP CONSTRAINT "whatsapp_webhook_inbox_status_check";
ALTER TABLE "whatsapp_webhook_inbox" ADD CONSTRAINT "whatsapp_webhook_inbox_status_check"
  CHECK ("status" IN ('pending', 'processing', 'processed', 'dead', 'blocked'));
CREATE UNIQUE INDEX "marketplace_settlements_line_item_id_key" ON "marketplace_settlements"("line_item_id");
