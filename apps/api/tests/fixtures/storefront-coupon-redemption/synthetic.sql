-- Stage40A, disposable only. Mirrors scalar projections, NOT production DDL.
-- Coupon21, CouponRedemption11, OutboxMessage18, OutboxHandlerExecution3.
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
CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL, session_id TEXT NOT NULL, buyer_global_user_id TEXT,
  discount_applied DECIMAL(12,4) NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied', order_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE (merchant_id,session_id,coupon_id)
);
CREATE TABLE outbox_messages (
  event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL,
  merchant_id TEXT NOT NULL, occurred_at TIMESTAMP(3) NOT NULL, correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL, producer TEXT NOT NULL, payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, next_attempt_at TIMESTAMP(3), delivered_at TIMESTAMP(3), published_at TIMESTAMP(3),
  lease_token TEXT, lease_expires_at TIMESTAMP(3), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE outbox_handler_executions (
  event_id TEXT NOT NULL, handler_id TEXT NOT NULL,
  processed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(event_id,handler_id)
);
-- No production role/grant/endpoint. Explicit synthetic-only fault switches.
CREATE TABLE synthetic_redemption_faults (session_id TEXT PRIMARY KEY, mode TEXT NOT NULL);
CREATE FUNCTION synthetic_redemption_outbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='coupon.redeemed' AND EXISTS (
    SELECT 1 FROM synthetic_redemption_faults f WHERE f.session_id=NEW.payload->>'session_id' AND f.mode IN ('outbox','enqueue')
  ) THEN RAISE EXCEPTION 'synthetic_redemption_outbox_failure'; END IF;
  IF NEW.event_type='coupon.redemption.requested' AND EXISTS (
    SELECT 1 FROM synthetic_redemption_faults f WHERE f.session_id=NEW.payload->>'session_id' AND f.mode='enqueue'
  ) THEN RAISE EXCEPTION 'synthetic_redemption_enqueue_failure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_redemption_outbox_fault BEFORE INSERT ON outbox_messages
FOR EACH ROW EXECUTE FUNCTION synthetic_redemption_outbox_fault();
CREATE FUNCTION synthetic_redemption_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='coupon.redeemed' AND EXISTS (
    SELECT 1 FROM synthetic_redemption_faults f WHERE f.session_id=NEW.payload->>'session_id' AND f.mode='commit'
  ) THEN RAISE EXCEPTION 'synthetic_redemption_commit_failure'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER synthetic_redemption_commit_fault AFTER INSERT ON outbox_messages
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_redemption_commit_fault();
