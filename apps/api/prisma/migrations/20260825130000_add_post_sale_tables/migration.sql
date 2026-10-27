-- Post-Sale Module

-- AlterTable: extend existing product_reviews with post-sale fields
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "merchant_id" TEXT;
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "order_id" TEXT;
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "text" TEXT;
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "moderation_status" TEXT;

CREATE INDEX IF NOT EXISTS "product_reviews_merchant_id_moderation_status_idx"
  ON "product_reviews" ("merchant_id", "moderation_status");

-- CreateTable: post_sale_scheduled_messages
CREATE TABLE IF NOT EXISTS "post_sale_scheduled_messages" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "send_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "message_content" TEXT,
    "buyer_phone" TEXT,
    "buyer_email" TEXT,
    "buyer_name" TEXT,
    "product_name" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_sale_scheduled_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "post_sale_scheduled_messages_merchant_id_status_send_at_idx"
  ON "post_sale_scheduled_messages" ("merchant_id", "status", "send_at");
CREATE INDEX IF NOT EXISTS "post_sale_scheduled_messages_merchant_id_buyer_id_idx"
  ON "post_sale_scheduled_messages" ("merchant_id", "buyer_id");

-- CreateTable: nps_responses
CREATE TABLE IF NOT EXISTS "nps_responses" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "order_id" TEXT,
    "score" INTEGER NOT NULL,
    "feedback" TEXT,
    "classification" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nps_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "nps_responses_merchant_id_created_at_idx"
  ON "nps_responses" ("merchant_id", "created_at");

-- CreateTable: buyer_loyalty_trackers
CREATE TABLE IF NOT EXISTS "buyer_loyalty_trackers" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "purchase_count" INTEGER NOT NULL DEFAULT 0,
    "total_spent_cents" INTEGER NOT NULL DEFAULT 0,
    "last_purchase_at" TIMESTAMP(3),
    "last_win_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "buyer_loyalty_trackers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "buyer_loyalty_trackers_merchant_id_buyer_id_key"
  ON "buyer_loyalty_trackers" ("merchant_id", "buyer_id");
CREATE INDEX IF NOT EXISTS "buyer_loyalty_trackers_merchant_id_last_purchase_at_idx"
  ON "buyer_loyalty_trackers" ("merchant_id", "last_purchase_at");
