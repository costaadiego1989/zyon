-- Buyer-level defaults are preference data. Existing buyers keep the established
-- guest-safe defaults: disabled flow, fastest shipping and Pix.
ALTER TABLE "buyer_preferences"
  ADD COLUMN IF NOT EXISTS "one_buy_click_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shipping_preference" TEXT NOT NULL DEFAULT 'fastest',
  ADD COLUMN IF NOT EXISTS "payment_preference" TEXT NOT NULL DEFAULT 'pix';

-- A conversation owns its transient OneBuyClick state. Payment details, address
-- data and free-form conversation text stay in their existing bounded stores.
CREATE TABLE IF NOT EXISTS "one_buy_click_sessions" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "global_user_id" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "shipping_preference" TEXT NOT NULL DEFAULT 'fastest',
  "payment_preference" TEXT NOT NULL DEFAULT 'pix',
  "cart_fingerprint" TEXT,
  "prepared_action_id" TEXT,
  "prepared_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "one_buy_click_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "one_buy_click_sessions_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "one_buy_click_sessions_merchant_id_conversation_id_key"
  ON "one_buy_click_sessions"("merchant_id", "conversation_id");
CREATE INDEX IF NOT EXISTS "one_buy_click_sessions_merchant_id_status_expires_at_idx"
  ON "one_buy_click_sessions"("merchant_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "one_buy_click_sessions_global_user_id_updated_at_idx"
  ON "one_buy_click_sessions"("global_user_id", "updated_at");
