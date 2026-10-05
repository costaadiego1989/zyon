-- Preserve prior contracts while checking a selected member of the frozen catalog.
ALTER FUNCTION valid_strategy_commercial_terms(JSONB, JSONB) RENAME TO valid_strategy_commercial_terms_v3;
CREATE FUNCTION valid_strategy_commercial_terms(recommendation JSONB, study JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t JSONB := recommendation->'test'; c JSONB; projected JSONB; proxy JSONB; stages JSONB;
  bps BIGINT; cap BIGINT;
BEGIN
  IF recommendation->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v4' THEN
    RETURN valid_strategy_commercial_terms_v3(recommendation, study);
  END IF;
  IF study->>'definition' IS DISTINCT FROM 'weekly-discount-study-v3'
    OR jsonb_typeof(study->'commercialCandidates') IS DISTINCT FROM 'array'
    OR COALESCE(recommendation->>'selectedCandidateKey','') NOT IN ('percentage','fixed','shipping','progressive')
  THEN RETURN FALSE; END IF;
  SELECT value INTO c FROM jsonb_array_elements(study->'commercialCandidates')
    WHERE value->>'key'=recommendation->>'selectedCandidateKey';
  IF c IS NULL OR c->>'kind' IS DISTINCT FROM 'capped_' || (recommendation->>'selectedCandidateKey') || '_discount'
    OR t->>'kind' IS DISTINCT FROM c->>'kind' THEN RETURN FALSE; END IF;
  projected := jsonb_set(study, '{definition}', '"weekly-discount-study-v2"');
  proxy := jsonb_set(recommendation, '{definition}', '"weekly-incentive-recommendation-v3"');
  IF t->>'kind' = 'capped_progressive_discount' THEN
    IF t->'delivery' IS DISTINCT FROM '{"mode":"automatic"}'::jsonb
      OR c->'evidence'->>'basis' IS DISTINCT FROM 'progressive_safe_replay'
      OR jsonb_typeof(t->'discountPercent') IS DISTINCT FROM 'number'
      OR jsonb_typeof(t->'maxDiscountCents') IS DISTINCT FROM 'number'
      OR (t->>'discountPercent')::numeric * 100 <> trunc((t->>'discountPercent')::numeric * 100)
      OR (t->>'maxDiscountCents')::numeric <> trunc((t->>'maxDiscountCents')::numeric)
      OR t ?| ARRAY['fixedDiscountCents','shippingDiscountCents'] THEN RETURN FALSE; END IF;
    bps := round((t->>'discountPercent')::numeric * 100); cap := (t->>'maxDiscountCents')::bigint;
    IF bps < 2 OR cap < 2 OR floor((t->'audience'->>'minCartTotalCents')::numeric * floor(bps::numeric/2)/10000)<1 THEN RETURN FALSE; END IF;
    stages := jsonb_build_array(
      jsonb_build_object('index',0,'trigger','enrollment','discountPercent',floor(bps::numeric/2)/100,'maxDiscountCents',floor(cap::numeric/2)),
      jsonb_build_object('index',1,'trigger','checkout_payment_ready','discountPercent',bps::numeric/100,'maxDiscountCents',cap));
    IF t->'stages' IS DISTINCT FROM stages THEN RETURN FALSE; END IF;
    c := jsonb_set(jsonb_set(c,'{kind}','"capped_percentage_discount"'),'{evidence,basis}','"percentage_discount_replay"');
    proxy := jsonb_set(proxy,'{test,kind}','"capped_percentage_discount"');
  ELSIF t ? 'stages' THEN RETURN FALSE;
  END IF;
  projected := jsonb_set(projected,'{commercialCandidate}',c-'key');
  RETURN valid_strategy_commercial_terms_v3(proxy,projected) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR division_by_zero THEN RETURN FALSE;
END $$;

CREATE TABLE strategy_incentive_stage_grants (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
  stage_index INTEGER NOT NULL CHECK(stage_index IN (0,1)), trigger TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  created_at TIMESTAMP(3) NOT NULL,
  UNIQUE(assignment_id,stage_index), UNIQUE(id,merchant_id),
  FOREIGN KEY(assignment_id,merchant_id) REFERENCES strategy_incentive_assignments(id,merchant_id),
  FOREIGN KEY(event_id) REFERENCES checkout_events(id),
  CHECK((stage_index=0 AND trigger='enrollment') OR (stage_index=1 AND trigger='checkout_payment_ready'))
);
CREATE INDEX strategy_incentive_stage_grants_merchant_assignment_stage_idx
  ON strategy_incentive_stage_grants(merchant_id,assignment_id,stage_index);

CREATE FUNCTION guard_strategy_incentive_stage_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a strategy_incentive_assignments; e strategy_incentive_executions; b strategy_incentive_budgets;
  s checkout_sessions; ev checkout_events; previous strategy_incentive_stage_grants;
  reservation strategy_incentive_reservations; stage JSONB; proposal JSONB; expected BIGINT;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'incentive stage history is immutable'; END IF;
  PERFORM id FROM merchants WHERE id=NEW.merchant_id FOR UPDATE;
  SELECT * INTO a FROM strategy_incentive_assignments WHERE id=NEW.assignment_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO e FROM strategy_incentive_executions WHERE id=a.execution_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO b FROM strategy_incentive_budgets WHERE id=e.budget_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO s FROM checkout_sessions WHERE session_id=a.session_id AND merchant_id=NEW.merchant_id FOR UPDATE;
  SELECT * INTO ev FROM checkout_events WHERE id=NEW.event_id;
  SELECT v.proposal INTO proposal FROM revenue_strategy_versions v
    JOIN revenue_strategies rs ON rs.id=v.strategy_id AND rs.merchant_id=v.merchant_id AND rs.current_version=v.version
    WHERE v.strategy_id=e.strategy_id AND v.merchant_id=NEW.merchant_id AND v.version=e.version;
  stage := e.recommendation->'test'->'stages'->NEW.stage_index;
  IF a.id IS NULL OR e.id IS NULL OR b.id IS NULL OR s.id IS NULL OR ev.id IS NULL OR proposal IS NULL
    OR e.recommendation->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v4'
    OR e.recommendation->'test'->>'kind' IS DISTINCT FROM 'capped_progressive_discount'
    OR valid_strategy_commercial_terms(e.recommendation,proposal->'discountStudy') IS DISTINCT FROM TRUE
    OR b.closed_at IS NOT NULL OR NEW.created_at<e.started_at OR NEW.created_at>=e.ends_at
    OR NEW.created_at<a.assigned_at OR NEW.created_at>(clock_timestamp() AT TIME ZONE 'UTC')
    OR s.global_user_id IS DISTINCT FROM a.buyer_id OR s.cohort IS DISTINCT FROM 'treatment' OR s.prompt_variant_id IS NOT NULL
    OR ev.merchant_id IS DISTINCT FROM NEW.merchant_id OR ev.session_id IS DISTINCT FROM a.session_id
    OR ev.event_name IS DISTINCT FROM 'strategy_incentive_stage' OR ev.occurred_at IS DISTINCT FROM NEW.created_at
    OR ev.metadata->>'source' IS DISTINCT FROM 'revenue_engine' OR ev.metadata->>'assignmentId' IS DISTINCT FROM a.id
    OR ev.metadata->'stageIndex' IS DISTINCT FROM to_jsonb(NEW.stage_index) OR ev.metadata->>'trigger' IS DISTINCT FROM NEW.trigger
    OR stage->>'trigger' IS DISTINCT FROM NEW.trigger OR stage->'index' IS DISTINCT FROM to_jsonb(NEW.stage_index)
    OR EXISTS(SELECT 1 FROM payment_intents WHERE merchant_id=NEW.merchant_id AND session_id=a.session_id)
    OR EXISTS(SELECT 1 FROM completed_orders WHERE merchant_id=NEW.merchant_id AND session_id=a.session_id)
    OR EXISTS(SELECT 1 FROM accepted_offers WHERE merchant_id=NEW.merchant_id AND session_id=a.session_id)
    OR EXISTS(SELECT 1 FROM coupon_redemptions WHERE merchant_id=NEW.merchant_id AND session_id=a.session_id AND status='applied')
    OR NOT EXISTS(SELECT 1 FROM strategy_incentive_review_heads h WHERE h.strategy_id=e.strategy_id
      AND h.merchant_id=NEW.merchant_id AND h.version=e.version AND h.current_sequence=1)
  THEN RAISE EXCEPTION 'incentive stage requires current approved execution and server event'; END IF;
  IF NEW.stage_index=1 THEN
    SELECT * INTO previous FROM strategy_incentive_stage_grants WHERE assignment_id=a.id AND stage_index=0;
    IF previous.id IS NULL OR NEW.created_at<previous.created_at
      OR COALESCE(ev.metadata->>'method','') NOT IN ('pix','credit_card','boleto','crypto')
    THEN RAISE EXCEPTION 'incentive progression requires enrollment and payment preparation'; END IF;
  END IF;
  IF a.arm='control' THEN
    IF NEW.amount_cents<>0 OR COALESCE((s.cart->>'currentDiscount')::numeric,0)<>0 OR s.cart ? 'commercialNudge'
    THEN RAISE EXCEPTION 'incentive control receives no stage discount'; END IF;
  ELSE
    SELECT * INTO reservation FROM strategy_incentive_reservations WHERE id=a.reservation_id AND merchant_id=NEW.merchant_id;
    expected := least((stage->>'maxDiscountCents')::bigint,
      floor(round((s.cart->>'total')::numeric*100)*round((stage->>'discountPercent')::numeric*100)/10000)::bigint);
    IF reservation.id IS NULL OR reservation.status<>'reserved' OR reservation.amount_cents<>a.amount_cents
      OR expected IS NULL OR expected<1 OR NEW.amount_cents<>expected OR expected>a.amount_cents
      OR (NEW.stage_index=0 AND (COALESCE((s.cart->>'currentDiscount')::numeric,0)<>0 OR s.cart ? 'commercialNudge'))
      OR (NEW.stage_index=1 AND (round(COALESCE((s.cart->>'currentDiscount')::numeric,0)*100)<>previous.amount_cents
        OR s.cart->'commercialNudge'->>'ruleId' IS DISTINCT FROM a.id))
    THEN RAISE EXCEPTION 'incentive stage exceeds its reserved approved terms'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_incentive_stage_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_incentive_stage_grants
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_stage_grant();

CREATE FUNCTION guard_strategy_incentive_stage_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_name='strategy_incentive_stage' OR (TG_OP='UPDATE' AND NEW.event_name='strategy_incentive_stage')
  THEN RAISE EXCEPTION 'incentive stage event is immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER strategy_incentive_stage_event_guard BEFORE UPDATE OR DELETE ON checkout_events
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_stage_event();

CREATE OR REPLACE FUNCTION guard_strategy_incentive_coupon() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e strategy_incentive_executions; b strategy_incentive_budgets; t JSONB; expected_type TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.strategy_incentive_execution_id IS NOT NULL THEN RAISE EXCEPTION 'strategy coupon history is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.strategy_incentive_execution_id IS DISTINCT FROM NEW.strategy_incentive_execution_id
    THEN RAISE EXCEPTION 'strategy coupon binding is immutable'; END IF;
  IF NEW.strategy_incentive_execution_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO e FROM strategy_incentive_executions WHERE id=NEW.strategy_incentive_execution_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO b FROM strategy_incentive_budgets WHERE id=e.budget_id AND merchant_id=NEW.merchant_id;
  t := e.recommendation->'test';
  expected_type := CASE t->>'kind' WHEN 'capped_percentage_discount' THEN 'percent'
    WHEN 'capped_fixed_discount' THEN 'fixed' WHEN 'capped_shipping_discount' THEN 'shipping_fixed' END;
  IF e.id IS NULL OR b.id IS NULL OR COALESCE(e.recommendation->>'definition','') NOT IN ('weekly-incentive-recommendation-v3','weekly-incentive-recommendation-v4')
    OR t->'delivery'->>'mode' IS DISTINCT FROM 'coupon_code'
    OR NEW.code IS DISTINCT FROM t->'delivery'->>'code' OR NEW.code !~ '^ZYON[A-F0-9]{20}$'
    OR expected_type IS NULL OR NEW.discount_type IS DISTINCT FROM expected_type
    OR NEW.discount_value IS DISTINCT FROM (CASE WHEN expected_type='percent' THEN (t->>'discountPercent')::numeric
      ELSE (t->>'maxDiscountCents')::numeric / 100 END)
    OR NEW.min_cart_total IS DISTINCT FROM (t->'audience'->>'minCartTotalCents')::numeric / 100
    OR NEW.max_usages IS DISTINCT FROM b.max_redemptions OR NEW.max_per_buyer IS DISTINCT FROM 1
    OR NEW.min_per_buyer IS NOT NULL OR NEW.free_shipping_min_cart_total IS NOT NULL
    OR cardinality(NEW.allowed_skus)<>0 OR cardinality(NEW.blocked_skus)<>0
    OR cardinality(NEW.allowed_regions)<>0 OR cardinality(NEW.blocked_regions)<>0
    OR NEW.starts_at IS DISTINCT FROM e.started_at OR NEW.ends_at IS DISTINCT FROM e.ends_at
    OR NEW.usages_count IS DISTINCT FROM b.spent_count
    OR NEW.status NOT IN ('active','paused','expired','archived')
    OR (NEW.status='active' AND b.closed_at IS NOT NULL)
    OR (TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.status<>'active' AND NEW.status='active')))
  THEN RAISE EXCEPTION 'strategy coupon terms differ from approved execution'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION incentive_recommendation_matches_frozen(candidate JSONB, frozen JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE alternative JSONB; expected JSONB; sequence NUMERIC; factor INTEGER;
  discount_bps BIGINT; cap BIGINT; redemptions BIGINT; required_budget JSONB;
BEGIN
  IF candidate IS NULL OR frozen IS NULL THEN RETURN FALSE; END IF;
  IF candidate = frozen THEN RETURN TRUE; END IF;
  alternative := candidate->'alternative';
  IF frozen ? 'alternative' OR COALESCE(frozen->>'definition','') NOT IN ('weekly-incentive-recommendation-v2','weekly-incentive-recommendation-v3','weekly-incentive-recommendation-v4')
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
  IF frozen->>'definition' IN ('weekly-incentive-recommendation-v3','weekly-incentive-recommendation-v4') THEN
    IF frozen->'test'->>'kind' = 'capped_fixed_discount' THEN expected := jsonb_set(expected, '{test,fixedDiscountCents}', to_jsonb(cap)); END IF;
    IF frozen->'test'->>'kind' = 'capped_shipping_discount' THEN expected := jsonb_set(expected, '{test,shippingDiscountCents}', to_jsonb(cap)); END IF;
    IF frozen->'test'->'delivery'->>'mode' = 'coupon_code' THEN
      expected := jsonb_set(expected, '{test,delivery,code}', to_jsonb(strategy_incentive_coupon_code(frozen, sequence::integer)));
    END IF;
  END IF;
  IF frozen->'test'->>'kind' = 'capped_progressive_discount' THEN
    IF discount_bps<2 OR cap<2 OR floor((frozen->'test'->'audience'->>'minCartTotalCents')::numeric*floor(discount_bps::numeric/2)/10000)<1 THEN RETURN FALSE; END IF;
    expected := jsonb_set(expected,'{test,stages}',jsonb_build_array(
      jsonb_build_object('index',0,'trigger','enrollment','discountPercent',floor(discount_bps::numeric/2)/100,'maxDiscountCents',floor(cap::numeric/2)),
      jsonb_build_object('index',1,'trigger','checkout_payment_ready','discountPercent',discount_bps::numeric/100,'maxDiscountCents',cap)));
  END IF;
  required_budget := CASE WHEN frozen->'planning'->'minimumBuyersPerArm' = 'null'::jsonb THEN 'null'::jsonb
    ELSE to_jsonb((frozen->'planning'->>'minimumBuyersPerArm')::bigint * cap) END;
  expected := jsonb_set(expected, '{planning,requiredBudgetCents}', required_budget);
  RETURN (candidate - 'alternative') = expected;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR division_by_zero THEN RETURN FALSE;
END $$;

