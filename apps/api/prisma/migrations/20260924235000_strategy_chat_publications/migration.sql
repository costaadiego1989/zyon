CREATE UNIQUE INDEX checkout_chat_requests_id_merchant_id_key ON checkout_chat_requests(id, merchant_id);
ALTER TABLE strategy_turns ADD COLUMN chat_request_id TEXT,
  ADD COLUMN publication_policy TEXT, ADD COLUMN session_context_version INTEGER;
ALTER TABLE strategy_turns ADD CONSTRAINT strategy_turns_chat_request_id_merchant_id_fkey
  FOREIGN KEY (chat_request_id, merchant_id) REFERENCES checkout_chat_requests(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE strategy_turns ADD CONSTRAINT strategy_turn_publication_binding CHECK (
  (chat_request_id IS NULL AND publication_policy IS NULL AND session_context_version IS NULL) OR
  (chat_request_id IS NOT NULL AND publication_policy = 'text_only_no_personalization_v1'
    AND publication_policy IS NOT NULL AND session_context_version IS NOT NULL AND session_context_version >= 0
    AND session_context_hash IS NOT NULL)
);
CREATE UNIQUE INDEX strategy_turns_chat_request_id_merchant_id_key ON strategy_turns(chat_request_id, merchant_id);

CREATE FUNCTION guard_strategy_chat_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r checkout_chat_requests; a strategy_assignments; s checkout_sessions;
BEGIN
  IF NEW.chat_request_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO a FROM strategy_assignments WHERE id = NEW.assignment_id AND merchant_id = NEW.merchant_id;
  SELECT * INTO s FROM checkout_sessions WHERE merchant_id = NEW.merchant_id AND session_id = a.session_id FOR SHARE;
  SELECT * INTO r FROM checkout_chat_requests WHERE id = NEW.chat_request_id AND merchant_id = NEW.merchant_id FOR SHARE;
  IF r.id IS NULL OR r.status <> 'processing' OR r.protocol_version <> 2 OR r.session_id IS DISTINCT FROM a.session_id
    OR r.conversation_id IS DISTINCT FROM s.conversation_id OR NEW.request_key IS DISTINCT FROM r.id
    OR NEW.session_context_version IS DISTINCT FROM s.strategy_context_version OR NEW.admitted_at < r.started_at
    OR EXISTS (SELECT 1 FROM checkout_chat_exchanges WHERE request_id = r.id)
  THEN RAISE EXCEPTION 'STRATEGY_CHAT_BINDING_CONFLICT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_chat_binding_guard BEFORE INSERT ON strategy_turns
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_chat_binding();

CREATE TABLE strategy_turn_publications (
  turn_id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  exchange_request_id TEXT,
  response_hash TEXT NOT NULL CHECK (response_hash ~ '^[a-f0-9]{64}$'),
  agent_text_hash TEXT,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT strategy_turn_publications_turn_id_merchant_id_fkey FOREIGN KEY (turn_id, merchant_id)
    REFERENCES strategy_turn_completions(turn_id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT strategy_turn_publications_request_id_merchant_id_fkey FOREIGN KEY (request_id, merchant_id)
    REFERENCES checkout_chat_requests(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT strategy_turn_publications_exchange_fkey FOREIGN KEY (exchange_request_id, merchant_id, session_id)
    REFERENCES checkout_chat_exchanges(request_id, merchant_id, session_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT strategy_publication_decision CHECK (
    (decision = 'persisted' AND reason = 'current_at_publication' AND exchange_request_id IS NOT NULL
      AND exchange_request_id = request_id AND agent_text_hash IS NOT NULL AND agent_text_hash ~ '^[a-f0-9]{64}$') OR
    (decision = 'suppressed' AND exchange_request_id IS NULL AND agent_text_hash IS NULL AND reason IN (
      'publication_disabled', 'completion_suppressed', 'unsupported_response', 'unsafe_message', 'execution_disabled',
      'dispatch_disabled', 'execution_stopped', 'outside_horizon', 'assignment_stopped', 'session_changed',
      'experiment_stopped', 'baseline_changed')))
);
CREATE UNIQUE INDEX strategy_turn_publications_turn_id_merchant_id_key ON strategy_turn_publications(turn_id, merchant_id);
CREATE UNIQUE INDEX strategy_turn_publications_request_id_merchant_id_key ON strategy_turn_publications(request_id, merchant_id);
CREATE UNIQUE INDEX strategy_turn_publications_exchange_scope_key
  ON strategy_turn_publications(exchange_request_id, merchant_id, session_id);
CREATE INDEX strategy_turn_publications_merchant_id_recorded_at_idx ON strategy_turn_publications(merchant_id, recorded_at);

CREATE FUNCTION guard_strategy_turn_publication() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR t.publication_policy IS DISTINCT FROM 'text_only_no_personalization_v1'
    OR r.status <> 'processing' OR r.protocol_version <> 2 OR c.response_hash IS DISTINCT FROM NEW.response_hash
    OR NEW.recorded_at < c.recorded_at OR NEW.recorded_at > clock_timestamp()
  THEN RAISE EXCEPTION 'STRATEGY_PUBLICATION_EVIDENCE_CONFLICT'; END IF;
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
CREATE TRIGGER strategy_turn_publication_guard BEFORE INSERT ON strategy_turn_publications
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_turn_publication();
CREATE TRIGGER strategy_turn_publications_immutable BEFORE UPDATE OR DELETE ON strategy_turn_publications
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();

-- A bound turn cannot bypass the publication checks through the normal builder
-- or a direct repository call. Pair + proof + decision must commit together.
CREATE FUNCTION require_bound_strategy_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM strategy_turns WHERE chat_request_id = NEW.request_id AND merchant_id = NEW.merchant_id)
    AND NOT EXISTS (SELECT 1 FROM strategy_turn_publications WHERE request_id = NEW.request_id AND merchant_id = NEW.merchant_id
      AND session_id = NEW.session_id AND exchange_request_id = NEW.request_id AND decision = 'persisted')
  THEN RAISE EXCEPTION 'STRATEGY_PUBLICATION_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER bound_strategy_publication_required AFTER INSERT ON checkout_chat_exchanges
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_bound_strategy_publication();
