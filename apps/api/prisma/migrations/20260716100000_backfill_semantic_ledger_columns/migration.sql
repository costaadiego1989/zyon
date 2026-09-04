-- Refactor: Backfill semantic ledger columns for any rows written before the
-- writer was fixed to populate ai_cost_cents / discount_basis_points directly.
--
-- Context: amount_cents column was historically used to store two different
-- units depending on event_type (cost cents for negotiation.evaluated, basis
-- points for negotiation.offer_applied). An earlier migration split the schema
-- into ai_cost_cents + discount_basis_points, but the writer continued to
-- only populate amount_cents, leaving the new semantic columns NULL for
-- writes that happened after that migration.
--
-- This migration is idempotent and only fills rows where the semantic column
-- is still NULL, preserving any explicit values already written by the
-- corrected writer.
--
-- Forward path: amount_cents column is retained for backward compatibility
-- with legacy readers; deprecation window of 2 release cycles before removal.

UPDATE "negotiation_cost_ledger_entries"
SET "ai_cost_cents" = "amount_cents"
WHERE "event_type" = 'negotiation.evaluated'
  AND "ai_cost_cents" IS NULL;

UPDATE "negotiation_cost_ledger_entries"
SET "discount_basis_points" = "amount_cents"
WHERE "event_type" = 'negotiation.offer_applied'
  AND "discount_basis_points" IS NULL;