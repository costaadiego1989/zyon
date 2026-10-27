ALTER TABLE "post_sale_message_templates"
  ADD COLUMN "meta_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "meta_next_check_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "meta_last_checked_at" TIMESTAMP(3),
  ADD COLUMN "meta_claim_token" TEXT;

CREATE INDEX "post_sale_message_templates_type_channel_meta_next_check_at_idx"
  ON "post_sale_message_templates"("type", "channel", "meta_next_check_at");
