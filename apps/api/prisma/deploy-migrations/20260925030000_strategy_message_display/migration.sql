-- Client telemetry is distinct from persistence, human attention and conversion.
CREATE TABLE strategy_message_displays (
  turn_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_text_hash TEXT NOT NULL CHECK (agent_text_hash ~ '^[a-f0-9]{64}$'),
  definition TEXT NOT NULL CHECK (definition = 'widget-visible-text-v1'),
  recorded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT strategy_message_displays_turn_id_merchant_id_fkey FOREIGN KEY (turn_id, merchant_id)
    REFERENCES strategy_turn_publications(turn_id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX strategy_message_displays_turn_id_merchant_id_key ON strategy_message_displays(turn_id, merchant_id);
CREATE INDEX strategy_message_displays_merchant_id_session_id_recorded_a_idx ON strategy_message_displays(merchant_id, session_id, recorded_at);

CREATE FUNCTION guard_strategy_message_display() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'STRATEGY_MESSAGE_DISPLAY_IMMUTABLE'; END IF;
  -- Same lock order as publication/recovery. No strategy lifecycle lock: a late
  -- display of already published history remains evidence after a pause.
  PERFORM 1 FROM checkout_sessions WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id FOR SHARE;
  IF NOT EXISTS (
    SELECT 1 FROM strategy_turn_publications p
      JOIN checkout_chat_requests r ON r.id = p.request_id AND r.merchant_id = p.merchant_id
      JOIN checkout_chat_exchanges x ON x.request_id = p.exchange_request_id AND x.merchant_id = p.merchant_id AND x.session_id = p.session_id
      JOIN checkout_sessions s ON s.merchant_id = p.merchant_id AND s.session_id = p.session_id
    WHERE p.turn_id = NEW.turn_id AND p.merchant_id = NEW.merchant_id AND p.session_id = NEW.session_id
      AND p.decision = 'persisted' AND p.agent_text_hash = NEW.agent_text_hash
      AND r.status IN ('completed', 'reconciled') AND r.conversation_id = NEW.conversation_id AND s.conversation_id = NEW.conversation_id
      AND NEW.recorded_at >= p.recorded_at AND NEW.recorded_at <= clock_timestamp()
  ) THEN RAISE EXCEPTION 'STRATEGY_MESSAGE_DISPLAY_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_message_display_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_message_displays
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_message_display();
