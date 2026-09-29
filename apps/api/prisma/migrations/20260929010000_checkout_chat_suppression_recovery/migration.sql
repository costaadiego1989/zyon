-- Only a decided, immutable suppression in the main return-only path can
-- release this request. Missing completion and unknown provider calls remain
-- unresolved; this function never settles/reclaims any AI reservation.
CREATE FUNCTION checkout_chat_suppression_recoverable(request_ref TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM checkout_chat_requests r
    JOIN checkout_sessions s ON s.merchant_id = r.merchant_id AND s.session_id = r.session_id
    JOIN strategy_turns t ON t.chat_request_id = r.id AND t.merchant_id = r.merchant_id
    JOIN strategy_assignments a ON a.id = t.assignment_id AND a.merchant_id = r.merchant_id AND a.session_id = r.session_id
    JOIN strategy_executions e ON e.id = a.execution_id AND e.merchant_id = r.merchant_id
    JOIN strategy_turn_completions c ON c.turn_id = t.id AND c.merchant_id = r.merchant_id
    JOIN strategy_turn_outcomes o ON o.turn_id = t.id AND o.merchant_id = r.merchant_id
    JOIN strategy_ai_reservations ar ON ar.turn_id = t.id AND ar.merchant_id = r.merchant_id
    JOIN ai_usage_events u ON u.idempotency_key = ar.usage_key AND u.merchant_id = r.merchant_id
    JOIN strategy_turn_publications p ON p.turn_id = t.id AND p.merchant_id = r.merchant_id
      AND p.request_id = r.id AND p.session_id = r.session_id
    WHERE r.id = request_ref AND r.protocol_version = 2 AND r.status IN ('processing', 'unknown')
      AND s.conversation_id = r.conversation_id AND t.publication_policy = 'main_chat_navigation_v2'
      AND e.contract #>> '{baseline,suppressionRecovery}' = 'checkout-suppression-recovery-v1'
      AND o.outcome = 'provider_completed' AND c.response_hash IS NOT NULL
      AND ar.state = 'settled' AND ar.settled_at IS NOT NULL
      AND u.source = 'checkout_strategy' AND u.execution_status = 'succeeded' AND u.cost_status = 'estimated'
      AND u.provider = ar.provider AND u.model = ar.model AND u.currency = ar.currency
      AND u.pricing_version = ar.price_version AND u.cost_micros BETWEEN 0 AND ar.amount_micros
      AND p.response_hash = c.response_hash AND p.decision = 'suppressed'
      AND p.exchange_request_id IS NULL AND p.agent_text_hash IS NULL AND p.navigation_tools IS NULL
      AND NOT EXISTS (SELECT 1 FROM checkout_chat_exchanges x WHERE x.request_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM payment_intents pi WHERE pi.merchant_id = r.merchant_id
        AND pi.session_id = r.session_id AND pi.idempotency_key = 'chat:' || r.id)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.chat_history) item WHERE item->>'chatRequestId' = r.id)
  )
$$;

CREATE OR REPLACE FUNCTION guard_checkout_chat_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r checkout_chat_requests; s checkout_sessions; p strategy_turn_publications; t strategy_turns;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_IMMUTABLE'; END IF;
  SELECT * INTO s FROM checkout_sessions WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id FOR UPDATE;
  SELECT * INTO r FROM checkout_chat_requests WHERE id = NEW.request_id AND merchant_id = NEW.merchant_id
    AND session_id = NEW.session_id FOR UPDATE;
  SELECT * INTO p FROM strategy_turn_publications WHERE turn_id = NEW.turn_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO t FROM strategy_turns WHERE id = NEW.turn_id AND merchant_id = NEW.merchant_id;
  IF r.id IS NULL OR s.id IS NULL OR p.turn_id IS NULL OR t.id IS NULL
    OR r.status NOT IN ('processing', 'unknown') OR r.protocol_version <> 2
    OR r.conversation_id IS DISTINCT FROM s.conversation_id
    OR NEW.previous_status IS DISTINCT FROM r.status OR NEW.previous_finished_at IS DISTINCT FROM r.finished_at
    OR (t.publication_policy IS NULL OR t.publication_policy NOT IN ('main_chat_text_only_v1', 'main_chat_navigation_v2'))
    OR t.chat_request_id IS DISTINCT FROM r.id OR p.request_id IS DISTINCT FROM r.id OR p.session_id IS DISTINCT FROM r.session_id
    OR NEW.resolved_at < p.recorded_at OR NEW.resolved_at < r.finished_at OR NEW.resolved_at > clock_timestamp()
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_EVIDENCE_REQUIRED'; END IF;
  IF p.decision = 'persisted' THEN
    IF p.exchange_request_id IS DISTINCT FROM r.id
      OR NOT EXISTS (SELECT 1 FROM checkout_chat_exchanges x WHERE x.request_id = r.id
        AND x.merchant_id = r.merchant_id AND x.session_id = r.session_id AND x.recorded_at <= p.recorded_at)
    THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_EVIDENCE_REQUIRED'; END IF;
  ELSIF NOT checkout_chat_suppression_recoverable(r.id)
    OR NOT EXISTS (SELECT 1 FROM strategy_assignment_stops st WHERE st.assignment_id = t.assignment_id
      AND st.merchant_id = r.merchant_id AND st.stopped_at <= NEW.resolved_at)
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_SUPPRESSION_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END $$;
