-- Scope payment provider webhook idempotency by provider + merchant + event id.
ALTER TABLE "payment_provider_events"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'asaas',
  ADD COLUMN "merchant_id" TEXT,
  ADD COLUMN "event_id" TEXT;

-- Backfill event_id from the legacy single-column primary key.
UPDATE "payment_provider_events" SET "event_id" = "id" WHERE "event_id" IS NULL;

ALTER TABLE "payment_provider_events" ALTER COLUMN "event_id" SET NOT NULL;

CREATE UNIQUE INDEX "payment_provider_events_provider_merchant_id_event_id_key"
  ON "payment_provider_events" ("provider", "merchant_id", "event_id");

CREATE INDEX "payment_provider_events_merchant_id_processed_at_idx"
  ON "payment_provider_events" ("merchant_id", "processed_at");

-- Reconciliation scan index on stale pending intents.
CREATE INDEX "payment_intents_status_updated_at_idx"
  ON "payment_intents" ("status", "updated_at");
