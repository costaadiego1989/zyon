-- New Buyer Hub and OneBuyClick sessions default to the economical delivery.
-- Existing buyer choices are intentionally preserved.
ALTER TABLE "buyer_preferences"
  ALTER COLUMN "shipping_preference" SET DEFAULT 'cheapest';

ALTER TABLE "one_buy_click_sessions"
  ALTER COLUMN "shipping_preference" SET DEFAULT 'cheapest';
