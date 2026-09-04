-- AlterTable: add config JSON column to cart_recovery_strategy_prefs
ALTER TABLE "cart_recovery_strategy_prefs" ADD COLUMN IF NOT EXISTS "config" JSONB DEFAULT '{"active_strategy":"offer_coupon"}';
