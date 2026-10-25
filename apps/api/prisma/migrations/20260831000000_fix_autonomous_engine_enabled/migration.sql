-- Add autonomous_engine_enabled column to merchant_rules if it doesn't exist
ALTER TABLE "merchant_rules" ADD COLUMN IF NOT EXISTS "autonomous_engine_enabled" BOOLEAN NOT NULL DEFAULT true;
