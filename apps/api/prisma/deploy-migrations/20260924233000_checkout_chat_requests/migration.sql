CREATE TABLE "checkout_chat_requests" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "response_hash" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "checkout_chat_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_chat_requests_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id")
    REFERENCES "checkout_sessions" ("merchant_id", "session_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "checkout_chat_request_key_check" CHECK ("message_id" ~ '^[a-zA-Z0-9_-]{16,128}$'),
  CONSTRAINT "checkout_chat_request_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "checkout_chat_request_state_check" CHECK (
    ("status" = 'processing' AND "finished_at" IS NULL AND "response_hash" IS NULL) OR
    ("status" IN ('rejected', 'unknown') AND "finished_at" IS NOT NULL AND "response_hash" IS NULL) OR
    ("status" = 'completed' AND "finished_at" IS NOT NULL AND "response_hash" IS NOT NULL AND "response_hash" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "checkout_chat_request_time_check" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at")
);
CREATE UNIQUE INDEX "checkout_chat_requests_merchant_id_session_id_message_id_key"
  ON "checkout_chat_requests" ("merchant_id", "session_id", "message_id");
CREATE INDEX "checkout_chat_requests_status_started_at_idx" ON "checkout_chat_requests" ("status", "started_at");
-- Unknown effects hold the lane too: a new key cannot evade an uncertain request.
CREATE UNIQUE INDEX "checkout_chat_requests_one_unresolved_session"
  ON "checkout_chat_requests" ("merchant_id", "session_id") WHERE "status" IN ('processing', 'unknown');

CREATE FUNCTION guard_checkout_chat_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'processing' THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_INVALID_INITIAL_STATE'; END IF;
    PERFORM 1 FROM checkout_sessions s WHERE s.merchant_id = NEW.merchant_id AND s.session_id = NEW.session_id
      AND s.conversation_id = NEW.conversation_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_SESSION_MISMATCH'; END IF;
  ELSE
    IF OLD.status <> 'processing' OR NEW.status NOT IN ('completed', 'rejected', 'unknown')
      OR (NEW.id, NEW.merchant_id, NEW.session_id, NEW.conversation_id, NEW.message_id, NEW.request_hash, NEW.started_at)
        IS DISTINCT FROM
         (OLD.id, OLD.merchant_id, OLD.session_id, OLD.conversation_id, OLD.message_id, OLD.request_hash, OLD.started_at)
    THEN RAISE EXCEPTION 'CHECKOUT_CHAT_REQUEST_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "checkout_chat_request_guard" BEFORE INSERT OR UPDATE OR DELETE ON "checkout_chat_requests"
  FOR EACH ROW EXECUTE FUNCTION guard_checkout_chat_request();
