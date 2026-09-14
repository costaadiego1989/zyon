ALTER TABLE "post_sale_message_templates"
  ADD COLUMN "meta_waba_id" TEXT,
  ADD COLUMN "meta_approved_versions" JSONB NOT NULL DEFAULT '[]';

UPDATE "post_sale_message_templates"
SET "meta_next_check_at" = CURRENT_TIMESTAMP, "meta_last_checked_at" = NULL
WHERE "channel" = 'whatsapp' AND "type" IN ('follow_up', 'review_request', 'nps', 'cross_sell', 'win_back', 'loyalty', 'reorder', 'cart_recovery', 'order_confirmation', 'order_shipped', 'order_delivered');

-- A Twilio content identifier cannot be reused as a Meta Cloud template name.
UPDATE "post_sale_message_templates"
SET "twilio_content_sid" = NULL, "meta_status" = 'draft', "meta_revision" = "meta_revision" + 1,
    "meta_claim_token" = NULL, "meta_rejection_reason" = NULL
WHERE "channel" = 'whatsapp' AND "twilio_content_sid" ~ '^HX[0-9a-fA-F]{32}$'
  AND "type" IN ('follow_up', 'review_request', 'nps', 'cross_sell', 'win_back', 'loyalty', 'reorder', 'cart_recovery', 'order_confirmation', 'order_shipped', 'order_delivered');

ALTER TABLE "post_sale_scheduled_messages"
  ADD COLUMN "processing_at" TIMESTAMP(3),
  ADD COLUMN "provider_message_id" TEXT,
  ADD COLUMN "failure_reason" TEXT;

UPDATE "post_sale_scheduled_messages" SET "status" = 'unknown', "failure_reason" = 'legacy_processing_outcome_unknown' WHERE "status" = 'processing';
