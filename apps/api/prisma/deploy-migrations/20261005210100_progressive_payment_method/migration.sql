-- Payment provider admission uses card; shared display labels use credit_card.
CREATE OR REPLACE FUNCTION guard_strategy_incentive_stage_grant() RETURNS trigger LANGUAGE plpgsql AS $$
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
      OR COALESCE(ev.metadata->>'method','') NOT IN ('pix','card','boleto','crypto')
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
