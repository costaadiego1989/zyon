ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "stellar_public_key" TEXT;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "stellar_account_activated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "crypto_payments_enabled" BOOLEAN NOT NULL DEFAULT false;
