-- Human decisions are independent of communication approval. No backfill and
-- no checkout activation: old envelopes retain settlement, not new authority.
CREATE TABLE strategy_incentive_reviews (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, strategy_id TEXT NOT NULL, version INTEGER NOT NULL,
  sequence INTEGER NOT NULL, kind TEXT NOT NULL, proposal_hash TEXT NOT NULL, recommendation_hash TEXT NOT NULL,
  policy_version INTEGER NOT NULL, policy_hash TEXT NOT NULL, actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL, request_hash TEXT NOT NULL, feedback TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP(3) NOT NULL,
  UNIQUE(id,merchant_id), UNIQUE(strategy_id,merchant_id,request_key), UNIQUE(strategy_id,merchant_id,version,sequence),
  FOREIGN KEY(strategy_id,merchant_id,version) REFERENCES revenue_strategy_versions(strategy_id,merchant_id,version) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((sequence = 1 AND kind IN ('approve','reject')) OR (sequence = 2 AND kind = 'withdraw')),
  CHECK (proposal_hash ~ '^[a-f0-9]{64}$' AND recommendation_hash ~ '^[a-f0-9]{64}$' AND policy_hash ~ '^[a-f0-9]{64}$'
    AND request_hash ~ '^[a-f0-9]{64}$' AND request_key ~ '^[a-zA-Z0-9:_-]{1,150}$'
    AND length(trim(actor_id)) BETWEEN 1 AND 150 AND (feedback IS NULL OR length(feedback) <= 2000))
);
CREATE TABLE strategy_incentive_review_heads (
  strategy_id TEXT NOT NULL, merchant_id TEXT NOT NULL, version INTEGER NOT NULL, current_sequence INTEGER NOT NULL CHECK(current_sequence IN (1,2)),
  PRIMARY KEY(strategy_id,merchant_id,version),
  FOREIGN KEY(strategy_id,merchant_id,version) REFERENCES revenue_strategy_versions(strategy_id,merchant_id,version) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION guard_strategy_incentive_review_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'incentive review head requires a decision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_incentive_review_head_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_review_heads
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_review_head();

CREATE FUNCTION guard_strategy_incentive_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s revenue_strategies; v revenue_strategy_versions; r revenue_analysis_runs; previous strategy_incentive_reviews;
  policy merchant_incentive_policies; active_policy INTEGER; recommendation JSONB; plan JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'incentive review history is immutable'; END IF;
  PERFORM id FROM merchants WHERE id = NEW.merchant_id FOR UPDATE;
  SELECT current_version INTO active_policy FROM merchant_incentive_policy_heads WHERE merchant_id = NEW.merchant_id FOR SHARE;
  SELECT * INTO s FROM revenue_strategies WHERE id = NEW.strategy_id AND merchant_id = NEW.merchant_id FOR UPDATE;
  SELECT * INTO v FROM revenue_strategy_versions WHERE strategy_id = NEW.strategy_id AND merchant_id = NEW.merchant_id AND version = NEW.version;
  recommendation := v.proposal->'incentiveRecommendation'; plan := recommendation->'planning';
  IF s.id IS NULL OR v.strategy_id IS NULL OR v.proposal_hash IS DISTINCT FROM NEW.proposal_hash
    OR NEW.expires_at IS DISTINCT FROM v.expires_at OR NEW.created_at < v.created_at OR NEW.created_at > (clock_timestamp() AT TIME ZONE 'UTC')
    OR recommendation->>'status' IS DISTINCT FROM 'recommended'
    OR recommendation->'financialPolicy'->'version' IS DISTINCT FROM to_jsonb(NEW.policy_version)
    OR recommendation->'financialPolicy'->>'policyHash' IS DISTINCT FROM NEW.policy_hash
  THEN RAISE EXCEPTION 'incentive review proposal changed'; END IF;
  IF NEW.kind = 'withdraw' THEN
    SELECT * INTO previous FROM strategy_incentive_reviews WHERE strategy_id = NEW.strategy_id AND merchant_id = NEW.merchant_id AND version = NEW.version AND sequence = 1;
    IF previous.id IS NULL OR previous.kind <> 'approve' OR previous.recommendation_hash IS DISTINCT FROM NEW.recommendation_hash
      OR NEW.created_at < previous.created_at THEN RAISE EXCEPTION 'incentive withdrawal requires approval'; END IF;
    UPDATE strategy_incentive_review_heads SET current_sequence = 2
      WHERE strategy_id = NEW.strategy_id AND merchant_id = NEW.merchant_id AND version = NEW.version AND current_sequence = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'incentive review decision conflict'; END IF;
  ELSE
    IF s.current_version <> NEW.version THEN RAISE EXCEPTION 'incentive review version changed'; END IF;
    IF NEW.kind = 'approve' THEN
      SELECT * INTO r FROM revenue_analysis_runs WHERE id = s.run_id AND merchant_id = NEW.merchant_id FOR SHARE;
      SELECT * INTO policy FROM merchant_incentive_policies WHERE merchant_id = NEW.merchant_id AND version = active_policy;
      IF s.status NOT IN ('pending_review','activation_pending','active') OR v.expires_at <= (clock_timestamp() AT TIME ZONE 'UTC')
        OR r.id IS NULL OR r.status IS DISTINCT FROM 'completed' OR policy.version IS NULL OR NOT policy.enabled
        OR policy.version IS DISTINCT FROM NEW.policy_version OR policy.policy_hash IS DISTINCT FROM NEW.policy_hash
        OR NOT EXISTS (SELECT 1 FROM revenue_analysis_schedules WHERE merchant_id = NEW.merchant_id)
        OR recommendation IS DISTINCT FROM r.incentive_recommendation_json
        OR v.proposal->'discountStudy' IS DISTINCT FROM r.discount_study_json
        OR recommendation->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v2'
        OR recommendation->>'merchantId' IS DISTINCT FROM NEW.merchant_id OR recommendation->>'runId' IS DISTINCT FROM r.id
        OR recommendation->>'observationId' IS DISTINCT FROM r.observation_id
        OR recommendation->'financialPolicy'->'enabled' IS DISTINCT FROM 'true'::jsonb
        OR plan->>'definition' IS DISTINCT FROM 'incentive-fixed-horizon-planning-v1'
        OR plan->>'status' IS DISTINCT FROM 'estimated_feasible' OR plan->'blockers' IS DISTINCT FROM '[]'::jsonb
        OR plan->'baseline'->'complete' IS DISTINCT FROM 'true'::jsonb
      THEN RAISE EXCEPTION 'incentive review approval prerequisites required'; END IF;
    END IF;
    INSERT INTO strategy_incentive_review_heads(strategy_id,merchant_id,version,current_sequence) VALUES(NEW.strategy_id,NEW.merchant_id,NEW.version,1);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_incentive_review_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_review();

ALTER TABLE strategy_incentive_budgets ADD COLUMN review_id TEXT;
ALTER TABLE strategy_incentive_budgets ADD CONSTRAINT strategy_incentive_budget_review_fk
  FOREIGN KEY(review_id,merchant_id) REFERENCES strategy_incentive_reviews(id,merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION guard_strategy_incentive_specific_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b strategy_incentive_budgets; review strategy_incentive_reviews; current_sequence INTEGER;
BEGIN
  -- Runs after policy and recommendation guards, preserving the same lock order.
  IF TG_TABLE_NAME = 'strategy_incentive_budgets' THEN b := NEW;
  ELSE SELECT * INTO b FROM strategy_incentive_budgets WHERE id = NEW.budget_id AND merchant_id = NEW.merchant_id; END IF;
  SELECT h.current_sequence INTO current_sequence FROM strategy_incentive_review_heads h
    WHERE h.strategy_id = b.strategy_id AND h.merchant_id = b.merchant_id AND h.version = b.version FOR SHARE;
  SELECT * INTO review FROM strategy_incentive_reviews WHERE id = b.review_id AND merchant_id = b.merchant_id;
  IF review.id IS NULL OR current_sequence IS DISTINCT FROM 1 OR review.kind IS DISTINCT FROM 'approve'
    OR review.strategy_id IS DISTINCT FROM b.strategy_id OR review.version IS DISTINCT FROM b.version
    OR review.proposal_hash IS DISTINCT FROM b.proposal_hash OR review.policy_version IS DISTINCT FROM b.policy_version
    OR review.policy_hash IS DISTINCT FROM b.terms->>'policyHash' OR review.actor_id IS DISTINCT FROM b.actor_id
    OR b.approved_at < review.created_at OR b.starts_at <= review.created_at OR b.starts_at >= review.expires_at
    OR (TG_TABLE_NAME = 'strategy_incentive_budgets' AND review.expires_at <= (clock_timestamp() AT TIME ZONE 'UTC'))
  THEN RAISE EXCEPTION 'incentive requires specific merchant approval'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER c_strategy_incentive_specific_approval_guard BEFORE INSERT ON strategy_incentive_budgets
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_specific_approval();
CREATE TRIGGER c_strategy_incentive_specific_approval_guard BEFORE INSERT ON strategy_incentive_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_specific_approval();
