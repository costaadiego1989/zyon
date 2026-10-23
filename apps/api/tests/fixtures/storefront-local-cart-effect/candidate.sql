-- LOCAL CANDIDATE ONLY, layered after stage29 admission and stage31 cart fixture.
-- Not a migration, full commercial evidence snapshot, pricing policy or release.
BEGIN;
CREATE TABLE storefront_local_cart_effects (
  effect_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  request_id UUID PRIMARY KEY REFERENCES storefront_write_requests(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  cart_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  claim_generation BIGINT NOT NULL CHECK (claim_generation = 1),
  before_revision BIGINT NOT NULL CHECK (before_revision BETWEEN 0 AND 9007199254740990),
  after_revision BIGINT NOT NULL CHECK (after_revision BETWEEN 1 AND 9007199254740991 AND after_revision = before_revision + 1),
  cart_row_id TEXT NOT NULL CHECK (storefront_write_valid_id(cart_row_id)),
  cart_updated_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (merchant_id,conversation_id,cart_id,principal_id)
    REFERENCES storefront_execution_scopes(merchant_id,conversation_id,cart_id,principal_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE FUNCTION guard_storefront_local_cart_effect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE anchor storefront_execution_scopes%ROWTYPE;
  request storefront_write_requests%ROWTYPE;
  lock_key TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'STOREFRONT_LOCAL_EFFECT_IMMUTABLE'; END IF;
  lock_key := '["storefront-cart",' || to_json(NEW.merchant_id)::TEXT || ',' || to_json(NEW.cart_id)::TEXT || ']';
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
  SELECT * INTO anchor FROM storefront_execution_scopes
    WHERE merchant_id=NEW.merchant_id AND conversation_id=NEW.conversation_id
      AND cart_id=NEW.cart_id AND principal_id=NEW.principal_id FOR UPDATE;
  IF NOT FOUND OR NOT anchor.protocol_owned THEN RAISE EXCEPTION 'STOREFRONT_LOCAL_EFFECT_SCOPE_MISMATCH'; END IF;
  SELECT * INTO request FROM storefront_write_requests WHERE id=NEW.request_id FOR UPDATE;
  IF NOT FOUND OR (request.merchant_id,request.conversation_id,request.cart_id,request.principal_id)
    IS DISTINCT FROM (NEW.merchant_id,NEW.conversation_id,NEW.cart_id,NEW.principal_id)
    OR request.status <> 'processing' OR request.claim_generation <> 1 OR NEW.claim_generation <> request.claim_generation
    OR request.expected_revision <> NEW.before_revision OR anchor.scope_revision <> NEW.before_revision
    OR NEW.after_revision <> NEW.before_revision+1
  THEN RAISE EXCEPTION 'STOREFRONT_LOCAL_EFFECT_REQUEST_MISMATCH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storefront_carts WHERE id=NEW.cart_row_id
    AND merchant_id=NEW.merchant_id AND session_id=NEW.cart_id AND updated_at=NEW.cart_updated_at)
  THEN RAISE EXCEPTION 'STOREFRONT_LOCAL_EFFECT_CART_MISMATCH'; END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER storefront_local_effect_guard BEFORE INSERT OR UPDATE OR DELETE ON storefront_local_cart_effects
FOR EACH ROW EXECUTE FUNCTION guard_storefront_local_cart_effect();
CREATE TRIGGER storefront_local_effect_no_truncate BEFORE TRUNCATE ON storefront_local_cart_effects
FOR EACH STATEMENT EXECUTE FUNCTION guard_storefront_local_cart_effect();

-- Only this additive layer evolves the old immutable scope guard. Identity,
-- ownership and timestamps remain immutable; a witnessed +1 is the sole change.
CREATE OR REPLACE FUNCTION guard_storefront_execution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'STOREFRONT_SCOPE_IMMUTABLE'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.scope_revision <> 0 OR NOT NEW.protocol_owned THEN RAISE EXCEPTION 'STOREFRONT_SCOPE_INVALID_INITIAL_STATE'; END IF;
    NEW.created_at := clock_timestamp();
  ELSIF NEW IS DISTINCT FROM OLD THEN
    IF (NEW.merchant_id,NEW.conversation_id,NEW.cart_id,NEW.principal_id,NEW.protocol_owned,NEW.created_at)
      IS DISTINCT FROM (OLD.merchant_id,OLD.conversation_id,OLD.cart_id,OLD.principal_id,OLD.protocol_owned,OLD.created_at)
      OR NEW.scope_revision <> OLD.scope_revision+1
      OR NOT EXISTS (SELECT 1 FROM storefront_local_cart_effects effect
        JOIN storefront_write_requests request ON request.id=effect.request_id
        WHERE effect.merchant_id=OLD.merchant_id AND effect.conversation_id=OLD.conversation_id
          AND effect.cart_id=OLD.cart_id AND effect.principal_id=OLD.principal_id
          AND effect.before_revision=OLD.scope_revision AND effect.after_revision=NEW.scope_revision
          AND effect.claim_generation=1 AND request.claim_generation=1 AND request.status='processing'
          AND request.expected_revision=OLD.scope_revision
          AND (request.merchant_id,request.conversation_id,request.cart_id,request.principal_id)
            =(OLD.merchant_id,OLD.conversation_id,OLD.cart_id,OLD.principal_id))
    THEN RAISE EXCEPTION 'STOREFRONT_SCOPE_UNWITNESSED_REVISION'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION advance_storefront_local_cart_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE storefront_execution_scopes SET scope_revision=NEW.after_revision
    WHERE merchant_id=NEW.merchant_id AND conversation_id=NEW.conversation_id
      AND cart_id=NEW.cart_id AND principal_id=NEW.principal_id AND protocol_owned
      AND scope_revision=NEW.before_revision;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'STOREFRONT_LOCAL_EFFECT_REVISION_CAS_FAILED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER storefront_local_effect_revision AFTER INSERT ON storefront_local_cart_effects
FOR EACH ROW EXECUTE FUNCTION advance_storefront_local_cart_revision();
COMMIT;
