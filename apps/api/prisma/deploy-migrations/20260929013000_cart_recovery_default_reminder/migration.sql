-- A recovery default must be dispatchable without inventing a discount.
-- Existing legacy rows are normalized at read time only when their strategy
-- selection is empty; explicit coupon choices remain untouched and paused
-- until the merchant configures a code.
ALTER TABLE "cart_recovery_strategy_prefs"
  ALTER COLUMN "config" SET DEFAULT '{"active_strategy":"personalized_cross_sell"}'::jsonb;
