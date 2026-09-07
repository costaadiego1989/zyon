-- Each observation must retain the provenance and completeness of its metrics.
-- Existing observations predate this contract and are rehydrated as insufficient.
ALTER TABLE "revenue_manager_observations"
  ADD COLUMN IF NOT EXISTS "data_quality_json" JSONB NOT NULL DEFAULT '{}'::jsonb;
