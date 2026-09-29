-- Payment recovery is opt-in at exchange creation. Historical exchanges stay ineligible.
ALTER TABLE checkout_chat_exchanges ADD COLUMN payment_method TEXT,
  ADD COLUMN payment_cart_hash TEXT, ADD COLUMN payment_context_hash TEXT;
ALTER TABLE checkout_chat_exchanges ADD CONSTRAINT chat_exchange_payment_proof CHECK (
  (payment_method IS NULL AND payment_cart_hash IS NULL AND payment_context_hash IS NULL) OR
  (payment_method IS NOT NULL AND payment_method IN ('pix', 'credit_card', 'boleto', 'crypto')
    AND payment_cart_hash IS NOT NULL AND payment_cart_hash ~ '^[a-f0-9]{64}$'
    AND payment_context_hash IS NOT NULL AND payment_context_hash ~ '^[a-f0-9]{64}$')
);

CREATE FUNCTION checkout_chat_payment_context_hash(s checkout_sessions) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(s.cart, s.shipping,
    s.customer - 'asaasCustomerId', s.global_user_id, s.conversation_id, s.payment_method)::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION guard_checkout_chat_payment_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s checkout_sessions;
BEGIN
  IF NEW.payment_method IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM checkout_sessions WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id FOR UPDATE;
  IF NEW.payment_method IS DISTINCT FROM s.payment_method
    OR NEW.payment_context_hash IS DISTINCT FROM checkout_chat_payment_context_hash(s)
  THEN RAISE EXCEPTION 'CHAT_PAYMENT_CONTEXT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_chat_payment_proof_guard BEFORE INSERT ON checkout_chat_exchanges
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_chat_payment_proof();

-- Reads only. Pending/uncertain creation is never evidence of a safe completion.
CREATE FUNCTION checkout_chat_recoverable_payment(request_ref TEXT) RETURNS SETOF payment_intents
LANGUAGE sql STABLE AS $$
  SELECT p.* FROM checkout_chat_requests r
    JOIN checkout_chat_exchanges x ON x.request_id = r.id AND x.merchant_id = r.merchant_id AND x.session_id = r.session_id
    JOIN checkout_sessions s ON s.merchant_id = r.merchant_id AND s.session_id = r.session_id
    JOIN payment_intents p ON p.merchant_id = r.merchant_id AND p.session_id = r.session_id AND p.idempotency_key = 'chat:' || r.id
  WHERE r.id = request_ref AND r.protocol_version = 2 AND r.conversation_id = s.conversation_id
    AND x.payment_method = s.payment_method
    AND p.method = CASE x.payment_method WHEN 'credit_card' THEN 'card' ELSE x.payment_method END
    AND x.payment_context_hash = checkout_chat_payment_context_hash(s)
    AND p.amount_breakdown->>'cartFingerprint' = x.payment_cart_hash
    AND p.amount_breakdown->>'totalCents' = p.amount_cents::text AND p.amount_cents > 0
    AND p.currency = upper(s.cart->>'currency') AND p.amount_breakdown->>'currency' = p.currency
    AND p.created_at >= x.recorded_at AND p.version > 0 AND p.creation->>'state' = 'complete'
    AND length(trim(p.provider_payment_id)) > 0
    AND p.status IN ('requires_action', 'approved', 'failed', 'cancelled', 'refunded',
      'chargeback_pending', 'chargeback_disputed', 'chargeback_lost', 'chargeback_won')
$$;

CREATE TABLE checkout_chat_payment_resolutions (
  request_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL, payment_version INTEGER NOT NULL CHECK (payment_version > 0),
  payment_status TEXT NOT NULL, previous_status TEXT NOT NULL CHECK (previous_status IN ('processing', 'unknown')),
  previous_finished_at TIMESTAMP(3), resolved_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT chat_payment_resolution_request_fk FOREIGN KEY (request_id, merchant_id, session_id)
    REFERENCES checkout_chat_requests(id, merchant_id, session_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chat_payment_resolution_intent_fk FOREIGN KEY (payment_intent_id, merchant_id)
    REFERENCES payment_intents(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX chat_payment_resolution_scope_idx ON checkout_chat_payment_resolutions(merchant_id, session_id, resolved_at);
CREATE UNIQUE INDEX chat_payment_resolution_request_scope_key ON checkout_chat_payment_resolutions(request_id, merchant_id, session_id);

CREATE FUNCTION guard_checkout_chat_payment_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r checkout_chat_requests; p payment_intents;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'CHAT_PAYMENT_RESOLUTION_IMMUTABLE'; END IF;
  PERFORM 1 FROM checkout_sessions WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id FOR UPDATE;
  SELECT * INTO r FROM checkout_chat_requests WHERE id = NEW.request_id AND merchant_id = NEW.merchant_id
    AND session_id = NEW.session_id FOR UPDATE;
  PERFORM 1 FROM payment_intents WHERE id = NEW.payment_intent_id AND merchant_id = NEW.merchant_id FOR SHARE;
  SELECT * INTO p FROM checkout_chat_recoverable_payment(NEW.request_id);
  IF r.id IS NULL OR p.id IS NULL OR r.status NOT IN ('processing', 'unknown')
    OR p.id IS DISTINCT FROM NEW.payment_intent_id OR p.version IS DISTINCT FROM NEW.payment_version
    OR p.status IS DISTINCT FROM NEW.payment_status OR r.status IS DISTINCT FROM NEW.previous_status
    OR r.finished_at IS DISTINCT FROM NEW.previous_finished_at
    OR NEW.resolved_at < p.updated_at OR NEW.resolved_at < r.finished_at OR NEW.resolved_at > clock_timestamp()
  THEN RAISE EXCEPTION 'CHAT_PAYMENT_RESOLUTION_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checkout_chat_payment_resolution_guard BEFORE INSERT OR UPDATE OR DELETE ON checkout_chat_payment_resolutions
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_chat_payment_resolution();
CREATE CONSTRAINT TRIGGER reconciled_payment_request_required AFTER INSERT ON checkout_chat_payment_resolutions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_reconciled_chat_request();

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
    IF (NEW.id, NEW.merchant_id, NEW.session_id, NEW.conversation_id, NEW.message_id, NEW.request_hash,
          NEW.started_at, NEW.protocol_version, NEW.buyer_message_hash)
        IS DISTINCT FROM (OLD.id, OLD.merchant_id, OLD.session_id, OLD.conversation_id, OLD.message_id, OLD.request_hash,
          OLD.started_at, OLD.protocol_version, OLD.buyer_message_hash)
    THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE'; END IF;
    IF NEW.status = 'reconciled' AND OLD.status IN ('processing', 'unknown') AND NEW.protocol_version = 2 THEN
      IF NEW.response_hash IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM (
          SELECT request_id, merchant_id, session_id, previous_status, previous_finished_at, resolved_at FROM checkout_chat_resolutions
          UNION ALL
          SELECT request_id, merchant_id, session_id, previous_status, previous_finished_at, resolved_at FROM checkout_chat_payment_resolutions
        ) evidence WHERE request_id = NEW.id AND merchant_id = NEW.merchant_id AND session_id = NEW.session_id
          AND previous_status = OLD.status AND previous_finished_at IS NOT DISTINCT FROM OLD.finished_at
          AND resolved_at = NEW.finished_at
      ) THEN RAISE EXCEPTION 'CHECKOUT_CHAT_RESOLUTION_REQUIRED'; END IF;
    ELSIF OLD.status <> 'processing' OR NEW.status NOT IN ('completed', 'rejected', 'unknown') THEN
      RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE';
    END IF;
    IF NEW.status = 'completed' AND NEW.protocol_version = 2 THEN
      PERFORM 1 FROM checkout_sessions WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id FOR SHARE;
      PERFORM 1 FROM payment_intents WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id
        AND idempotency_key = 'chat:' || NEW.id FOR SHARE;
      PERFORM 1 FROM checkout_chat_exchanges e WHERE e.request_id = NEW.id AND e.merchant_id = NEW.merchant_id
        AND e.session_id = NEW.session_id AND e.recorded_at <= NEW.finished_at;
      IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_EXCHANGE_REQUIRED'; END IF;
      IF EXISTS (SELECT 1 FROM checkout_chat_exchanges WHERE request_id = NEW.id AND payment_method IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM checkout_chat_recoverable_payment(NEW.id))
      THEN RAISE EXCEPTION 'CHAT_PAYMENT_RESULT_REQUIRED'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
