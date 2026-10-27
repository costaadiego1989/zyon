CREATE TABLE IF NOT EXISTS marketplace_funding_plans (
  payment_intent_id TEXT PRIMARY KEY REFERENCES payment_intents(id) ON DELETE RESTRICT,
  host_merchant_id TEXT NOT NULL, checkout_session_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'asaas')),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  account_fingerprint TEXT NOT NULL, provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  instructions JSONB NOT NULL, instructions_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_capture' CHECK (status IN ('awaiting_capture', 'funded', 'held')),
  budget JSONB, provider_fee_cents INTEGER, net_amount_cents INTEGER,
  platform_retained_cents INTEGER, payout_total_cents INTEGER,
  funded_at TIMESTAMP(3), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT marketplace_funding_conservation CHECK (budget IS NULL OR
    (provider_payment_id IS NOT NULL AND provider_fee_cents IS NOT NULL AND provider_fee_cents >= 0 AND
     net_amount_cents IS NOT NULL AND net_amount_cents > 0 AND platform_retained_cents IS NOT NULL AND platform_retained_cents >= 0 AND
     payout_total_cents IS NOT NULL AND payout_total_cents > 0 AND
     amount_cents = net_amount_cents + provider_fee_cents AND net_amount_cents = platform_retained_cents + payout_total_cents))
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_funding_plans_capture_key
  ON marketplace_funding_plans(provider, account_fingerprint, provider_payment_id);
CREATE INDEX IF NOT EXISTS marketplace_funding_plans_order_idx ON marketplace_funding_plans(host_merchant_id, provider_payment_id);
CREATE INDEX IF NOT EXISTS marketplace_funding_plans_status_updated_at_idx ON marketplace_funding_plans(status, updated_at);

ALTER TABLE marketplace_payouts ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE marketplace_payouts SET id = settlement_id WHERE id IS NULL;
ALTER TABLE marketplace_payouts ALTER COLUMN id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'marketplace_payouts'::regclass AND contype = 'p'
    AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') THEN
    ALTER TABLE marketplace_payouts DROP CONSTRAINT marketplace_payouts_pkey;
    ALTER TABLE marketplace_payouts ADD PRIMARY KEY (id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_payouts_settlement_id_key ON marketplace_payouts(settlement_id);
ALTER TABLE marketplace_payouts ALTER COLUMN settlement_id DROP NOT NULL;
ALTER TABLE marketplace_payouts ADD COLUMN IF NOT EXISTS funding_plan_id TEXT REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT;
ALTER TABLE marketplace_payouts ADD COLUMN IF NOT EXISTS beneficiary_merchant_id TEXT;
ALTER TABLE marketplace_payouts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'seller_settlement';
ALTER TABLE marketplace_payouts ADD COLUMN IF NOT EXISTS due_at TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS marketplace_payouts_funding_plan_id_idx ON marketplace_payouts(funding_plan_id);
CREATE TABLE IF NOT EXISTS marketplace_host_debts (
  payout_id TEXT PRIMARY KEY REFERENCES marketplace_payouts(id) ON DELETE RESTRICT,
  host_merchant_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'outstanding', created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS marketplace_host_debts_host_merchant_id_status_idx ON marketplace_host_debts(host_merchant_id, status);

CREATE OR REPLACE FUNCTION marketplace_funding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.payment_intent_id, NEW.host_merchant_id, NEW.checkout_session_id, NEW.provider, NEW.environment,
      NEW.account_fingerprint, NEW.amount_cents, NEW.instructions, NEW.instructions_hash)
    IS DISTINCT FROM (OLD.payment_intent_id, OLD.host_merchant_id, OLD.checkout_session_id, OLD.provider, OLD.environment,
      OLD.account_fingerprint, OLD.amount_cents, OLD.instructions, OLD.instructions_hash) THEN
    RAISE EXCEPTION 'marketplace_funding_instructions_immutable';
  END IF;
  IF OLD.budget IS NOT NULL AND (NEW.budget, NEW.provider_payment_id, NEW.provider_fee_cents, NEW.net_amount_cents,
      NEW.platform_retained_cents, NEW.payout_total_cents, NEW.funded_at)
    IS DISTINCT FROM (OLD.budget, OLD.provider_payment_id, OLD.provider_fee_cents, OLD.net_amount_cents,
      OLD.platform_retained_cents, OLD.payout_total_cents, OLD.funded_at) THEN
    RAISE EXCEPTION 'marketplace_funding_budget_immutable';
  END IF;
  IF OLD.status = 'held' AND NEW.status <> 'held' THEN RAISE EXCEPTION 'marketplace_funding_reallocation_required'; END IF;
  IF OLD.status = 'funded' AND NEW.status NOT IN ('funded', 'held') THEN RAISE EXCEPTION 'marketplace_funding_already_reserved'; END IF;
  IF NEW.status = 'funded' AND NEW.budget IS NULL THEN RAISE EXCEPTION 'marketplace_funding_evidence_required'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_funding_immutable_trigger ON marketplace_funding_plans;
CREATE TRIGGER marketplace_funding_immutable_trigger BEFORE UPDATE ON marketplace_funding_plans FOR EACH ROW EXECUTE FUNCTION marketplace_funding_immutable();

CREATE OR REPLACE FUNCTION marketplace_funded_payout_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.funding_plan_id IS NULL AND NEW.funding_plan_id IS NOT NULL THEN
    RAISE EXCEPTION 'marketplace_funded_payout_binding_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.funding_plan_id IS NOT NULL AND
    (NEW.id, NEW.settlement_id, NEW.funding_plan_id, NEW.beneficiary_merchant_id, NEW.kind, NEW.due_at,
     NEW.provider, NEW.account_fingerprint, NEW.provider_payment_id, NEW.destination, NEW.amount_cents, NEW.currency, NEW.reference)
    IS DISTINCT FROM
    (OLD.id, OLD.settlement_id, OLD.funding_plan_id, OLD.beneficiary_merchant_id, OLD.kind, OLD.due_at,
     OLD.provider, OLD.account_fingerprint, OLD.provider_payment_id, OLD.destination, OLD.amount_cents, OLD.currency, OLD.reference) THEN
    RAISE EXCEPTION 'marketplace_funded_payout_immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.funding_plan_id IS NOT NULL AND
    (SELECT status FROM marketplace_funding_plans WHERE payment_intent_id = NEW.funding_plan_id) <> 'awaiting_capture' THEN
    RAISE EXCEPTION 'marketplace_funding_budget_already_reserved';
  END IF;
  IF NEW.settlement_id IS NULL AND (NEW.funding_plan_id IS NULL OR NEW.beneficiary_merchant_id IS NULL OR NEW.due_at IS NULL OR NEW.kind <> 'host_receivable') THEN
    RAISE EXCEPTION 'marketplace_host_receivable_binding_required';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_funded_payout_immutable_trigger ON marketplace_payouts;
CREATE TRIGGER marketplace_funded_payout_immutable_trigger BEFORE INSERT OR UPDATE ON marketplace_payouts FOR EACH ROW EXECUTE FUNCTION marketplace_funded_payout_immutable();
