-- Older bound publications did not certify the main-chat return-only path.
-- Keep them immutable and ineligible for automatic recovery.
ALTER TABLE strategy_turns DROP CONSTRAINT strategy_turn_publication_binding;
ALTER TABLE strategy_turns ADD CONSTRAINT strategy_turn_publication_binding CHECK (
  (chat_request_id IS NULL AND publication_policy IS NULL AND session_context_version IS NULL) OR
  (chat_request_id IS NOT NULL AND publication_policy IN ('text_only_no_personalization_v1', 'main_chat_text_only_v1')
    AND publication_policy IS NOT NULL AND session_context_version IS NOT NULL AND session_context_version >= 0
    AND session_context_hash IS NOT NULL)
);

CREATE TABLE checkout_chat_resolutions (
  request_id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  previous_status TEXT NOT NULL CHECK (previous_status IN ('processing', 'unknown')),
  previous_finished_at TIMESTAMP(3),
  resolved_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT checkout_chat_resolution_request_fkey
    FOREIGN KEY (request_id, merchant_id, session_id) REFERENCES checkout_chat_requests(id, merchant_id, session_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT checkout_chat_resolutions_turn_id_merchant_id_fkey
    FOREIGN KEY (turn_id, merchant_id) REFERENCES strategy_turn_publications(turn_id, merchant_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX checkout_chat_resolutions_turn_id_merchant_id_key ON checkout_chat_resolutions(turn_id, merchant_id);
CREATE UNIQUE INDEX checkout_chat_resolution_request_scope_key ON checkout_chat_resolutions(request_id, merchant_id, session_id);
CREATE INDEX checkout_chat_resolution_scope_idx
  ON checkout_chat_resolutions(merchant_id, session_id, resolved_at);

ALTER TABLE checkout_chat_requests DROP CONSTRAINT checkout_chat_request_state_check;
ALTER TABLE checkout_chat_requests ADD CONSTRAINT checkout_chat_request_state_check CHECK (
  (status = 'processing' AND finished_at IS NULL AND response_hash IS NULL) OR
  (status IN ('rejected', 'unknown', 'reconciled') AND finished_at IS NOT NULL AND response_hash IS NULL) OR
  (status = 'completed' AND finished_at IS NOT NULL AND response_hash IS NOT NULL AND response_hash ~ '^[a-f0-9]{64}$')
);

CREATE FUNCTION guard_checkout_chat_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR t.publication_policy IS DISTINCT FROM 'main_chat_text_only_v1' OR t.chat_request_id IS DISTINCT FROM r.id
    OR p.request_id IS DISTINCT FROM r.id OR p.session_id IS DISTINCT FROM r.session_id
    OR p.decision <> 'persisted' OR p.exchange_request_id IS DISTINCT FROM r.id
    OR NEW.resolved_at < p.recorded_at OR NEW.resolved_at < r.finished_at OR NEW.resolved_at > clock_timestamp()
    OR NOT EXISTS (SELECT 1 FROM checkout_chat_exchanges x WHERE x.request_id = r.id
      AND x.merchant_id = r.merchant_id AND x.session_id = r.session_id AND x.recorded_at <= p.recorded_at)
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_chat_resolution_guard BEFORE INSERT OR UPDATE OR DELETE ON checkout_chat_resolutions
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_chat_resolution();

CREATE OR REPLACE FUNCTION guard_checkout_chat_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolution checkout_chat_resolutions;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'processing' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_INVALID_INITIAL_STATE'; END IF;
    IF NEW.protocol_version <> 2 THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_PROTOCOL_REQUIRED'; END IF;
    PERFORM 1 FROM checkout_sessions s WHERE s.merchant_id = NEW.merchant_id AND s.session_id = NEW.session_id
      AND s.conversation_id = NEW.conversation_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_SESSION_MISMATCH'; END IF;
  ELSE
    IF (NEW.id, NEW.merchant_id, NEW.session_id, NEW.conversation_id, NEW.message_id, NEW.request_hash,
          NEW.started_at, NEW.protocol_version, NEW.buyer_message_hash)
        IS DISTINCT FROM
         (OLD.id, OLD.merchant_id, OLD.session_id, OLD.conversation_id, OLD.message_id, OLD.request_hash,
          OLD.started_at, OLD.protocol_version, OLD.buyer_message_hash)
    THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE'; END IF;
    IF NEW.status = 'reconciled' AND OLD.status IN ('processing', 'unknown') AND NEW.protocol_version = 2 THEN
      SELECT * INTO resolution FROM checkout_chat_resolutions WHERE request_id = NEW.id AND merchant_id = NEW.merchant_id
        AND session_id = NEW.session_id;
      IF resolution.request_id IS NULL OR resolution.previous_status IS DISTINCT FROM OLD.status
        OR resolution.previous_finished_at IS DISTINCT FROM OLD.finished_at
        OR resolution.resolved_at IS DISTINCT FROM NEW.finished_at OR NEW.response_hash IS NOT NULL
      THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_REQUIRED'; END IF;
    ELSIF OLD.status <> 'processing' OR NEW.status NOT IN ('completed', 'rejected', 'unknown') THEN
      RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE';
    END IF;
    IF NEW.status = 'completed' AND NEW.protocol_version = 2 THEN
      PERFORM 1 FROM checkout_chat_exchanges e WHERE e.request_id = NEW.id AND e.merchant_id = NEW.merchant_id
        AND e.session_id = NEW.session_id AND e.recorded_at <= NEW.finished_at;
      IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_EXCHANGE_REQUIRED'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Resolution proof and terminal receipt must commit together. This also fences
-- a stale worker attempting to finish its former processing claim afterwards.
CREATE FUNCTION require_reconciled_chat_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM checkout_chat_requests WHERE id = NEW.request_id AND merchant_id = NEW.merchant_id
    AND session_id = NEW.session_id AND status = 'reconciled' AND finished_at = NEW.resolved_at)
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_NOT_APPLIED'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER reconciled_chat_request_required AFTER INSERT ON checkout_chat_resolutions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_reconciled_chat_request();

-- Preserve publication guards while admitting the new, explicit main-chat policy.
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
    OR t.publication_policy IS NULL OR t.publication_policy NOT IN ('text_only_no_personalization_v1', 'main_chat_text_only_v1')
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
