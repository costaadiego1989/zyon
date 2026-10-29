-- Pure navigation only. No cart writes, incentive authorization or provider effects.
ALTER TABLE strategy_turn_publications ADD COLUMN navigation_tools JSONB;
ALTER TABLE strategy_turn_publications ADD CONSTRAINT strategy_navigation_tools_shape CHECK (
  navigation_tools IS NULL OR CASE WHEN jsonb_typeof(navigation_tools) = 'array' THEN
    jsonb_array_length(navigation_tools) <= 4 AND navigation_tools <@
      '["confirm_address", "request_cep", "show_shipping_options", "show_payment_methods"]'::jsonb
    ELSE FALSE END
);
ALTER TABLE strategy_turns DROP CONSTRAINT strategy_turn_publication_binding;
ALTER TABLE strategy_turns ADD CONSTRAINT strategy_turn_publication_binding CHECK (
  (chat_request_id IS NULL AND publication_policy IS NULL AND session_context_version IS NULL) OR
  (chat_request_id IS NOT NULL AND publication_policy IN ('text_only_no_personalization_v1', 'main_chat_text_only_v1', 'main_chat_navigation_v2')
    AND publication_policy IS NOT NULL AND session_context_version IS NOT NULL AND session_context_version >= 0
    AND session_context_hash IS NOT NULL)
);

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
    OR (t.publication_policy IS NULL OR t.publication_policy NOT IN ('main_chat_text_only_v1', 'main_chat_navigation_v2')) OR t.chat_request_id IS DISTINCT FROM r.id
    OR p.request_id IS DISTINCT FROM r.id OR p.session_id IS DISTINCT FROM r.session_id
    OR p.decision <> 'persisted' OR p.exchange_request_id IS DISTINCT FROM r.id
    OR NEW.resolved_at < p.recorded_at OR NEW.resolved_at < r.finished_at OR NEW.resolved_at > clock_timestamp()
    OR NOT EXISTS (SELECT 1 FROM checkout_chat_exchanges x WHERE x.request_id = r.id
      AND x.merchant_id = r.merchant_id AND x.session_id = r.session_id AND x.recorded_at <= p.recorded_at)
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_strategy_turn_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t strategy_turns; c strategy_turn_completions; a strategy_assignments; e strategy_executions;
  s checkout_sessions; r checkout_chat_requests; x checkout_chat_exchanges;
BEGIN
  SELECT * INTO t FROM strategy_turns WHERE id = NEW.turn_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO c FROM strategy_turn_completions WHERE turn_id = NEW.turn_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO a FROM strategy_assignments WHERE id = t.assignment_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO e FROM strategy_executions WHERE id = a.execution_id AND merchant_id = NEW.merchant_id FOR SHARE;
  SELECT * INTO s FROM checkout_sessions WHERE session_id = NEW.session_id AND merchant_id = NEW.merchant_id FOR UPDATE;
  SELECT * INTO r FROM checkout_chat_requests WHERE id = NEW.request_id AND merchant_id = NEW.merchant_id FOR SHARE;
  IF t.id IS NULL OR c.turn_id IS NULL OR s.id IS NULL OR r.id IS NULL
    OR t.chat_request_id IS DISTINCT FROM r.id OR a.session_id IS DISTINCT FROM NEW.session_id
    OR r.session_id IS DISTINCT FROM NEW.session_id OR r.conversation_id IS DISTINCT FROM s.conversation_id
    OR t.publication_policy IS NULL OR t.publication_policy NOT IN ('text_only_no_personalization_v1', 'main_chat_text_only_v1', 'main_chat_navigation_v2')
    OR r.status <> 'processing' OR r.protocol_version <> 2 OR c.response_hash IS DISTINCT FROM NEW.response_hash
    OR NEW.recorded_at < c.recorded_at OR NEW.recorded_at > clock_timestamp()
  THEN RAISE EXCEPTION 'STRATEGY_PUBLICATION_EVIDENCE_CONFLICT'; END IF;
  IF (NEW.navigation_tools IS NOT NULL AND
      (t.publication_policy <> 'main_chat_navigation_v2' OR NEW.decision <> 'persisted'))
    OR (t.publication_policy = 'main_chat_navigation_v2' AND NEW.decision = 'persisted' AND NEW.navigation_tools IS NULL)
  THEN RAISE EXCEPTION 'STRATEGY_NAVIGATION_POLICY_CONFLICT'; END IF;
  IF NEW.navigation_tools IS NOT NULL AND
    jsonb_array_length(NEW.navigation_tools) <> (SELECT count(DISTINCT value) FROM jsonb_array_elements(NEW.navigation_tools))
  THEN RAISE EXCEPTION 'STRATEGY_NAVIGATION_DUPLICATE'; END IF;
  IF NEW.decision = 'persisted' THEN
    SELECT * INTO x FROM checkout_chat_exchanges WHERE request_id = NEW.request_id AND merchant_id = NEW.merchant_id
      AND session_id = NEW.session_id;
    IF c.decision <> 'eligible_at_recording' OR x.request_id IS NULL OR x.recorded_at < c.recorded_at
      OR NEW.recorded_at < x.recorded_at OR e.status <> 'running' OR NEW.recorded_at >= e.ends_at OR clock_timestamp() >= e.ends_at
      OR s.strategy_context_version IS DISTINCT FROM t.session_context_version + 1
      OR s.cohort IS DISTINCT FROM 'treatment' OR s.global_user_id IS DISTINCT FROM a.global_user_id
      OR s.cart->>'currency' IS DISTINCT FROM 'BRL' OR s.prompt_variant_id IS NOT NULL
      OR s.chat_history->-1->>'chatRequestId' IS DISTINCT FROM NEW.request_id
      OR encode(sha256(convert_to(s.chat_history->-1->>'text', 'UTF8')), 'hex') IS DISTINCT FROM NEW.agent_text_hash
      OR EXISTS (SELECT 1 FROM strategy_assignment_stops WHERE assignment_id = a.id AND merchant_id = NEW.merchant_id)
      OR NOT EXISTS (SELECT 1 FROM prompt_experiments WHERE id = e.experiment_id AND merchant_id = NEW.merchant_id AND status = 'running')
    THEN RAISE EXCEPTION 'STRATEGY_PUBLICATION_NO_CURRENT_EXCHANGE'; END IF;
  ELSIF EXISTS (SELECT 1 FROM checkout_chat_exchanges WHERE request_id = NEW.request_id) THEN
    RAISE EXCEPTION 'STRATEGY_SUPPRESSION_HAS_EXCHANGE';
  END IF;
  RETURN NEW;
END $$;
