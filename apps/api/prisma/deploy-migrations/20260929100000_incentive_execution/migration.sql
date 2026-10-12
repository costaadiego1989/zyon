CREATE TABLE strategy_incentive_executions (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, strategy_id TEXT NOT NULL, version INTEGER NOT NULL,
  review_id TEXT NOT NULL UNIQUE, budget_id TEXT NOT NULL UNIQUE, recommendation JSONB NOT NULL,
  recommendation_hash TEXT NOT NULL CHECK (recommendation_hash ~ '^[a-f0-9]{64}$'),
  started_at TIMESTAMP(3) NOT NULL, ends_at TIMESTAMP(3) NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(strategy_id, merchant_id), UNIQUE(id, merchant_id),
  FOREIGN KEY(budget_id,merchant_id) REFERENCES strategy_incentive_budgets(id,merchant_id) ON DELETE RESTRICT,
  FOREIGN KEY(review_id,merchant_id) REFERENCES strategy_incentive_reviews(id,merchant_id) ON DELETE RESTRICT,
  CHECK (ends_at = started_at + INTERVAL '7 days' AND created_at <= started_at)
);
CREATE INDEX strategy_incentive_executions_merchant_id_ends_at_idx ON strategy_incentive_executions(merchant_id,ends_at);
CREATE TABLE strategy_incentive_assignments (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, execution_id TEXT NOT NULL, session_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL, arm TEXT NOT NULL CHECK (arm IN ('control','treatment')),
  assigned_at TIMESTAMP(3) NOT NULL, cart_hash TEXT NOT NULL CHECK (cart_hash ~ '^[a-f0-9]{64}$'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  reservation_id TEXT UNIQUE,
  UNIQUE(merchant_id,session_id), UNIQUE(execution_id,merchant_id,buyer_id), UNIQUE(id,merchant_id),
  FOREIGN KEY(execution_id,merchant_id) REFERENCES strategy_incentive_executions(id,merchant_id) ON DELETE RESTRICT,
  FOREIGN KEY(merchant_id,session_id) REFERENCES checkout_sessions(merchant_id,session_id) ON DELETE RESTRICT,
  FOREIGN KEY(reservation_id) REFERENCES strategy_incentive_reservations(id) ON DELETE RESTRICT,
  CHECK ((arm='control' AND amount_cents=0 AND reservation_id IS NULL) OR (arm='treatment' AND amount_cents>0 AND reservation_id IS NOT NULL))
);
CREATE INDEX strategy_incentive_assignments_execution_id_merchant_id_arm_idx ON strategy_incentive_assignments(execution_id,merchant_id,arm);
CREATE TABLE strategy_incentive_payment_evidence (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, assignment_id TEXT NOT NULL, payment_id TEXT NOT NULL,
  payment_version INTEGER NOT NULL CHECK(payment_version > 0), status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), discount_cents INTEGER NOT NULL CHECK(discount_cents >= 0),
  occurred_at TIMESTAMP(3) NOT NULL,
  UNIQUE(payment_id,payment_version),
  FOREIGN KEY(assignment_id,merchant_id) REFERENCES strategy_incentive_assignments(id,merchant_id) ON DELETE RESTRICT,
  FOREIGN KEY(payment_id,merchant_id) REFERENCES payment_intents(id,merchant_id) ON DELETE RESTRICT
);
CREATE INDEX strategy_incentive_payment_evidence_assignment_merchant_time_idx ON strategy_incentive_payment_evidence(assignment_id,merchant_id,occurred_at);

CREATE FUNCTION guard_incentive_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b strategy_incentive_budgets; v revenue_strategy_versions; review strategy_incentive_reviews;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'incentive execution is immutable'; END IF;
  PERFORM id FROM merchants WHERE id=NEW.merchant_id FOR UPDATE;
  SELECT * INTO b FROM strategy_incentive_budgets WHERE id=NEW.budget_id AND merchant_id=NEW.merchant_id FOR SHARE;
  SELECT * INTO review FROM strategy_incentive_reviews WHERE id=NEW.review_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO v FROM revenue_strategy_versions WHERE strategy_id=NEW.strategy_id AND merchant_id=NEW.merchant_id AND version=NEW.version;
  IF b.id IS NULL OR b.closed_at IS NOT NULL OR b.review_id IS DISTINCT FROM NEW.review_id
    OR b.strategy_id IS DISTINCT FROM NEW.strategy_id OR b.version IS DISTINCT FROM NEW.version
    OR b.starts_at IS DISTINCT FROM NEW.started_at OR b.ends_at IS DISTINCT FROM NEW.ends_at
    OR review.kind IS DISTINCT FROM 'approve' OR review.recommendation_hash IS DISTINCT FROM NEW.recommendation_hash
    OR v.proposal->'incentiveRecommendation' IS DISTINCT FROM NEW.recommendation
    OR NOT EXISTS(SELECT 1 FROM strategy_incentive_review_heads WHERE merchant_id=NEW.merchant_id
      AND strategy_id=NEW.strategy_id AND version=NEW.version AND current_sequence=1)
    OR EXISTS(SELECT 1 FROM strategy_executions WHERE merchant_id=NEW.merchant_id AND status IN ('running','paused'))
    OR EXISTS(SELECT 1 FROM prompt_experiments WHERE merchant_id=NEW.merchant_id AND status='running')
    OR EXISTS(SELECT 1 FROM strategy_incentive_executions e JOIN strategy_incentive_budgets eb ON eb.id=e.budget_id
      WHERE e.merchant_id=NEW.merchant_id AND e.ends_at>(clock_timestamp() AT TIME ZONE 'UTC') AND eb.closed_at IS NULL)
  THEN RAISE EXCEPTION 'incentive execution prerequisites changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER incentive_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_executions
  FOR EACH ROW EXECUTE FUNCTION guard_incentive_execution();

CREATE FUNCTION guard_incentive_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e strategy_incentive_executions; b strategy_incentive_budgets; s checkout_sessions; r strategy_incentive_reservations;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'incentive assignment is immutable'; END IF;
  PERFORM id FROM merchants WHERE id=NEW.merchant_id FOR UPDATE;
  SELECT * INTO e FROM strategy_incentive_executions WHERE id=NEW.execution_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO b FROM strategy_incentive_budgets WHERE id=e.budget_id AND merchant_id=NEW.merchant_id FOR SHARE;
  SELECT * INTO s FROM checkout_sessions WHERE merchant_id=NEW.merchant_id AND session_id=NEW.session_id FOR SHARE;
  SELECT * INTO r FROM strategy_incentive_reservations WHERE id=NEW.reservation_id;
  IF e.id IS NULL OR b.closed_at IS NOT NULL OR s.id IS NULL OR s.global_user_id IS DISTINCT FROM NEW.buyer_id
    OR s.cohort IS DISTINCT FROM 'treatment' OR s.created_at<e.started_at OR NEW.assigned_at<e.started_at OR NEW.assigned_at>=e.ends_at
    OR (clock_timestamp() AT TIME ZONE 'UTC')>=e.ends_at
    OR EXISTS(SELECT 1 FROM strategy_assignments WHERE merchant_id=NEW.merchant_id AND session_id=NEW.session_id)
    OR EXISTS(SELECT 1 FROM payment_intents WHERE merchant_id=NEW.merchant_id AND session_id=NEW.session_id)
    OR EXISTS(SELECT 1 FROM completed_orders WHERE merchant_id=NEW.merchant_id AND session_id=NEW.session_id)
    OR NOT EXISTS(SELECT 1 FROM strategy_incentive_review_heads WHERE merchant_id=NEW.merchant_id
      AND strategy_id=e.strategy_id AND version=e.version AND current_sequence=1)
    OR (NEW.arm='treatment' AND (r.id IS NULL OR r.merchant_id<>NEW.merchant_id OR r.budget_id<>e.budget_id
      OR r.session_id<>NEW.session_id OR r.buyer_id<>NEW.buyer_id OR r.amount_cents<>NEW.amount_cents OR r.status<>'reserved'))
  THEN RAISE EXCEPTION 'incentive assignment prerequisites changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER incentive_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_incentive_assignment();

CREATE FUNCTION guard_incentive_payment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payment_intents; a strategy_incentive_assignments;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'incentive payment evidence is immutable'; END IF;
  SELECT * INTO p FROM payment_intents WHERE id=NEW.payment_id AND merchant_id=NEW.merchant_id FOR SHARE;
  SELECT * INTO a FROM strategy_incentive_assignments WHERE id=NEW.assignment_id AND merchant_id=NEW.merchant_id;
  IF p.id IS NULL OR a.id IS NULL OR p.session_id IS DISTINCT FROM a.session_id
    OR p.version IS DISTINCT FROM NEW.payment_version OR p.status IS DISTINCT FROM NEW.status
    OR COALESCE(p.approved_amount_cents,p.amount_cents) IS DISTINCT FROM NEW.amount_cents
    OR COALESCE((p.amount_breakdown->>'discountCents')::integer,0) IS DISTINCT FROM NEW.discount_cents
  THEN RAISE EXCEPTION 'incentive payment evidence does not match durable payment'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER incentive_payment_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_payment_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_incentive_payment_evidence();

-- The reciprocal gate also protects direct legacy experiment creation.
CREATE FUNCTION prevent_communication_incentive_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('running','paused') THEN
    PERFORM id FROM merchants WHERE id=NEW.merchant_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM strategy_incentive_executions e JOIN strategy_incentive_budgets b ON b.id=e.budget_id
      WHERE e.merchant_id=NEW.merchant_id AND b.closed_at IS NULL AND e.ends_at>(clock_timestamp() AT TIME ZONE 'UTC'))
    THEN RAISE EXCEPTION 'another incentive experiment is active'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER incentive_overlap_guard BEFORE INSERT OR UPDATE ON strategy_executions
  FOR EACH ROW EXECUTE FUNCTION prevent_communication_incentive_overlap();
CREATE TRIGGER incentive_overlap_guard BEFORE INSERT OR UPDATE ON prompt_experiments
  FOR EACH ROW EXECUTE FUNCTION prevent_communication_incentive_overlap();
