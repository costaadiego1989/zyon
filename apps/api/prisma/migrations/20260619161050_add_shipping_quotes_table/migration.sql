-- CreateTable
CREATE TABLE "shipping_quotes" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "destination_zip" TEXT NOT NULL,
    "quote_key" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "selected_carrier_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_crypto_transfers" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_crypto_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_quotes_merchant_id_session_id_created_at_idx" ON "shipping_quotes"("merchant_id", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "shipping_quotes_merchant_id_quote_key_expires_at_idx" ON "shipping_quotes"("merchant_id", "quote_key", "expires_at");

-- CreateIndex
CREATE INDEX "payment_crypto_transfers_merchant_id_intent_id_idx" ON "payment_crypto_transfers"("merchant_id", "intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_crypto_transfers_chain_tx_hash_key" ON "payment_crypto_transfers"("chain", "tx_hash");

-- RenameIndex
ALTER INDEX "coupon_redemptions_merchant_id_buyer_global_user_id_coupon_id_s" RENAME TO "coupon_redemptions_merchant_id_buyer_global_user_id_coupon__idx";

-- RenameIndex
ALTER INDEX "cross_sell_suggestions_merchant_id_session_id_promo_id_status_i" RENAME TO "cross_sell_suggestions_merchant_id_session_id_promo_id_stat_idx";

-- RenameIndex
ALTER INDEX "merchant_webhook_deliveries_merchant_id_status_next_attempt_at_" RENAME TO "merchant_webhook_deliveries_merchant_id_status_next_attempt_idx";
