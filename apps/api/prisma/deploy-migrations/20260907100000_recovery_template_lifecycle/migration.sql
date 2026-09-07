-- Cart Recovery reads these fields while loading the merchant editor.  The
-- production baseline already has the template-content columns, but predates
-- the lifecycle state that makes an unconnected WhatsApp sender safe.
--
-- Keep this reconciliation idempotent: a database that received the old
-- historical migration may already contain some or all of these columns.
ALTER TABLE "post_sale_message_templates"
  ADD COLUMN IF NOT EXISTS "meta_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "meta_next_check_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "meta_last_checked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "meta_claim_token" TEXT;

CREATE INDEX IF NOT EXISTS "post_sale_message_templates_type_channel_meta_next_check_at_idx"
  ON "post_sale_message_templates"("type", "channel", "meta_next_check_at");
