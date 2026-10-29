ALTER TABLE "merchant_api_keys"
  ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'test',
  ADD COLUMN "allowed_cidrs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "rotated_from_id" TEXT;

DROP INDEX IF EXISTS "merchant_api_keys_merchant_id_revoked_at_idx";

CREATE INDEX "merchant_api_keys_merchant_id_environment_revoked_at_idx"
  ON "merchant_api_keys"("merchant_id", "environment", "revoked_at");

CREATE INDEX "merchant_api_keys_merchant_id_expires_at_idx"
  ON "merchant_api_keys"("merchant_id", "expires_at");
