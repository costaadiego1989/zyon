-- Keep deployment tooling aligned with the Prisma migration directory.
ALTER TABLE "buyer_preferences"
  ADD COLUMN IF NOT EXISTS "purchase_preferences_configured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "one_buy_click_sessions"
  ADD COLUMN IF NOT EXISTS "preferences_configured" BOOLEAN NOT NULL DEFAULT false;
