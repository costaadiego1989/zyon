ALTER TYPE "MerchantPlan" ADD VALUE IF NOT EXISTS 'CHECKOUT_ONLY';

ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "melhor_envio_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "merchant_billing_subscriptions"
  ADD COLUMN IF NOT EXISTS "asaas_customer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "asaas_subscription_id" TEXT,
  ADD COLUMN IF NOT EXISTS "pending_plan_effective_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pending_plan_key" TEXT,
  ADD COLUMN IF NOT EXISTS "plan_key" TEXT,
  ADD COLUMN IF NOT EXISTS "provider" TEXT DEFAULT 'asaas';

ALTER TABLE "checkout_sessions"
  ADD COLUMN IF NOT EXISTS "ai_cost_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cohort" TEXT,
  ADD COLUMN IF NOT EXISTS "features_applied" JSONB;
ALTER TABLE "checkout_events" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "merchant_rules" ADD COLUMN IF NOT EXISTS "autonomous_engine_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "support_tickets"
  ADD COLUMN IF NOT EXISTS "origin_merchant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "return_id" TEXT,
  ADD COLUMN IF NOT EXISTS "transferred_at" TIMESTAMP(3);
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "completed_orders"
  ADD COLUMN IF NOT EXISTS "line_items_json" JSONB,
  ADD COLUMN IF NOT EXISTS "shipping_cents" INTEGER;
ALTER TABLE "buyer_accounts"
  ADD COLUMN IF NOT EXISTS "asaas_customer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "date_of_birth" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "product_reviews"
  ADD COLUMN IF NOT EXISTS "merchant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "moderation_status" TEXT,
  ADD COLUMN IF NOT EXISTS "order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "text" TEXT,
  ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "returns" ADD COLUMN IF NOT EXISTS "image_urls" TEXT[];
ALTER TABLE "storefront_carts" ADD COLUMN IF NOT EXISTS "free_shipping" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_promotions"
  ADD COLUMN IF NOT EXISTS "coupon_id" TEXT,
  ADD COLUMN IF NOT EXISTS "product_id" TEXT,
  ALTER COLUMN "discount_type" DROP NOT NULL,
  ALTER COLUMN "discount_value" DROP NOT NULL;
ALTER TABLE "prompt_variants" ADD COLUMN IF NOT EXISTS "applied_rule_id" TEXT;
ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "post_sale_context" JSONB;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "sale_price_cents" INTEGER;

CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'product_spreadsheet',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "file_name" TEXT NOT NULL,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "success_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "column_mapping" JSONB NOT NULL DEFAULT '{}',
  "errors" JSONB NOT NULL DEFAULT '[]',
  "file_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS "nav_badge_views" (
  "merchant_id" TEXT NOT NULL,
  "badge_key" TEXT NOT NULL,
  "last_viewed_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("merchant_id", "badge_key")
);
CREATE TABLE IF NOT EXISTS "post_sale_message_templates" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "subject" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "meta_category" TEXT,
  "meta_language" TEXT DEFAULT 'pt_BR',
  "meta_template_body" TEXT,
  "meta_variable_map" JSONB,
  "twilio_content_sid" TEXT,
  "meta_status" TEXT DEFAULT 'draft',
  "meta_rejection_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "crm_sync_log" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "email" TEXT NOT NULL, "stage" TEXT NOT NULL, "status" TEXT NOT NULL,
  "error_code" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "own_delivery_configs" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" TEXT NOT NULL DEFAULT 'flat', "flat_price_cents" INTEGER, "free_above_cents" INTEGER,
  "neighborhoods" JSONB, "radius_zones" JSONB, "estimated_value" INTEGER NOT NULL DEFAULT 60,
  "estimated_unit" TEXT NOT NULL DEFAULT 'minutes', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "post_sale_scheduled_messages" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "buyer_id" TEXT NOT NULL, "order_id" TEXT NOT NULL,
  "type" TEXT NOT NULL, "channel" TEXT NOT NULL DEFAULT 'whatsapp', "send_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "sent_at" TIMESTAMP(3), "message_content" TEXT,
  "buyer_phone" TEXT, "buyer_email" TEXT, "buyer_name" TEXT, "product_name" TEXT, "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "nps_responses" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "buyer_id" TEXT NOT NULL, "order_id" TEXT,
  "score" INTEGER NOT NULL, "feedback" TEXT, "classification" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "buyer_loyalty_trackers" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "buyer_id" TEXT NOT NULL,
  "purchase_count" INTEGER NOT NULL DEFAULT 0, "total_spent_cents" INTEGER NOT NULL DEFAULT 0,
  "last_purchase_at" TIMESTAMP(3), "last_win_back_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "source_type" TEXT NOT NULL, "source_id" TEXT,
  "content" TEXT NOT NULL, "embedding" TEXT NOT NULL, "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "merchant_policies" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "returns" TEXT, "shipping" TEXT, "warranty" TEXT,
  "payment" TEXT, "general" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "merchant_notifications" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "type" TEXT NOT NULL, "title" TEXT NOT NULL,
  "body" TEXT, "metadata" JSONB, "read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "buyer_earned_benefits" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL, "global_user_id" TEXT NOT NULL,
  "benefit_type" TEXT NOT NULL, "value" DOUBLE PRECISION NOT NULL, "origin" TEXT NOT NULL,
  "reason" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'active', "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "import_jobs_merchant_id_status_created_at_idx" ON "import_jobs"("merchant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "post_sale_message_templates_merchant_id_idx" ON "post_sale_message_templates"("merchant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "post_sale_message_templates_merchant_id_type_channel_key" ON "post_sale_message_templates"("merchant_id", "type", "channel");
CREATE INDEX IF NOT EXISTS "crm_sync_log_merchant_id_created_at_idx" ON "crm_sync_log"("merchant_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_sync_log_merchant_id_email_idx" ON "crm_sync_log"("merchant_id", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "own_delivery_configs_merchant_id_key" ON "own_delivery_configs"("merchant_id");
CREATE INDEX IF NOT EXISTS "own_delivery_configs_merchant_id_idx" ON "own_delivery_configs"("merchant_id");
CREATE INDEX IF NOT EXISTS "post_sale_scheduled_messages_merchant_id_status_send_at_idx" ON "post_sale_scheduled_messages"("merchant_id", "status", "send_at");
CREATE INDEX IF NOT EXISTS "post_sale_scheduled_messages_merchant_id_buyer_id_idx" ON "post_sale_scheduled_messages"("merchant_id", "buyer_id");
CREATE INDEX IF NOT EXISTS "nps_responses_merchant_id_created_at_idx" ON "nps_responses"("merchant_id", "created_at");
CREATE INDEX IF NOT EXISTS "buyer_loyalty_trackers_merchant_id_last_purchase_at_idx" ON "buyer_loyalty_trackers"("merchant_id", "last_purchase_at");
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_loyalty_trackers_merchant_id_buyer_id_key" ON "buyer_loyalty_trackers"("merchant_id", "buyer_id");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_merchant_id_source_type_idx" ON "knowledge_chunks"("merchant_id", "source_type");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_policies_merchant_id_key" ON "merchant_policies"("merchant_id");
CREATE INDEX IF NOT EXISTS "merchant_notifications_merchant_id_created_at_idx" ON "merchant_notifications"("merchant_id", "created_at");
CREATE INDEX IF NOT EXISTS "merchant_notifications_merchant_id_read_idx" ON "merchant_notifications"("merchant_id", "read");
CREATE INDEX IF NOT EXISTS "buyer_earned_benefits_merchant_id_global_user_id_status_idx" ON "buyer_earned_benefits"("merchant_id", "global_user_id", "status");
CREATE INDEX IF NOT EXISTS "merchant_billing_subscriptions_asaas_subscription_id_idx" ON "merchant_billing_subscriptions"("asaas_subscription_id");
CREATE INDEX IF NOT EXISTS "support_tickets_return_id_idx" ON "support_tickets"("return_id");
CREATE INDEX IF NOT EXISTS "product_reviews_merchant_id_moderation_status_idx" ON "product_reviews"("merchant_id", "moderation_status");
CREATE INDEX IF NOT EXISTS "product_promotions_merchant_id_product_id_is_active_idx" ON "product_promotions"("merchant_id", "product_id", "is_active");

DO $$ BEGIN
  ALTER TABLE "own_delivery_configs" ADD CONSTRAINT "own_delivery_configs_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
