ALTER TABLE revenue_analysis_runs ADD COLUMN incentive_options_json JSONB;
ALTER TABLE merchant_incentive_policies ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE merchant_incentive_policies ADD COLUMN approved_review_id TEXT;
CREATE UNIQUE INDEX merchant_incentive_policies_approved_review_id_key ON merchant_incentive_policies(approved_review_id);
ALTER TABLE merchant_incentive_policies ADD CONSTRAINT merchant_incentive_policy_origin CHECK (
  origin IN ('manual','automatic') AND (approved_review_id IS NULL OR (origin='automatic' AND enabled))
  AND (origin<>'automatic' OR enabled OR (limit_cents=0 AND max_discount_cents=0 AND max_redemptions=0))
  AND (origin<>'automatic' OR NOT enabled OR approved_review_id IS NOT NULL));
ALTER TABLE merchant_incentive_policies ADD CONSTRAINT merchant_incentive_policy_approval_fk
  FOREIGN KEY(approved_review_id,merchant_id) REFERENCES strategy_incentive_reviews(id,merchant_id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- The catalog contains only schema-owned ASCII keys and integer/JSON numeric
-- values. Canonical hashing authenticates the same bytes as application digest.
CREATE FUNCTION revenue_canonical_json(value JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result TEXT; number_value DOUBLE PRECISION;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||revenue_canonical_json(val),',' ORDER BY key COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(value) AS e(key,val);
    WHEN 'array' THEN SELECT '['||COALESCE(string_agg(revenue_canonical_json(val),',' ORDER BY ordinal),'')||']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS a(val,ordinal);
    WHEN 'number' THEN
      number_value := value::text::double precision;
      IF number_value=0 THEN result := '0';
      ELSIF abs(number_value)>=0.000001 AND abs(number_value)<1e21 THEN
        result := number_value::text::numeric::text;
        IF position('.' IN result)>0 THEN result := rtrim(rtrim(result,'0'),'.'); END IF;
      ELSE result := regexp_replace(number_value::text,'e([+-])0+','e\1');
      END IF;
    ELSE result := value::text;
  END CASE;
  RETURN result;
END $$;
CREATE FUNCTION revenue_json_hash(value JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT encode(sha256(convert_to(revenue_canonical_json(value),'UTF8')),'hex');
$$;

CREATE FUNCTION revenue_proposal_matches_catalog(proposal JSONB, catalog JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE decision JSONB := proposal->'orchestration'; item JSONB;
BEGIN
  IF jsonb_typeof(catalog) IS DISTINCT FROM 'object' OR catalog->>'definition' IS DISTINCT FROM 'revenue-incentive-options-v1'
    OR jsonb_typeof(catalog->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(catalog->'options')>5
    OR jsonb_typeof(decision) IS DISTINCT FROM 'object' OR decision->>'definition' IS DISTINCT FROM 'revenue-strategy-orchestration-v1'
    OR decision->>'tool' IS DISTINCT FROM 'submit_revenue_strategy' OR decision->>'catalogHash' IS DISTINCT FROM revenue_json_hash(catalog)
    OR jsonb_typeof(decision->'rationale') IS DISTINCT FROM 'string' OR length(trim(decision->>'rationale')) NOT BETWEEN 1 AND 2000
    OR decision - ARRAY['definition','tool','catalogHash','selectedAction','rationale'] <> '{}'::jsonb
    OR catalog->>'studyHash' IS DISTINCT FROM revenue_json_hash(proposal->'discountStudy')
  THEN RETURN FALSE; END IF;
  IF decision->>'selectedAction'='communication_only' THEN RETURN NOT (proposal ? 'incentiveRecommendation'); END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(catalog->'options') LOOP
    IF item->>'id'=decision->>'selectedAction' THEN
      RETURN item->>'id' IS NOT DISTINCT FROM revenue_json_hash(item->'recommendation')
        AND item->'recommendation' IS NOT DISTINCT FROM proposal->'incentiveRecommendation';
    END IF;
  END LOOP;
  RETURN FALSE;
END $$;

CREATE FUNCTION guard_revenue_incentive_options() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item JSONB;
BEGIN
  IF TG_OP<>'INSERT' AND OLD.incentive_options_json IS NOT NULL THEN
    IF TG_OP='DELETE' OR NEW.incentive_options_json IS DISTINCT FROM OLD.incentive_options_json
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.as_of IS DISTINCT FROM OLD.as_of OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
      OR NEW.cycle IS DISTINCT FROM OLD.cycle OR NEW.discount_study_json IS DISTINCT FROM OLD.discount_study_json
    THEN RAISE EXCEPTION 'REVENUE_INCENTIVE_OPTIONS_IMMUTABLE'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.incentive_options_json IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.incentive_options_json) IS DISTINCT FROM 'object'
    OR NEW.incentive_options_json->>'definition' IS DISTINCT FROM 'revenue-incentive-options-v1'
    OR NEW.incentive_options_json->>'merchantId' IS DISTINCT FROM NEW.merchant_id
    OR NEW.incentive_options_json->>'runId' IS DISTINCT FROM NEW.id
    OR NEW.incentive_options_json->>'studyHash' IS DISTINCT FROM revenue_json_hash(NEW.discount_study_json)
    OR NEW.discount_study_json->>'definition' IS DISTINCT FROM 'weekly-discount-study-v3'
    OR jsonb_typeof(NEW.incentive_options_json->'options') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.incentive_options_json->'options')>5
  THEN RAISE EXCEPTION 'REVENUE_INCENTIVE_OPTIONS_INVALID'; END IF;
  IF TG_OP='INSERT' OR OLD.incentive_options_json IS NULL THEN
    IF NEW.status IS DISTINCT FROM 'running' OR NEW.lease_until IS NULL OR NEW.lease_until<=(clock_timestamp() AT TIME ZONE 'UTC')
      OR NEW.incentive_recommendation_json IS NOT NULL THEN RAISE EXCEPTION 'REVENUE_INCENTIVE_OPTIONS_CAPTURE_REQUIRED'; END IF;
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.incentive_options_json->'options') LOOP
    IF item->>'id' IS DISTINCT FROM revenue_json_hash(item->'recommendation')
      OR item->'recommendation'->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v4'
      OR item->'recommendation'->>'merchantId' IS DISTINCT FROM NEW.merchant_id
      OR item->'recommendation'->>'runId' IS DISTINCT FROM NEW.id
      OR item->'recommendation'->>'studyHash' IS DISTINCT FROM NEW.incentive_options_json->>'studyHash'
      OR item->'recommendation'->>'status' IS DISTINCT FROM 'recommended'
      OR item->'recommendation'->'planning'->>'status' IS DISTINCT FROM 'estimated_feasible'
      OR item->'recommendation'->'planning'->'blockers' IS DISTINCT FROM '[]'::jsonb
    THEN RAISE EXCEPTION 'REVENUE_INCENTIVE_OPTION_INVALID'; END IF;
  END LOOP;
  IF NEW.incentive_recommendation_json IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.incentive_options_json->'options') AS option
    WHERE option->'recommendation'=NEW.incentive_recommendation_json)
  THEN RAISE EXCEPTION 'REVENUE_INCENTIVE_SELECTION_NOT_IN_CATALOG'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revenue_incentive_options_guard BEFORE INSERT OR UPDATE OR DELETE ON revenue_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION guard_revenue_incentive_options();

CREATE FUNCTION guard_strategy_catalog_selection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s revenue_strategies; r revenue_analysis_runs;
BEGIN
  SELECT * INTO s FROM revenue_strategies WHERE id=NEW.strategy_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO r FROM revenue_analysis_runs WHERE id=s.run_id AND merchant_id=NEW.merchant_id;
  IF r.incentive_options_json IS NOT NULL AND revenue_proposal_matches_catalog(NEW.proposal,r.incentive_options_json) IS DISTINCT FROM TRUE
    THEN RAISE EXCEPTION 'STRATEGY_CATALOG_SELECTION_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_catalog_selection_guard BEFORE INSERT ON revenue_strategy_versions
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_catalog_selection();

CREATE FUNCTION guard_automatic_incentive_policy_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE review strategy_incentive_reviews; version_row revenue_strategy_versions; previous merchant_incentive_policies;
  recommendation JSONB; previous_hash TEXT;
BEGIN
  IF NEW.origin<>'automatic' OR NOT NEW.enabled THEN RETURN NEW; END IF;
  SELECT * INTO review FROM strategy_incentive_reviews WHERE id=NEW.approved_review_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO version_row FROM revenue_strategy_versions WHERE strategy_id=review.strategy_id AND merchant_id=NEW.merchant_id AND version=review.version;
  recommendation := version_row.proposal->'incentiveRecommendation';
  IF NEW.version>1 THEN
    SELECT * INTO previous FROM merchant_incentive_policies WHERE merchant_id=NEW.merchant_id AND version=NEW.version-1;
    IF previous.origin IS DISTINCT FROM 'automatic' THEN RAISE EXCEPTION 'manual incentive limits require explicit opt-in to automatic'; END IF;
    previous_hash := previous.policy_hash;
  ELSE
    previous_hash := revenue_json_hash(jsonb_build_object('definition','merchant-incentive-policy-v1','merchantId',NEW.merchant_id,
      'version',0,'enabled',false,'limitCents',0,'maxDiscountCents',0,'maxRedemptions',0));
  END IF;
  IF review.id IS NULL OR review.kind IS DISTINCT FROM 'approve' OR review.actor_id IS DISTINCT FROM NEW.actor_id
    OR review.policy_version IS DISTINCT FROM NEW.version OR review.policy_hash IS DISTINCT FROM NEW.policy_hash
    OR recommendation->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v4'
    OR recommendation->'policyProposal'->>'definition' IS DISTINCT FROM 'incentive-policy-proposal-v1'
    OR recommendation->'policyProposal'->>'previousPolicyHash' IS DISTINCT FROM previous_hash
    OR recommendation->'policyProposal'->'previousPolicyVersion' IS DISTINCT FROM to_jsonb(NEW.version-1)
    OR recommendation->'financialPolicy' IS DISTINCT FROM jsonb_build_object('merchantId',NEW.merchant_id,'version',NEW.version,
      'enabled',NEW.enabled,'limitCents',NEW.limit_cents,'maxDiscountCents',NEW.max_discount_cents,
      'maxRedemptions',NEW.max_redemptions,'policyHash',NEW.policy_hash)
  THEN RAISE EXCEPTION 'automatic incentive policy requires exact merchant approval'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER automatic_incentive_policy_approval_guard AFTER INSERT ON merchant_incentive_policies
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_automatic_incentive_policy_approval();

CREATE OR REPLACE FUNCTION guard_strategy_incentive_review() RETURNS trigger LANGUAGE plpgsql AS $$
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
        OR (policy.origin='automatic' AND policy.approved_review_id IS DISTINCT FROM NEW.id)
        OR NOT EXISTS (SELECT 1 FROM revenue_analysis_schedules WHERE merchant_id = NEW.merchant_id)
        OR (CASE WHEN r.incentive_options_json IS NULL THEN incentive_recommendation_matches_frozen(recommendation, r.incentive_recommendation_json) ELSE revenue_proposal_matches_catalog(v.proposal,r.incentive_options_json) END) IS DISTINCT FROM TRUE
        OR v.proposal->'discountStudy' IS DISTINCT FROM r.discount_study_json
        OR COALESCE(recommendation->>'definition','') NOT IN ('weekly-incentive-recommendation-v2','weekly-incentive-recommendation-v3','weekly-incentive-recommendation-v4')
        OR recommendation->>'merchantId' IS DISTINCT FROM NEW.merchant_id OR recommendation->>'runId' IS DISTINCT FROM r.id
        OR recommendation->>'observationId' IS DISTINCT FROM r.observation_id
        OR recommendation->'financialPolicy'->'enabled' IS DISTINCT FROM 'true'::jsonb
        OR valid_strategy_commercial_terms(recommendation, v.proposal->'discountStudy') IS DISTINCT FROM TRUE
        OR plan->>'definition' IS DISTINCT FROM 'incentive-fixed-horizon-planning-v1'
        OR plan->>'status' IS DISTINCT FROM 'estimated_feasible' OR plan->'blockers' IS DISTINCT FROM '[]'::jsonb
        OR plan->'baseline'->'complete' IS DISTINCT FROM 'true'::jsonb
      THEN RAISE EXCEPTION 'incentive review approval prerequisites required'; END IF;
    END IF;
    INSERT INTO strategy_incentive_review_heads(strategy_id,merchant_id,version,current_sequence) VALUES(NEW.strategy_id,NEW.merchant_id,NEW.version,1);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_strategy_incentive_recommendation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b strategy_incentive_budgets; s revenue_strategies; v revenue_strategy_versions;
  r revenue_analysis_runs; recommendation JSONB; plan JSONB; offer JSONB;
BEGIN
  -- a_strategy_incentive_policy_guard already locked merchant -> policy head.
  IF TG_TABLE_NAME = 'strategy_incentive_budgets' THEN b := NEW;
  ELSE SELECT * INTO b FROM strategy_incentive_budgets WHERE id = NEW.budget_id AND merchant_id = NEW.merchant_id;
  END IF;
  SELECT * INTO s FROM revenue_strategies WHERE id = b.strategy_id AND merchant_id = b.merchant_id FOR SHARE;
  SELECT * INTO v FROM revenue_strategy_versions WHERE strategy_id = b.strategy_id AND merchant_id = b.merchant_id AND version = b.version;
  SELECT * INTO r FROM revenue_analysis_runs WHERE id = s.run_id AND merchant_id = b.merchant_id;
  recommendation := v.proposal->'incentiveRecommendation';
  offer := recommendation->'test'; plan := recommendation->'planning';
  IF b.id IS NULL OR s.id IS NULL OR v.strategy_id IS NULL OR r.id IS NULL
    OR s.current_version IS DISTINCT FROM b.version OR s.status IS DISTINCT FROM 'pending_review'
    OR r.status IS DISTINCT FROM 'completed' OR v.proposal_hash IS DISTINCT FROM b.proposal_hash
    OR NOT EXISTS (SELECT 1 FROM revenue_analysis_schedules WHERE merchant_id = b.merchant_id)
    OR (CASE WHEN r.incentive_options_json IS NULL THEN incentive_recommendation_matches_frozen(recommendation, r.incentive_recommendation_json) ELSE revenue_proposal_matches_catalog(v.proposal,r.incentive_options_json) END) IS DISTINCT FROM TRUE
    OR v.proposal->'discountStudy' IS DISTINCT FROM r.discount_study_json
    OR COALESCE(recommendation->>'definition','') NOT IN ('weekly-incentive-recommendation-v2','weekly-incentive-recommendation-v3','weekly-incentive-recommendation-v4')
    OR recommendation->>'status' IS DISTINCT FROM 'recommended'
    OR recommendation->>'merchantId' IS DISTINCT FROM b.merchant_id
    OR recommendation->>'runId' IS DISTINCT FROM r.id
    OR recommendation->>'observationId' IS DISTINCT FROM r.observation_id
    OR recommendation->'financialPolicy'->'version' IS DISTINCT FROM to_jsonb(b.policy_version)
    OR recommendation->'financialPolicy'->>'policyHash' IS DISTINCT FROM b.terms->>'policyHash'
    OR recommendation->'financialPolicy'->'enabled' IS DISTINCT FROM 'true'::jsonb
    OR valid_strategy_commercial_terms(recommendation, v.proposal->'discountStudy') IS DISTINCT FROM TRUE
    OR offer->>'currency' IS DISTINCT FROM 'BRL'
    OR offer->'limitCents' IS DISTINCT FROM to_jsonb(b.limit_cents)
    OR offer->'maxDiscountCents' IS DISTINCT FROM to_jsonb(b.max_discount_cents)
    OR offer->'maxRedemptions' IS DISTINCT FROM to_jsonb(b.max_redemptions)
    OR offer->'maxPerBuyer' IS DISTINCT FROM '1'::jsonb
    OR offer->'durationDays' IS DISTINCT FROM '7'::jsonb
    OR offer->>'allocation' IS DISTINCT FROM '50/50'
    OR offer->>'stacking' IS DISTINCT FROM 'no_other_coupon_or_incentive'
    OR offer->'measurement'->>'samplePlanning' IS DISTINCT FROM 'included_in_recommendation'
    OR plan->>'definition' IS DISTINCT FROM 'incentive-fixed-horizon-planning-v1'
    OR plan->>'status' IS DISTINCT FROM 'estimated_feasible'
    OR plan->'blockers' IS DISTINCT FROM '[]'::jsonb
    OR plan->'baseline'->'complete' IS DISTINCT FROM 'true'::jsonb
    OR plan->>'denominator' IS DISTINCT FROM 'all_assigned_buyers_including_non_purchasers'
    OR plan->>'metric' IS DISTINCT FROM 'approved_order_conversion_per_assigned_buyer'
    OR plan->'durationDays' IS DISTINCT FROM '7'::jsonb
    OR plan->'conversionWindowHours' IS DISTINCT FROM '168'::jsonb
    OR plan->>'allocation' IS DISTINCT FROM '50/50'
    OR plan->'minimumEffectBps' IS DISTINCT FROM '100'::jsonb
    OR plan->'fundedTreatmentBuyers' IS DISTINCT FROM to_jsonb(b.max_redemptions)
    OR jsonb_typeof(plan->'minimumBuyersPerArm') IS DISTINCT FROM 'number'
    OR jsonb_typeof(plan->'weeklyBuyersPerArm') IS DISTINCT FROM 'number'
    OR jsonb_typeof(plan->'requiredBudgetCents') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'incentive requires the planned recommendation'; END IF;
  -- Bigint multiplication avoids integer overflow; malformed/partial JSON fails
  -- closed before the existing accounting trigger can mutate budget counters.
  IF (plan->>'minimumBuyersPerArm')::numeric < 100
    OR (plan->>'minimumBuyersPerArm')::numeric <> trunc((plan->>'minimumBuyersPerArm')::numeric)
    OR (plan->>'minimumBuyersPerArm')::numeric > (plan->>'weeklyBuyersPerArm')::numeric
    OR (plan->>'minimumBuyersPerArm')::numeric > b.max_redemptions
    OR (plan->>'requiredBudgetCents')::numeric <> (plan->>'minimumBuyersPerArm')::numeric * b.max_discount_cents
    OR (plan->>'requiredBudgetCents')::numeric > b.limit_cents
    OR b.limit_cents::bigint <> b.max_discount_cents::bigint * b.max_redemptions
  THEN RAISE EXCEPTION 'incentive recommendation has insufficient capacity'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_strategy_incentive_policy() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR (p.origin='automatic' AND p.approved_review_id IS DISTINCT FROM b.review_id)
    OR b.limit_cents > p.limit_cents OR b.max_discount_cents > p.max_discount_cents OR b.max_redemptions > p.max_redemptions
  THEN RAISE EXCEPTION 'incentive policy changed or unavailable'; END IF;
  RETURN NEW;
END $$;
