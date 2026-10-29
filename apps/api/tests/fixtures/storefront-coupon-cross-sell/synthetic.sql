-- Synthetic stage39 layer over UoW31, authority33 and cross-sell38 fixtures.
-- Not a migration, full production schema or checkout redemption-lifecycle proof.
-- Real Prisma scalar projections: Coupon21, CouponRedemption11, OutboxMessage18.
-- Strategy aggregate intentionally absent: non-null strategy links fail closed.
CREATE TABLE merchants (id TEXT PRIMARY KEY, store_settings JSONB);
INSERT INTO merchants VALUES ('synthetic-merchant','{}'),('foreign-merchant','{}');
ALTER TABLE merchant_rules ADD COLUMN origin_zip TEXT;
ALTER TABLE merchant_rules ADD COLUMN quick_replies JSONB;
ALTER TABLE merchant_rules ADD COLUMN crypto_payments JSONB;

CREATE TABLE coupons (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL,
  strategy_incentive_execution_id TEXT UNIQUE CHECK (strategy_incentive_execution_id IS NULL),
  code TEXT NOT NULL, discount_type TEXT NOT NULL, discount_value DECIMAL(12,4) NOT NULL,
  min_cart_total DECIMAL(12,4), free_shipping_min_cart_total DECIMAL(12,4),
  max_usages INTEGER, min_per_buyer INTEGER, max_per_buyer INTEGER,
  usages_count INTEGER NOT NULL DEFAULT 0,
  allowed_skus TEXT[] DEFAULT ARRAY[]::TEXT[], blocked_skus TEXT[] DEFAULT ARRAY[]::TEXT[],
  allowed_regions TEXT[] DEFAULT ARRAY[]::TEXT[], blocked_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'active', starts_at TIMESTAMP(3) NOT NULL, ends_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE (merchant_id,code)
);
CREATE INDEX coupons_merchant_id_status_idx ON coupons(merchant_id,status);
CREATE INDEX coupons_ends_at_idx ON coupons(ends_at);
CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL, session_id TEXT NOT NULL, buyer_global_user_id TEXT,
  discount_applied DECIMAL(12,4) NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied', order_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE (merchant_id,session_id,coupon_id)
);
CREATE INDEX coupon_redemptions_merchant_coupon_status_idx ON coupon_redemptions(merchant_id,coupon_id,status);
CREATE INDEX coupon_redemptions_merchant_buyer_coupon_status_idx ON coupon_redemptions(merchant_id,buyer_global_user_id,coupon_id,status);
CREATE TABLE outbox_messages (
  event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL,
  merchant_id TEXT NOT NULL, occurred_at TIMESTAMP(3) NOT NULL, correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL, producer TEXT NOT NULL, payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, next_attempt_at TIMESTAMP(3), delivered_at TIMESTAMP(3), published_at TIMESTAMP(3),
  lease_token TEXT, lease_expires_at TIMESTAMP(3), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX outbox_messages_merchant_id_created_at_idx ON outbox_messages(merchant_id,created_at);
CREATE INDEX outbox_messages_status_created_at_idx ON outbox_messages(status,created_at);
CREATE INDEX outbox_messages_status_next_attempt_at_idx ON outbox_messages(status,next_attempt_at);
CREATE INDEX outbox_messages_status_lease_expires_at_idx ON outbox_messages(status,lease_expires_at);

-- All gates/faults are synthetic-only and use invoker privileges. Each triggers
-- only for explicit test identities; no production behavior is represented.
CREATE FUNCTION synthetic_coupon_outbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload->>'session_id'='native-outbox-failure' THEN
    RAISE EXCEPTION 'synthetic_coupon_outbox_failure';
  END IF;
  IF NEW.payload->>'session_id'='native-coupon-first' THEN
    PERFORM pg_advisory_xact_lock(7393901);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_coupon_outbox_fault BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION synthetic_coupon_outbox_fault();
CREATE FUNCTION synthetic_coupon_cas_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id='native-cas-failure' THEN
    UPDATE storefront_carts SET total=total+1 WHERE merchant_id=NEW.merchant_id AND session_id=NEW.session_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_coupon_cas_fault AFTER INSERT ON coupon_redemptions
FOR EACH ROW EXECUTE FUNCTION synthetic_coupon_cas_fault();
CREATE FUNCTION synthetic_coupon_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload->>'session_id'='native-deferred-failure' THEN
    RAISE EXCEPTION 'synthetic_coupon_deferred_failure';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER synthetic_coupon_commit_fault AFTER INSERT ON outbox_messages
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_coupon_commit_fault();
CREATE FUNCTION synthetic_cross_sell_accept_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id='native-cross-sell-first' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.items) item WHERE item ? 'crossSellIntent'
  ) THEN PERFORM pg_advisory_xact_lock(7393902); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_cross_sell_accept_gate BEFORE UPDATE ON storefront_carts
FOR EACH ROW EXECUTE FUNCTION synthetic_cross_sell_accept_gate();
