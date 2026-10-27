ALTER TABLE "merchant_users" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "disabled_at" TIMESTAMP(3);

-- MerchantUser is the effective account. Reconcile same-tenant membership roles,
-- normalize original owners, and disable unsupported legacy roles for review.
UPDATE "merchant_users" u SET "role" = lower(m."role"::text)
FROM "merchant_team_members" m WHERE m."user_id" = u."id" AND m."merchant_id" = u."merchant_id";
UPDATE "merchant_users" SET "role" = lower("role");
UPDATE "merchant_users" SET "disabled_at" = CURRENT_TIMESTAMP
WHERE "role" NOT IN ('owner', 'admin', 'staff') OR ("role" <> 'owner' AND NOT EXISTS (
  SELECT 1 FROM "merchant_team_members" m WHERE m."user_id" = "merchant_users"."id" AND m."merchant_id" = "merchant_users"."merchant_id"
));
INSERT INTO "merchant_team_members" ("id", "merchant_id", "user_id", "role", "joined_at")
SELECT 'auth_backfill_' || u."id", u."merchant_id", u."id", upper(u."role")::"MerchantRole", u."created_at"
FROM "merchant_users" u WHERE u."disabled_at" IS NULL AND u."role" = 'owner'
ON CONFLICT ("merchant_id", "user_id") DO NOTHING;

CREATE TABLE "merchant_auth_sessions" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL, "auth_version" INTEGER NOT NULL,
  "refresh_expires_at" TIMESTAMP(3) NOT NULL, "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merchant_auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "merchant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "merchant_auth_sessions_family_id_idx" ON "merchant_auth_sessions"("family_id");
CREATE INDEX "merchant_auth_sessions_user_id_revoked_at_idx" ON "merchant_auth_sessions"("user_id", "revoked_at");
CREATE INDEX "merchant_auth_sessions_refresh_expires_at_idx" ON "merchant_auth_sessions"("refresh_expires_at");

CREATE TABLE "merchant_password_reset_tokens" (
  "token_hash" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "auth_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL, "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merchant_password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "merchant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "merchant_password_reset_tokens_user_id_idx" ON "merchant_password_reset_tokens"("user_id");
CREATE INDEX "merchant_password_reset_tokens_expires_at_idx" ON "merchant_password_reset_tokens"("expires_at");
