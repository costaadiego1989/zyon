ALTER TABLE "negotiation_sessions"
ADD COLUMN IF NOT EXISTS "applied_offer_json" JSONB;
