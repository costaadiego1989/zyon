-- CANDIDATE ONLY. Applied exclusively by the authorized disposable-DB harness.
-- Not a Prisma migration; no production adapter, effects, recovery or purge.
BEGIN;

-- Match JavaScript's nonblank and UTF-16 ID bounds without normalizing values.
CREATE FUNCTION storefront_write_valid_id(value TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN char_length(value) NOT BETWEEN 1 AND 191 THEN false ELSE
    (SELECT sum(CASE WHEN ascii(substring(value FROM n FOR 1)) > 65535 THEN 2 ELSE 1 END)
      FROM generate_series(1, char_length(value)) AS n) <= 191
    AND translate(value, (SELECT string_agg(chr(c), '') FROM unnest(ARRAY[
      9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,
      8201,8202,8232,8233,8239,8287,12288,65279]) AS c), '') <> '' END;
$$;

CREATE TABLE storefront_execution_scopes (
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  conversation_id TEXT NOT NULL,
  cart_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  protocol_owned BOOLEAN NOT NULL DEFAULT true CHECK (protocol_owned),
  scope_revision BIGINT NOT NULL DEFAULT 0 CHECK (scope_revision BETWEEN 0 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (merchant_id, conversation_id),
  UNIQUE (merchant_id, cart_id),
  UNIQUE (merchant_id, conversation_id, cart_id, principal_id),
  CHECK (storefront_write_valid_id(merchant_id) AND storefront_write_valid_id(conversation_id)
    AND storefront_write_valid_id(cart_id) AND storefront_write_valid_id(principal_id))
);

CREATE TABLE storefront_write_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  cart_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  message_id TEXT NOT NULL CHECK (storefront_write_valid_id(message_id)),
  protocol_version SMALLINT NOT NULL CHECK (protocol_version > 0),
  fingerprint_version SMALLINT NOT NULL CHECK (fingerprint_version > 0),
  request_fingerprint BYTEA NOT NULL CHECK (octet_length(request_fingerprint) BETWEEN 16 AND 128),
  command_kind TEXT NOT NULL CHECK (command_kind = 'add_item_to_cart'),
  expected_revision BIGINT NOT NULL CHECK (expected_revision BETWEEN 0 AND 9007199254740991),
  claim_generation BIGINT NOT NULL DEFAULT 1 CHECK (claim_generation = 1),
  claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'processing',
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  FOREIGN KEY (merchant_id, conversation_id, cart_id, principal_id)
    REFERENCES storefront_execution_scopes(merchant_id, conversation_id, cart_id, principal_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (merchant_id, conversation_id, message_id),
  CHECK ((status = 'processing' AND finished_at IS NULL)
    OR (status = 'unknown' AND finished_at IS NOT NULL AND finished_at >= started_at))
);
CREATE UNIQUE INDEX storefront_write_one_unresolved ON storefront_write_requests(merchant_id, conversation_id)
  WHERE status IN ('processing', 'unknown');

CREATE FUNCTION guard_storefront_execution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'STOREFRONT_SCOPE_IMMUTABLE'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'STOREFRONT_SCOPE_IMMUTABLE'; END IF;
  ELSE
    IF NEW.scope_revision <> 0 OR NOT NEW.protocol_owned THEN RAISE EXCEPTION 'STOREFRONT_SCOPE_INVALID_INITIAL_STATE'; END IF;
    NEW.created_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER storefront_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON storefront_execution_scopes
  FOR EACH ROW EXECUTE FUNCTION guard_storefront_execution_scope();
CREATE TRIGGER storefront_scope_no_truncate BEFORE TRUNCATE ON storefront_execution_scopes
  FOR EACH STATEMENT EXECUTE FUNCTION guard_storefront_execution_scope();

CREATE FUNCTION guard_storefront_write_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision BIGINT; lock_key TEXT;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'STOREFRONT_REQUEST_IMMUTABLE'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'processing' OR NEW.finished_at IS NOT NULL THEN RAISE EXCEPTION 'STOREFRONT_REQUEST_INVALID_INITIAL_STATE'; END IF;
    -- Exact JSON.stringify(["storefront-cart", merchantId, sessionId]) namespace,
    -- where sessionId is the bound cart_id, not an independently chosen conv ID.
    lock_key := '["storefront-cart",' || to_json(NEW.merchant_id)::TEXT || ',' || to_json(NEW.cart_id)::TEXT || ']';
    PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));
    SELECT scope_revision INTO current_revision FROM storefront_execution_scopes
      WHERE merchant_id = NEW.merchant_id AND conversation_id = NEW.conversation_id
        AND cart_id = NEW.cart_id AND principal_id = NEW.principal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'STOREFRONT_REQUEST_SCOPE_MISMATCH'; END IF;
    IF NEW.expected_revision <> current_revision THEN RAISE EXCEPTION 'STOREFRONT_REQUEST_REVISION_MISMATCH'; END IF;
    NEW.started_at := clock_timestamp();
  ELSE
    IF OLD.status <> 'processing' OR NEW.status <> 'unknown'
      OR (NEW.id, NEW.merchant_id, NEW.conversation_id, NEW.cart_id, NEW.principal_id,
        NEW.message_id, NEW.protocol_version, NEW.fingerprint_version, NEW.request_fingerprint,
        NEW.command_kind, NEW.expected_revision, NEW.claim_generation, NEW.claim_token, NEW.started_at)
      IS DISTINCT FROM
      (OLD.id, OLD.merchant_id, OLD.conversation_id, OLD.cart_id, OLD.principal_id,
        OLD.message_id, OLD.protocol_version, OLD.fingerprint_version, OLD.request_fingerprint,
        OLD.command_kind, OLD.expected_revision, OLD.claim_generation, OLD.claim_token, OLD.started_at)
    THEN RAISE EXCEPTION 'STOREFRONT_REQUEST_IMMUTABLE'; END IF;
    NEW.finished_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER storefront_request_guard BEFORE INSERT OR UPDATE OR DELETE ON storefront_write_requests
  FOR EACH ROW EXECUTE FUNCTION guard_storefront_write_request();
CREATE TRIGGER storefront_request_no_truncate BEFORE TRUNCATE ON storefront_write_requests
  FOR EACH STATEMENT EXECUTE FUNCTION guard_storefront_write_request();
COMMIT;
