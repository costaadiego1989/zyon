-- Every missing/partial JSON value is false, including at trigger call sites.
CREATE OR REPLACE FUNCTION valid_strategy_commercial_terms(recommendation JSONB, study JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t JSONB := recommendation->'test'; c JSONB := study->'commercialCandidate';
BEGIN
  IF jsonb_typeof(recommendation) IS DISTINCT FROM 'object' OR jsonb_typeof(study) IS DISTINCT FROM 'object'
    OR jsonb_typeof(t) IS DISTINCT FROM 'object' OR recommendation->>'status' IS DISTINCT FROM 'recommended'
    OR study->>'status' IS DISTINCT FROM 'candidate_available' THEN RETURN FALSE; END IF;
  IF recommendation->>'definition' = 'weekly-incentive-recommendation-v2' THEN
    RETURN COALESCE(t->>'kind' = 'capped_percentage_discount' AND NOT (t ?| ARRAY['fixedDiscountCents','shippingDiscountCents','delivery']), FALSE);
  END IF;
  IF recommendation->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v3'
    OR study->>'definition' IS DISTINCT FROM 'weekly-discount-study-v2' OR jsonb_typeof(c) IS DISTINCT FROM 'object'
    OR t->>'kind' IS DISTINCT FROM c->>'kind' OR t->'delivery'->>'mode' IS DISTINCT FROM c->>'delivery'
    OR COALESCE(t->>'kind','') NOT IN ('capped_percentage_discount','capped_fixed_discount','capped_shipping_discount')
    OR COALESCE(t->'delivery'->>'mode','') NOT IN ('automatic','coupon_code')
    OR jsonb_typeof(t->'maxDiscountCents') IS DISTINCT FROM 'number'
    OR jsonb_typeof(c->'maxDiscountCents') IS DISTINCT FROM 'number'
    OR jsonb_typeof(t->'discountPercent') IS DISTINCT FROM 'number'
    OR jsonb_typeof(study->'candidate'->'percent') IS DISTINCT FROM 'number'
    OR jsonb_typeof(c->'evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(c->'evidence'->'sampleSize') IS DISTINCT FROM 'number'
    OR c->'evidence'->'sampleSize' IS DISTINCT FROM study->'candidate'->'simulation'->'sampleSize'
    OR (c->'evidence'->>'sampleSize')::numeric < 30
    OR (c->'evidence'->>'sampleSize')::numeric <> trunc((c->'evidence'->>'sampleSize')::numeric)
    OR (t->>'maxDiscountCents')::numeric <= 0 OR (t->>'maxDiscountCents')::numeric <> trunc((t->>'maxDiscountCents')::numeric)
    OR (c->>'maxDiscountCents')::numeric <= 0 OR (c->>'maxDiscountCents')::numeric <> trunc((c->>'maxDiscountCents')::numeric)
    OR (t->>'maxDiscountCents')::numeric > (c->>'maxDiscountCents')::numeric
    OR (t->>'discountPercent')::numeric <= 0 OR (t->>'discountPercent')::numeric > 100
    OR (t->>'discountPercent')::numeric * 100 <> trunc((t->>'discountPercent')::numeric * 100)
    OR (t->>'discountPercent')::numeric > (study->'candidate'->>'percent')::numeric
  THEN RETURN FALSE; END IF;
  IF t->'delivery'->>'mode' = 'coupon_code' THEN
    IF t->'delivery'->>'code' IS DISTINCT FROM strategy_incentive_coupon_code(recommendation,
      COALESCE((recommendation->'alternative'->>'sequence')::integer,0))
      OR (t->'delivery') - ARRAY['mode','code'] <> '{}'::jsonb THEN RETURN FALSE; END IF;
  ELSIF (t->'delivery') - 'mode' <> '{}'::jsonb THEN RETURN FALSE;
  END IF;
  IF t->>'kind' = 'capped_fixed_discount' THEN
    RETURN t->'fixedDiscountCents' IS NOT DISTINCT FROM t->'maxDiscountCents' AND NOT (t ? 'shippingDiscountCents')
      AND c->'evidence'->>'basis' IS NOT DISTINCT FROM 'similar_cart_values';
  ELSIF t->>'kind' = 'capped_shipping_discount' THEN
    RETURN t->'shippingDiscountCents' IS NOT DISTINCT FROM t->'maxDiscountCents' AND NOT (t ? 'fixedDiscountCents')
      AND c->'evidence'->>'basis' IS NOT DISTINCT FROM 'observed_shipping_burden'
      AND jsonb_typeof(c->'evidence'->'minShippingCents') IS NOT DISTINCT FROM 'number'
      AND jsonb_typeof(c->'evidence'->'maxShippingCents') IS NOT DISTINCT FROM 'number'
      AND jsonb_typeof(c->'evidence'->'maxShippingCostCents') IS NOT DISTINCT FROM 'number';
  END IF;
  RETURN NOT (t ?| ARRAY['fixedDiscountCents','shippingDiscountCents'])
    AND c->'evidence'->>'basis' IS NOT DISTINCT FROM 'percentage_discount_replay';
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
        OR COALESCE(recommendation->>'definition','') NOT IN ('weekly-incentive-recommendation-v2','weekly-incentive-recommendation-v3')
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
    OR NOT incentive_recommendation_matches_frozen(recommendation, r.incentive_recommendation_json)
    OR v.proposal->'discountStudy' IS DISTINCT FROM r.discount_study_json
    OR COALESCE(recommendation->>'definition','') NOT IN ('weekly-incentive-recommendation-v2','weekly-incentive-recommendation-v3')
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
