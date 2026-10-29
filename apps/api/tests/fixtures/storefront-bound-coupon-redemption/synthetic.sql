-- SYNTHETIC layer over legacy-prisma/checkout-payment.sql, NOT a migration.
-- No storefront_carts table on purpose: exact redemption may not reconstruct
-- authority from today's cart. Upstream issuer/order/payment rows are fixtures.
CREATE TABLE coupons (
  id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,code TEXT NOT NULL,discount_type TEXT NOT NULL,
  discount_value DECIMAL(12,4) NOT NULL,min_cart_total DECIMAL(12,4),free_shipping_min_cart_total DECIMAL(12,4),
  max_usages INTEGER,min_per_buyer INTEGER,max_per_buyer INTEGER,usages_count INTEGER NOT NULL DEFAULT 0,
  allowed_skus TEXT[] DEFAULT ARRAY[]::TEXT[],blocked_skus TEXT[] DEFAULT ARRAY[]::TEXT[],
  allowed_regions TEXT[] DEFAULT ARRAY[]::TEXT[],blocked_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  strategy_incentive_execution_id TEXT,status TEXT NOT NULL DEFAULT 'active',starts_at TIMESTAMP(3) NOT NULL,ends_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL,UNIQUE(merchant_id,code)
);
CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY,coupon_id TEXT NOT NULL REFERENCES coupons(id),merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,buyer_global_user_id TEXT,discount_applied DECIMAL(12,4) NOT NULL,
  source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'applied',order_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE(merchant_id,session_id,coupon_id)
);
CREATE TABLE synthetic_bound_faults (kind TEXT PRIMARY KEY);
CREATE FUNCTION synthetic_bound_usage_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM synthetic_bound_faults WHERE kind='usage') THEN RAISE EXCEPTION 'synthetic_bound_usage'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_bound_usage_fault BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION synthetic_bound_usage_fault();
CREATE FUNCTION synthetic_bound_binding_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM synthetic_bound_faults WHERE kind='binding') THEN RAISE EXCEPTION 'synthetic_bound_binding'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_bound_binding_fault BEFORE UPDATE ON checkout_sessions FOR EACH ROW EXECUTE FUNCTION synthetic_bound_binding_fault();
CREATE FUNCTION synthetic_bound_outbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF (NEW.event_type='coupon.redeemed' AND EXISTS(SELECT 1 FROM synthetic_bound_faults WHERE kind='outbox'))
  OR (NEW.event_type='order.completed' AND EXISTS(SELECT 1 FROM synthetic_bound_faults WHERE kind='publication'))
  THEN RAISE EXCEPTION 'synthetic_bound_outbox'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_bound_outbox_fault BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_bound_outbox_fault();
CREATE FUNCTION synthetic_bound_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM synthetic_bound_faults WHERE kind='commit') THEN RAISE EXCEPTION 'synthetic_bound_commit'; END IF; RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER synthetic_bound_commit_fault AFTER UPDATE ON checkout_sessions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION synthetic_bound_commit_fault();
