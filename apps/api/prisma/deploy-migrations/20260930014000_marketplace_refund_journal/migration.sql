CREATE TABLE IF NOT EXISTS marketplace_refund_plans (
  id TEXT PRIMARY KEY, funding_plan_id TEXT NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
  host_merchant_id TEXT NOT NULL, return_id TEXT NOT NULL UNIQUE REFERENCES returns(id) ON DELETE RESTRICT,
  input_hash TEXT NOT NULL, allocation JSONB NOT NULL, allocation_hash TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'blocked', 'submitted', 'confirmed', 'failed')),
  block_reason TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT marketplace_refund_allocation_conserved CHECK (
    (allocation->>'version')::int = 1 AND (allocation->>'amountCents')::int = amount_cents AND
    (allocation->>'merchantDebitCents')::bigint + (allocation->>'platformDebitCents')::bigint = amount_cents)
);
CREATE INDEX IF NOT EXISTS marketplace_refund_plans_host_merchant_id_status_idx ON marketplace_refund_plans(host_merchant_id, status);
CREATE INDEX IF NOT EXISTS marketplace_refund_plans_funding_plan_id_idx ON marketplace_refund_plans(funding_plan_id);
-- Replacing this constraint also hardens a database where the additive migration was partly applied.
ALTER TABLE marketplace_refund_plans DROP CONSTRAINT IF EXISTS marketplace_refund_allocation_conserved;
ALTER TABLE marketplace_refund_plans ADD CONSTRAINT marketplace_refund_allocation_conserved CHECK (COALESCE(
  jsonb_typeof(allocation) = 'object' AND
  jsonb_typeof(allocation->'version') = 'number' AND (allocation->>'version')::numeric = 1 AND
  jsonb_typeof(allocation->'amountCents') = 'number' AND (allocation->>'amountCents')::numeric = amount_cents AND
  jsonb_typeof(allocation->'merchantDebitCents') = 'number' AND
  jsonb_typeof(allocation->'platformDebitCents') = 'number' AND
  (allocation->>'merchantDebitCents')::numeric = trunc((allocation->>'merchantDebitCents')::numeric) AND
  (allocation->>'platformDebitCents')::numeric = trunc((allocation->>'platformDebitCents')::numeric) AND
  (allocation->>'platformDebitCents')::numeric >= 0 AND
  (allocation->>'merchantDebitCents')::numeric + (allocation->>'platformDebitCents')::numeric = amount_cents AND
  jsonb_typeof(allocation->'merchantDebits') = 'array' AND jsonb_typeof(allocation->'lines') = 'array' AND
  input_hash ~ '^[a-f0-9]{64}$' AND allocation_hash ~ '^[a-f0-9]{64}$', false));
CREATE TABLE IF NOT EXISTS marketplace_refund_operations (
  id TEXT PRIMARY KEY, refund_plan_id TEXT NOT NULL UNIQUE REFERENCES marketplace_refund_plans(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','asaas','mercadopago')), account_fingerprint TEXT NOT NULL,
  request JSONB NOT NULL, request_hash TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'unknown', 'pending', 'confirmed', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0), provider_operation_id TEXT,
  claimed_at TIMESTAMP(3), reconciled_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status NOT IN ('confirmed','failed') OR provider_operation_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_refund_operations_receipt_key ON marketplace_refund_operations(provider, account_fingerprint, provider_operation_id);
CREATE INDEX IF NOT EXISTS marketplace_refund_operations_status_updated_at_idx ON marketplace_refund_operations(status, updated_at);
CREATE OR REPLACE FUNCTION marketplace_refund_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.funding_plan_id, NEW.host_merchant_id, NEW.return_id, NEW.input_hash, NEW.allocation, NEW.allocation_hash, NEW.amount_cents, NEW.block_reason, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.funding_plan_id, OLD.host_merchant_id, OLD.return_id, OLD.input_hash, OLD.allocation, OLD.allocation_hash, OLD.amount_cents, OLD.block_reason, OLD.created_at) THEN
    RAISE EXCEPTION 'marketplace_refund_plan_immutable';
  END IF;
  IF OLD.status IN ('blocked','confirmed','failed') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'marketplace_refund_plan_terminal'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_refund_plan_immutable_trigger ON marketplace_refund_plans;
CREATE TRIGGER marketplace_refund_plan_immutable_trigger BEFORE UPDATE ON marketplace_refund_plans FOR EACH ROW EXECUTE FUNCTION marketplace_refund_plan_immutable();
CREATE OR REPLACE FUNCTION marketplace_refund_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.refund_plan_id, NEW.provider, NEW.account_fingerprint, NEW.request, NEW.request_hash, NEW.reference, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.refund_plan_id, OLD.provider, OLD.account_fingerprint, OLD.request, OLD.request_hash, OLD.reference, OLD.created_at) THEN
    RAISE EXCEPTION 'marketplace_refund_operation_immutable';
  END IF;
  IF OLD.provider_operation_id IS NOT NULL AND NEW.provider_operation_id IS DISTINCT FROM OLD.provider_operation_id THEN RAISE EXCEPTION 'marketplace_refund_receipt_immutable'; END IF;
  IF OLD.status IN ('confirmed','failed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_refund_operation_terminal'; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'marketplace_refund_version_required'; END IF;
  IF OLD.status <> 'planned' AND NEW.status = 'planned' AND (OLD.status <> 'unknown' OR OLD.provider_operation_id IS NOT NULL OR NEW.claimed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'marketplace_refund_submission_uncertain';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_refund_operation_immutable_trigger ON marketplace_refund_operations;
CREATE TRIGGER marketplace_refund_operation_immutable_trigger BEFORE UPDATE ON marketplace_refund_operations FOR EACH ROW EXECUTE FUNCTION marketplace_refund_operation_immutable();
