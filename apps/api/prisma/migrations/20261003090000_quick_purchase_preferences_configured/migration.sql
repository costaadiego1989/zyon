-- A fast purchase may use defaults only after the buyer explicitly chooses
-- both delivery and payment preferences. Defaults remain display values, not
-- consent to automate the first checkout.
ALTER TABLE "buyer_preferences"
  ADD COLUMN IF NOT EXISTS "purchase_preferences_configured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "one_buy_click_sessions"
  ADD COLUMN IF NOT EXISTS "preferences_configured" BOOLEAN NOT NULL DEFAULT false;
