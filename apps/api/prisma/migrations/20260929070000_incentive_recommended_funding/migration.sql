-- New funding/reservations require the complete frozen recommendation. Existing
-- receipts and terminal reconciliation remain untouched; no historical backfill.
CREATE FUNCTION guard_strategy_incentive_recommendation() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR recommendation IS DISTINCT FROM r.incentive_recommendation_json
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
CREATE TRIGGER b_strategy_incentive_recommendation_guard BEFORE INSERT ON strategy_incentive_budgets
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_recommendation();
CREATE TRIGGER b_strategy_incentive_recommendation_guard BEFORE INSERT ON strategy_incentive_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_recommendation();
