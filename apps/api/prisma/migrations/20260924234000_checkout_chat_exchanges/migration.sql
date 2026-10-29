-- Preserve historical receipts as v1; all new claims require the v2 proof.
ALTER TABLE checkout_chat_requests ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN buyer_message_hash TEXT;
ALTER TABLE checkout_chat_requests ALTER COLUMN protocol_version SET DEFAULT 2;
ALTER TABLE checkout_chat_requests ADD CONSTRAINT checkout_chat_request_protocol_check CHECK (
  (protocol_version = 1 AND buyer_message_hash IS NULL) OR
  (protocol_version = 2 AND buyer_message_hash IS NOT NULL AND buyer_message_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX checkout_chat_requests_id_merchant_id_session_id_key
  ON checkout_chat_requests (id, merchant_id, session_id);

CREATE TABLE checkout_chat_exchanges (
  request_id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  exchange_hash TEXT NOT NULL CHECK (exchange_hash ~ '^[a-f0-9]{64}$'),
  recorded_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT checkout_chat_exchanges_request_id_merchant_id_session_id_fkey
    FOREIGN KEY (request_id, merchant_id, session_id)
    REFERENCES checkout_chat_requests (id, merchant_id, session_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX checkout_chat_exchanges_merchant_id_session_id_recorded_at_idx
  ON checkout_chat_exchanges (merchant_id, session_id, recorded_at);
CREATE UNIQUE INDEX checkout_chat_exchanges_request_id_merchant_id_session_id_key
  ON checkout_chat_exchanges (request_id, merchant_id, session_id);

CREATE FUNCTION guard_checkout_chat_exchange() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  history JSONB;
  request checkout_chat_requests%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_EXCHANGE_IMMUTABLE'; END IF;
  SELECT s.chat_history INTO history FROM checkout_sessions s
    WHERE s.merchant_id = NEW.merchant_id AND s.session_id = NEW.session_id FOR UPDATE;
  SELECT r.* INTO request FROM checkout_chat_requests r WHERE r.id = NEW.request_id
    AND r.merchant_id = NEW.merchant_id AND r.session_id = NEW.session_id FOR UPDATE;
  IF NOT FOUND OR request.status <> 'processing' OR request.protocol_version <> 2
    OR NEW.recorded_at < request.started_at OR NEW.recorded_at > clock_timestamp()
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_EXCHANGE_CLAIM_CONFLICT'; END IF;
  IF jsonb_typeof(history) IS DISTINCT FROM 'array' OR jsonb_array_length(history) < 2
    OR history -> -2 ->> 'role' IS DISTINCT FROM 'buyer'
    OR history -> -1 ->> 'role' IS DISTINCT FROM 'agent'
    OR history -> -2 ->> 'chatRequestId' IS DISTINCT FROM NEW.request_id
    OR history -> -1 ->> 'chatRequestId' IS DISTINCT FROM NEW.request_id
    OR jsonb_typeof(history -> -2 -> 'text') IS DISTINCT FROM 'string'
    OR encode(sha256(convert_to(history -> -2 ->> 'text', 'UTF8')), 'hex') IS DISTINCT FROM request.buyer_message_hash
    OR jsonb_typeof(history -> -1 -> 'text') IS DISTINCT FROM 'string'
    OR (history -> -2 ->> 'occurredAt')::timestamp IS DISTINCT FROM NEW.recorded_at
    OR (history -> -1 ->> 'occurredAt')::timestamp IS DISTINCT FROM NEW.recorded_at
    OR encode(sha256(convert_to(jsonb_build_array(history -> -2, history -> -1)::text, 'UTF8')), 'hex') IS DISTINCT FROM NEW.exchange_hash
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_EXCHANGE_PAIR_MISMATCH'; END IF;
  PERFORM 1 FROM checkout_sessions s WHERE s.merchant_id = NEW.merchant_id AND s.session_id = NEW.session_id
    AND s.conversation_id = request.conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_CHAT_EXCHANGE_CLAIM_CONFLICT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_chat_exchange_guard BEFORE INSERT OR UPDATE OR DELETE ON checkout_chat_exchanges
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_chat_exchange();

CREATE OR REPLACE FUNCTION guard_checkout_chat_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'processing' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_INVALID_INITIAL_STATE'; END IF;
    IF NEW.protocol_version <> 2 THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_PROTOCOL_REQUIRED'; END IF;
    PERFORM 1 FROM checkout_sessions s WHERE s.merchant_id = NEW.merchant_id AND s.session_id = NEW.session_id
      AND s.conversation_id = NEW.conversation_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_SESSION_MISMATCH'; END IF;
  ELSE
    IF OLD.status <> 'processing' OR NEW.status NOT IN ('completed', 'rejected', 'unknown')
      OR (NEW.id, NEW.merchant_id, NEW.session_id, NEW.conversation_id, NEW.message_id, NEW.request_hash,
          NEW.started_at, NEW.protocol_version, NEW.buyer_message_hash)
        IS DISTINCT FROM
         (OLD.id, OLD.merchant_id, OLD.session_id, OLD.conversation_id, OLD.message_id, OLD.request_hash,
          OLD.started_at, OLD.protocol_version, OLD.buyer_message_hash)
    THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE'; END IF;
    IF NEW.status = 'completed' AND NEW.protocol_version = 2 THEN
      PERFORM 1 FROM checkout_chat_exchanges e WHERE e.request_id = NEW.id AND e.merchant_id = NEW.merchant_id
        AND e.session_id = NEW.session_id AND e.recorded_at <= NEW.finished_at;
      IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_EXCHANGE_REQUIRED'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Protect owned histories even after the feature flag is disabled. Preserve
-- existing single-turn follow-ups and the 50-turn retention limit.
CREATE FUNCTION guard_checkout_owned_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n INTEGER;
  candidate JSONB;
  tail JSONB;
BEGIN
  IF NEW.chat_history IS NOT DISTINCT FROM OLD.chat_history THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM checkout_chat_requests r WHERE r.merchant_id = OLD.merchant_id
    AND r.session_id = OLD.session_id) THEN RETURN NEW; END IF;
  IF jsonb_typeof(OLD.chat_history) IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.chat_history) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'CHECKOUT_CHAT_HISTORY_REWRITE_FORBIDDEN'; END IF;
  FOR n IN 1..2 LOOP
    IF jsonb_array_length(NEW.chat_history) <> LEAST(50, jsonb_array_length(OLD.chat_history) + n) THEN CONTINUE; END IF;
    SELECT jsonb_agg(value ORDER BY ord) INTO tail FROM jsonb_array_elements(NEW.chat_history) WITH ORDINALITY AS e(value, ord)
      WHERE ord > jsonb_array_length(NEW.chat_history) - n;
    SELECT jsonb_agg(value ORDER BY ord) INTO candidate FROM jsonb_array_elements(OLD.chat_history || tail) WITH ORDINALITY AS e(value, ord)
      WHERE ord > GREATEST(0, jsonb_array_length(OLD.chat_history) + n - 50);
    IF candidate = NEW.chat_history THEN RETURN NEW; END IF;
  END LOOP;
  RAISE EXCEPTION 'CHECKOUT_CHAT_HISTORY_REWRITE_FORBIDDEN';
END $$;
CREATE TRIGGER checkout_owned_history_guard BEFORE UPDATE OF chat_history ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_owned_history();
