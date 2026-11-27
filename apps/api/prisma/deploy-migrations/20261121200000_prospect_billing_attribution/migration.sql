ALTER TABLE prospect_billing_proposals ADD COLUMN conversion_eligible boolean NOT NULL DEFAULT false;
CREATE TABLE prospect_billing_receipts(
  provider text NOT NULL, event_id text NOT NULL, proposal_id text NOT NULL REFERENCES prospect_billing_proposals(id) ON DELETE RESTRICT,
  subscription_id text NOT NULL, payment_ref text NOT NULL, state text NOT NULL CHECK(state IN ('paid','refunded')),
  amount_cents bigint NOT NULL CHECK(amount_cents>0), occurred_at timestamptz NOT NULL,
  PRIMARY KEY(provider,event_id)
);
CREATE INDEX prospect_billing_receipts_payment_idx ON prospect_billing_receipts(provider,subscription_id,payment_ref);
CREATE UNIQUE INDEX prospect_subscription_conversion_unique ON prospect_conversions(provider,subscription_id,state) WHERE state IN ('paid','refunded');
