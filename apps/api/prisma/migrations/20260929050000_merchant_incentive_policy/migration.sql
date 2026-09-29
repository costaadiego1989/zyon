-- Versions are receipts, never edited or auto-enabled for existing stores.
CREATE TABLE merchant_incentive_policies (
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0), enabled BOOLEAN NOT NULL,
  limit_cents INTEGER NOT NULL, max_discount_cents INTEGER NOT NULL, max_redemptions INTEGER NOT NULL,
  policy_hash TEXT NOT NULL, actor_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (merchant_id, version), UNIQUE (merchant_id, request_key),
  CHECK (limit_cents >= 0 AND max_discount_cents >= 0 AND max_discount_cents <= limit_cents
    AND max_redemptions BETWEEN 0 AND 1000000
    AND ((limit_cents > 0 AND max_discount_cents > 0 AND max_redemptions > 0)
      OR (NOT enabled AND limit_cents = 0 AND max_discount_cents = 0 AND max_redemptions = 0))),
  CHECK (policy_hash ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$'
    AND request_key ~ '^[a-zA-Z0-9:_-]{1,150}$' AND length(trim(actor_id)) BETWEEN 1 AND 150)
);
-- A mutable head fences old REPEATABLE READ snapshots as well as concurrent
-- READ COMMITTED writers. Locking an unchanged merchant row alone is insufficient.
CREATE TABLE merchant_incentive_policy_heads (
  merchant_id TEXT PRIMARY KEY REFERENCES merchants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  current_version INTEGER NOT NULL CHECK (current_version > 0)
);
CREATE FUNCTION guard_merchant_incentive_policy_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'incentive policy head requires a new policy'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_incentive_policy_head_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_incentive_policy_heads
  FOR EACH ROW EXECUTE FUNCTION guard_merchant_incentive_policy_head();

CREATE FUNCTION guard_merchant_incentive_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'incentive policy history is immutable'; END IF;
  PERFORM id FROM merchants WHERE id = NEW.merchant_id FOR UPDATE;
  IF NEW.version = 1 THEN
    INSERT INTO merchant_incentive_policy_heads(merchant_id,current_version) VALUES (NEW.merchant_id,1);
  ELSE
    UPDATE merchant_incentive_policy_heads SET current_version = NEW.version
      WHERE merchant_id = NEW.merchant_id AND current_version = NEW.version - 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'incentive policy version conflict'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_incentive_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON merchant_incentive_policies
  FOR EACH ROW EXECUTE FUNCTION guard_merchant_incentive_policy();

-- Old envelopes remain valid financial history. Without a policy binding they
-- cannot make new reservations; resolution of existing reservations stays open.
ALTER TABLE strategy_incentive_budgets ADD COLUMN policy_version INTEGER;
ALTER TABLE strategy_incentive_budgets ADD CONSTRAINT strategy_incentive_budget_policy_fk
  FOREIGN KEY (merchant_id,policy_version) REFERENCES merchant_incentive_policies(merchant_id,version) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION guard_strategy_incentive_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b strategy_incentive_budgets; p merchant_incentive_policies; active_version INTEGER;
BEGIN
  PERFORM id FROM merchants WHERE id = NEW.merchant_id FOR UPDATE;
  SELECT current_version INTO active_version FROM merchant_incentive_policy_heads WHERE merchant_id = NEW.merchant_id FOR SHARE;
  SELECT * INTO p FROM merchant_incentive_policies WHERE merchant_id = NEW.merchant_id AND version = active_version;
  IF TG_TABLE_NAME = 'strategy_incentive_budgets' THEN b := NEW;
  ELSE SELECT * INTO b FROM strategy_incentive_budgets WHERE id = NEW.budget_id AND merchant_id = NEW.merchant_id;
  END IF;
  IF p.version IS NULL OR NOT p.enabled OR b.id IS NULL OR b.policy_version IS DISTINCT FROM p.version
    OR b.terms->'policyVersion' IS DISTINCT FROM to_jsonb(p.version) OR b.terms->>'policyHash' IS DISTINCT FROM p.policy_hash
    OR b.limit_cents > p.limit_cents OR b.max_discount_cents > p.max_discount_cents OR b.max_redemptions > p.max_redemptions
  THEN RAISE EXCEPTION 'incentive policy changed or unavailable'; END IF;
  RETURN NEW;
END $$;
-- Alphabetical ordering puts the policy lock before the existing budget and
-- session locks. Terminal reservation updates deliberately do not use this guard.
CREATE TRIGGER a_strategy_incentive_policy_guard BEFORE INSERT ON strategy_incentive_budgets
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_policy();
CREATE TRIGGER a_strategy_incentive_policy_guard BEFORE INSERT ON strategy_incentive_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_policy();

CREATE OR REPLACE FUNCTION guard_strategy_incentive_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v revenue_strategy_versions; s revenue_strategies; r revenue_analysis_runs;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'incentive budget is durable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['reserved_cents','spent_cents','reserved_count','spent_count','closed_at','closed_by','close_reason'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reserved_cents','spent_cents','reserved_count','spent_count','closed_at','closed_by','close_reason'])
    THEN RAISE EXCEPTION 'incentive budget terms are immutable'; END IF;
    IF ROW(NEW.reserved_cents,NEW.spent_cents,NEW.reserved_count,NEW.spent_count)
      IS DISTINCT FROM ROW(OLD.reserved_cents,OLD.spent_cents,OLD.reserved_count,OLD.spent_count) AND pg_trigger_depth() < 2
    THEN RAISE EXCEPTION 'incentive counters require reservation evidence'; END IF;
    IF ROW(NEW.closed_at,NEW.closed_by,NEW.close_reason) IS DISTINCT FROM ROW(OLD.closed_at,OLD.closed_by,OLD.close_reason)
      AND (OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL OR NEW.closed_at > (clock_timestamp() AT TIME ZONE 'UTC'))
    THEN RAISE EXCEPTION 'incentive budget closure is final'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM revenue_strategies WHERE id = NEW.strategy_id AND merchant_id = NEW.merchant_id FOR UPDATE;
  SELECT * INTO v FROM revenue_strategy_versions WHERE strategy_id = NEW.strategy_id AND merchant_id = NEW.merchant_id AND version = NEW.version;
  SELECT * INTO r FROM revenue_analysis_runs WHERE id = s.run_id AND merchant_id = NEW.merchant_id;
  IF v.strategy_id IS NULL OR s.current_version <> NEW.version OR s.status <> 'pending_review'
    OR v.proposal_hash <> NEW.proposal_hash OR v.expires_at <= (clock_timestamp() AT TIME ZONE 'UTC') OR NEW.approved_at < v.created_at
    OR NEW.approved_at > (clock_timestamp() AT TIME ZONE 'UTC') OR NEW.starts_at < (clock_timestamp() AT TIME ZONE 'UTC')
    OR NEW.reserved_cents <> 0 OR NEW.spent_cents <> 0 OR NEW.reserved_count <> 0 OR NEW.spent_count <> 0 OR NEW.closed_at IS NOT NULL
    OR v.proposal->'discountStudy' IS DISTINCT FROM r.discount_study_json
    OR v.proposal->'discountStudy'->>'status' IS DISTINCT FROM 'candidate_available'
    OR NEW.terms->>'definition' IS DISTINCT FROM 'strategy-incentive-budget-v2'
    OR NEW.terms->>'scope' IS DISTINCT FROM 'funding_only' OR NEW.terms->>'currency' IS DISTINCT FROM 'BRL'
    OR NEW.terms->>'merchantId' IS DISTINCT FROM NEW.merchant_id OR NEW.terms->>'strategyId' IS DISTINCT FROM NEW.strategy_id
    OR NEW.terms->'version' IS DISTINCT FROM to_jsonb(NEW.version) OR NEW.terms->>'proposalHash' IS DISTINCT FROM NEW.proposal_hash
    OR NEW.terms->'limitCents' IS DISTINCT FROM to_jsonb(NEW.limit_cents)
    OR NEW.terms->'maxDiscountCents' IS DISTINCT FROM to_jsonb(NEW.max_discount_cents)
    OR NEW.terms->'maxRedemptions' IS DISTINCT FROM to_jsonb(NEW.max_redemptions) OR NEW.terms->'maxPerBuyer' IS DISTINCT FROM '1'::jsonb
    OR (NEW.terms->>'startsAt')::timestamptz IS DISTINCT FROM NEW.starts_at AT TIME ZONE 'UTC'
    OR (NEW.terms->>'endsAt')::timestamptz IS DISTINCT FROM NEW.ends_at AT TIME ZONE 'UTC'
    OR NEW.max_discount_cents > (v.proposal->'discountStudy'->'candidate'->'simulation'->>'maxDiscountCents')::bigint
  THEN RAISE EXCEPTION 'incentive budget requires separate reviewed funding terms'; END IF;
  RETURN NEW;
END $$;
