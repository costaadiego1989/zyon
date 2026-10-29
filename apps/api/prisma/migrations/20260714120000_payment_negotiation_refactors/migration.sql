-- Refactor: Add expires_at + reaper pattern for crypto reservation (PAYMENT H1)
ALTER TABLE "payment_crypto_transfers"
ADD COLUMN "expires_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '5 minutes';

-- Create index for reaper: find expired reservations
CREATE INDEX "payment_crypto_transfers_expires_at_idx" ON "payment_crypto_transfers"("expires_at");

-- Refactor: Add unique partial index for negotiation concurrent-apply protection (NEGOTIATION H2)
-- This ensures only one offer_applied entry per session, blocking concurrent applies
CREATE UNIQUE INDEX "negotiation_cost_ledger_entries_session_offer_applied_unique"
ON "negotiation_cost_ledger_entries" ("negotiation_session_id")
WHERE "event_type" = 'negotiation.offer_applied';

-- Refactor: Change ledger semantics — split amountCents into semantic columns (NEGOTIATION C3)
-- Add new columns for clarity without breaking existing data
ALTER TABLE "negotiation_cost_ledger_entries"
ADD COLUMN "ai_cost_cents" INTEGER,
ADD COLUMN "discount_basis_points" INTEGER;

-- Migration logic: populate new columns based on eventType
-- For 'negotiation.evaluated' → aiCostCents, for 'negotiation.offer_applied' → discountBasisPoints
UPDATE "negotiation_cost_ledger_entries"
SET "ai_cost_cents" = CASE WHEN "event_type" = 'negotiation.evaluated' THEN "amount_cents" ELSE NULL END,
    "discount_basis_points" = CASE WHEN "event_type" = 'negotiation.offer_applied' THEN "amount_cents" ELSE NULL END;

-- Note: amountCents is kept for backward compatibility but should be deprecated
-- Future work: remove amountCents column after 2 release cycles
