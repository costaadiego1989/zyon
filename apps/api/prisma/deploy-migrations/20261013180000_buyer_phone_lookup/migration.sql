ALTER TABLE "buyer_accounts" ADD COLUMN IF NOT EXISTS "phone_lookup_hash" VARCHAR(64);
CREATE INDEX IF NOT EXISTS "buyer_accounts_phone_lookup_hash_idx" ON "buyer_accounts"("phone_lookup_hash");
