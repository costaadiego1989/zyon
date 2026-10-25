/*
  Warnings:

  - Added the required column `coupon_box_enabled` to the `merchant_rules` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "merchant_rules" ADD COLUMN     "coupon_box_enabled" BOOLEAN NOT NULL,
ADD COLUMN     "quick_replies" JSONB;

-- CreateTable
CREATE TABLE "support_settings" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "faq_items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_accounts" (
    "global_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_accounts_pkey" PRIMARY KEY ("global_user_id")
);

-- CreateTable
CREATE TABLE "buyer_agent_profiles" (
    "id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "max_rounds" INTEGER NOT NULL,
    "target_discount_percent" DOUBLE PRECISION NOT NULL,
    "minimum_acceptable_discount_percent" DOUBLE PRECISION NOT NULL,
    "auto_accept_threshold" DOUBLE PRECISION,
    "m2m_enabled" BOOLEAN NOT NULL DEFAULT false,
    "m2m_token_hash" TEXT,
    "m2m_token_created_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_shipping_profiles" (
    "merchant_id" TEXT NOT NULL,
    "origin_zip" TEXT NOT NULL,
    "default_weight_kg" DOUBLE PRECISION NOT NULL,
    "default_height_cm" DOUBLE PRECISION NOT NULL,
    "default_width_cm" DOUBLE PRECISION NOT NULL,
    "default_length_cm" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_shipping_profiles_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_settings_merchant_id_key" ON "support_settings"("merchant_id");

-- CreateIndex
CREATE INDEX "support_settings_merchant_id_idx" ON "support_settings"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_accounts_email_key" ON "buyer_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_agent_profiles_global_user_id_key" ON "buyer_agent_profiles"("global_user_id");

-- AddForeignKey
ALTER TABLE "buyer_agent_profiles" ADD CONSTRAINT "buyer_agent_profiles_global_user_id_fkey" FOREIGN KEY ("global_user_id") REFERENCES "buyer_accounts"("global_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "buyer_agent_negotiation_preferences_merchant_id_global_user_id_" RENAME TO "buyer_agent_negotiation_preferences_merchant_id_global_user_key";

-- RenameIndex
ALTER INDEX "negotiation_cost_ledger_entries_merchant_id_negotiation_session" RENAME TO "negotiation_cost_ledger_entries_merchant_id_negotiation_ses_idx";
