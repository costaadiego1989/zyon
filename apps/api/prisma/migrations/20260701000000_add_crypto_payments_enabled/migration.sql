ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "crypto_payments_enabled" BOOLEAN NOT NULL DEFAULT false;
