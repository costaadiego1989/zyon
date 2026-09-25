ALTER TABLE "merchants"
  ADD COLUMN IF NOT EXISTS "billing_account_merchant_id" TEXT;

UPDATE "merchants"
  SET "billing_account_merchant_id" = "id"
  WHERE "billing_account_merchant_id" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'merchants_billing_account_merchant_id_fkey'
      AND conrelid = 'merchants'::regclass
  ) THEN
    ALTER TABLE "merchants"
      ADD CONSTRAINT "merchants_billing_account_merchant_id_fkey"
      FOREIGN KEY ("billing_account_merchant_id") REFERENCES "merchants"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "merchants_billing_account_merchant_id_idx"
  ON "merchants"("billing_account_merchant_id");

-- Existing users are members only of their original store. This migration makes
-- that membership explicit before an owner can add a separate store.
INSERT INTO "merchant_team_members" ("id", "merchant_id", "user_id", "role")
SELECT
  'legacy-membership:' || "id" || ':' || "merchant_id",
  "merchant_id",
  "id",
  CASE lower("role")
    WHEN 'owner' THEN 'OWNER'::"MerchantRole"
    WHEN 'admin' THEN 'ADMIN'::"MerchantRole"
    ELSE 'STAFF'::"MerchantRole"
  END
FROM "merchant_users" AS "legacy_users"
WHERE NOT EXISTS (
  SELECT 1
  FROM "merchant_team_members" AS "membership"
  WHERE "membership"."merchant_id" = "legacy_users"."merchant_id"
    AND "membership"."user_id" = "legacy_users"."id"
) ON CONFLICT ("merchant_id", "user_id") DO NOTHING;
