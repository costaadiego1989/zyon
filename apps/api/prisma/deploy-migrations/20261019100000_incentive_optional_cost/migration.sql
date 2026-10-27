-- Product cost is optional measurement, never discount authorization.
-- Existing values, immutable assignment triggers, checks, budgets and FKs stay intact.
-- Apply BEFORE enabling writers that persist unknown cost as NULL. No backfill.
ALTER TABLE "strategy_incentive_assignments" ALTER COLUMN "cost_cents" DROP NOT NULL;
