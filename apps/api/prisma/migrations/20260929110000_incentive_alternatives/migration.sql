-- Alternative terms are monotone reductions of the frozen study. The original
-- run, financial policy, audience, exposure and statistical baseline stay fixed.
-- Canonical application validation additionally authenticates the source hash.
CREATE FUNCTION incentive_recommendation_matches_frozen(candidate JSONB, frozen JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE alternative JSONB; expected JSONB; sequence NUMERIC; factor INTEGER;
  discount_bps BIGINT; cap BIGINT; redemptions BIGINT; required_budget JSONB;
BEGIN
  IF candidate IS NULL OR frozen IS NULL THEN RETURN FALSE; END IF;
  IF candidate = frozen THEN RETURN TRUE; END IF;
  alternative := candidate->'alternative';
  IF frozen ? 'alternative' OR frozen->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v2'
    OR frozen->>'status' IS DISTINCT FROM 'recommended' OR jsonb_typeof(frozen->'planning') IS DISTINCT FROM 'object'
    OR alternative->>'definition' IS DISTINCT FROM 'incentive-conservative-alternative-v1'
    OR jsonb_typeof(alternative->'sequence') IS DISTINCT FROM 'number'
    OR COALESCE(alternative->>'sourceRecommendationHash','') !~ '^[a-f0-9]{64}$'
    OR alternative - ARRAY['definition','sequence','sourceRecommendationHash'] <> '{}'::jsonb
  THEN RETURN FALSE; END IF;
  sequence := (alternative->>'sequence')::numeric;
  IF sequence NOT BETWEEN 1 AND 3 OR sequence <> trunc(sequence) THEN RETURN FALSE; END IF;
  factor := sequence::integer + 1;
  discount_bps := floor(round((frozen->'test'->>'discountPercent')::numeric * 100) / factor)::bigint;
  cap := least(floor((frozen->'test'->>'maxDiscountCents')::numeric / factor)::bigint,
    floor((frozen->'test'->'audience'->>'maxCartTotalCents')::numeric * discount_bps / 10000)::bigint);
  redemptions := (frozen->'test'->>'maxRedemptions')::bigint;
  IF discount_bps < 1 OR cap < 1 OR redemptions < 1 THEN RETURN FALSE; END IF;
  expected := jsonb_set(frozen, '{test,discountPercent}', to_jsonb(discount_bps::numeric / 100));
  expected := jsonb_set(expected, '{test,maxDiscountCents}', to_jsonb(cap));
  expected := jsonb_set(expected, '{test,limitCents}', to_jsonb(cap * redemptions));
  required_budget := CASE WHEN frozen->'planning'->'minimumBuyersPerArm' = 'null'::jsonb THEN 'null'::jsonb
    ELSE to_jsonb((frozen->'planning'->>'minimumBuyersPerArm')::bigint * cap) END;
  expected := jsonb_set(expected, '{planning,requiredBudgetCents}', required_budget);
  RETURN (candidate - 'alternative') = expected;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR division_by_zero THEN RETURN FALSE;
END $$;

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
        OR NOT EXISTS (SELECT 1 FROM revenue_analysis_schedules WHERE merchant_id = NEW.merchant_id)
        OR NOT incentive_recommendation_matches_frozen(recommendation, r.incentive_recommendation_json)
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
    OR NOT incentive_recommendation_matches_frozen(recommendation, r.incentive_recommendation_json)
    OR v.proposal->'discountStudy' IS DISTINCT FROM r.discount_study_json
    OR recommendation->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v2'
    OR recommendation->>'status' IS DISTINCT FROM 'recommended'
    OR recommendation->>'merchantId' IS DISTINCT FROM b.merchant_id
    OR recommendation->>'runId' IS DISTINCT FROM r.id
    OR recommendation->>'observationId' IS DISTINCT FROM r.observation_id
    OR recommendation->'financialPolicy'->'version' IS DISTINCT FROM to_jsonb(b.policy_version)
    OR recommendation->'financialPolicy'->>'policyHash' IS DISTINCT FROM b.terms->>'policyHash'
    OR recommendation->'financialPolicy'->'enabled' IS DISTINCT FROM 'true'::jsonb
    OR offer->>'kind' IS DISTINCT FROM 'capped_percentage_discount'
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
