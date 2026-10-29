CREATE TABLE strategy_incentive_budgets (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, strategy_id TEXT NOT NULL, version INTEGER NOT NULL,
  proposal_hash TEXT NOT NULL, terms_hash TEXT NOT NULL, terms JSONB NOT NULL,
  actor_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  limit_cents INTEGER NOT NULL, max_discount_cents INTEGER NOT NULL, max_redemptions INTEGER NOT NULL,
  reserved_cents INTEGER NOT NULL DEFAULT 0, spent_cents INTEGER NOT NULL DEFAULT 0,
  reserved_count INTEGER NOT NULL DEFAULT 0, spent_count INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMP(3) NOT NULL, ends_at TIMESTAMP(3) NOT NULL, approved_at TIMESTAMP(3) NOT NULL,
  closed_at TIMESTAMP(3), closed_by TEXT, close_reason TEXT,
  UNIQUE (id, merchant_id), UNIQUE (merchant_id, request_key), UNIQUE (strategy_id, merchant_id),
  FOREIGN KEY (strategy_id, merchant_id, version) REFERENCES revenue_strategy_versions(strategy_id, merchant_id, version) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (limit_cents > 0 AND max_discount_cents > 0 AND max_discount_cents <= limit_cents
    AND max_redemptions BETWEEN 1 AND 1000000),
  CHECK (reserved_cents >= 0 AND spent_cents >= 0 AND reserved_cents::bigint + spent_cents <= limit_cents
    AND reserved_count >= 0 AND spent_count >= 0 AND reserved_count::bigint + spent_count <= max_redemptions),
  CHECK (ends_at = starts_at + interval '7 days' AND approved_at <= starts_at),
  CHECK (proposal_hash ~ '^[a-f0-9]{64}$' AND terms_hash ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$'
    AND request_key ~ '^[a-zA-Z0-9:_-]{1,150}$' AND length(trim(actor_id)) BETWEEN 1 AND 150),
  CHECK ((closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL)
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_reason IS NOT NULL AND closed_at >= approved_at
      AND length(trim(closed_by)) BETWEEN 1 AND 150 AND length(trim(close_reason)) BETWEEN 1 AND 500))
);

CREATE TABLE strategy_incentive_reservations (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, budget_id TEXT NOT NULL, session_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, reserved_at TIMESTAMP(3) NOT NULL, status TEXT NOT NULL DEFAULT 'reserved',
  spent_cents INTEGER, resolved_at TIMESTAMP(3), evidence_key TEXT, resolution_hash TEXT,
  UNIQUE (budget_id, merchant_id, request_key), UNIQUE (budget_id, merchant_id, evidence_key),
  FOREIGN KEY (budget_id, merchant_id) REFERENCES strategy_incentive_budgets(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (merchant_id, session_id) REFERENCES checkout_sessions(merchant_id, session_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (amount_cents > 0 AND length(trim(buyer_id)) > 0 AND request_key ~ '^[a-zA-Z0-9:_-]{1,150}$'
    AND request_hash ~ '^[a-f0-9]{64}$'),
  CHECK ((status = 'reserved' AND spent_cents IS NULL AND resolved_at IS NULL AND evidence_key IS NULL AND resolution_hash IS NULL)
    OR (status IN ('spent','released') AND spent_cents IS NOT NULL AND resolved_at IS NOT NULL AND evidence_key IS NOT NULL
      AND resolution_hash IS NOT NULL AND resolved_at >= reserved_at AND evidence_key ~ '^[a-zA-Z0-9:_-]{1,150}$'
      AND resolution_hash ~ '^[a-f0-9]{64}$'
      AND ((status = 'spent' AND spent_cents > 0 AND spent_cents <= amount_cents) OR (status = 'released' AND spent_cents = 0))))
);
CREATE INDEX strategy_incentive_reservations_budget_status_idx ON strategy_incentive_reservations(budget_id, merchant_id, status);
-- Released attempts can be replaced with a NEW key. Spent/uncertain attempts
-- keep the per-buyer and per-session slot, even in another checkout session.
CREATE UNIQUE INDEX strategy_incentive_live_buyer ON strategy_incentive_reservations(budget_id, merchant_id, buyer_id) WHERE status <> 'released';
CREATE UNIQUE INDEX strategy_incentive_live_session ON strategy_incentive_reservations(budget_id, merchant_id, session_id) WHERE status <> 'released';

CREATE FUNCTION guard_strategy_incentive_budget() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR NEW.terms->>'definition' IS DISTINCT FROM 'strategy-incentive-budget-v1'
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
CREATE TRIGGER strategy_incentive_budget_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_budgets
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_budget();

CREATE FUNCTION guard_strategy_incentive_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b strategy_incentive_budgets; s checkout_sessions;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'incentive reservation is durable'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO s FROM checkout_sessions WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id FOR SHARE;
    IF s.id IS NULL OR s.global_user_id <> NEW.buyer_id OR s.cohort IS DISTINCT FROM 'treatment' OR s.cart->>'currency' IS DISTINCT FROM 'BRL'
      OR NEW.status <> 'reserved' OR NEW.spent_cents IS NOT NULL OR NEW.resolved_at IS NOT NULL OR NEW.evidence_key IS NOT NULL
      OR NEW.resolution_hash IS NOT NULL OR NEW.amount_cents <= 0
      OR NEW.reserved_at > (clock_timestamp() AT TIME ZONE 'UTC')
    THEN RAISE EXCEPTION 'incentive reservation context invalid'; END IF;
    -- Updating the parent, rather than just locking a static row and summing
    -- children, also fences concurrent REPEATABLE READ snapshots (40001).
    UPDATE strategy_incentive_budgets SET reserved_cents = reserved_cents + NEW.amount_cents, reserved_count = reserved_count + 1
      WHERE id = NEW.budget_id AND merchant_id = NEW.merchant_id AND closed_at IS NULL
        AND starts_at <= NEW.reserved_at AND NEW.reserved_at < ends_at AND (clock_timestamp() AT TIME ZONE 'UTC') < ends_at
        AND NEW.amount_cents <= max_discount_cents AND reserved_cents::bigint + spent_cents + NEW.amount_cents <= limit_cents
        AND reserved_count::bigint + spent_count < max_redemptions
      RETURNING * INTO b;
    IF b.id IS NULL THEN RAISE EXCEPTION 'incentive budget unavailable or exhausted'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','spent_cents','resolved_at','evidence_key','resolution_hash'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','spent_cents','resolved_at','evidence_key','resolution_hash'])
    OR OLD.status <> 'reserved' OR NEW.status NOT IN ('spent','released') OR NEW.spent_cents IS NULL
    OR NEW.spent_cents < 0 OR NEW.spent_cents > OLD.amount_cents
    OR (NEW.status = 'spent' AND NEW.spent_cents = 0) OR (NEW.status = 'released' AND NEW.spent_cents <> 0)
    OR NEW.resolved_at IS NULL OR NEW.resolved_at < OLD.reserved_at OR NEW.resolved_at > (clock_timestamp() AT TIME ZONE 'UTC')
  THEN RAISE EXCEPTION 'incentive resolution is invalid or final'; END IF;
  UPDATE strategy_incentive_budgets SET reserved_cents = reserved_cents - OLD.amount_cents,
    reserved_count = reserved_count - 1, spent_cents = spent_cents + NEW.spent_cents,
    spent_count = spent_count + CASE WHEN NEW.status = 'spent' THEN 1 ELSE 0 END
    WHERE id = OLD.budget_id AND merchant_id = OLD.merchant_id;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_incentive_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_reservation();
