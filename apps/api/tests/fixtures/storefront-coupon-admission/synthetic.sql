-- Synthetic-only complement to the legacy checkout/payment and coupon fixture.
CREATE TABLE storefront_carts (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL,
 items JSONB NOT NULL DEFAULT '[]', coupon_code TEXT, discount DOUBLE PRECISION NOT NULL DEFAULT 0,
 free_shipping BOOLEAN NOT NULL DEFAULT FALSE, total DOUBLE PRECISION NOT NULL DEFAULT 0,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
 expires_at TIMESTAMP(3) NOT NULL, UNIQUE(merchant_id,session_id)
);
CREATE TABLE cross_store_line_items (id TEXT PRIMARY KEY, host_merchant_id TEXT NOT NULL, checkout_session_id TEXT NOT NULL);
-- Exact existing mapped DDL from widget-cross-sell-checkout/synthetic.sql.
-- Current payment admission locks this config even without a widget receipt.
-- Empty table: no delivery mode/tariff/eligibility is invented by the harness.
CREATE TABLE own_delivery_configs (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL UNIQUE REFERENCES merchants(id),
  enabled BOOLEAN NOT NULL DEFAULT false, mode TEXT NOT NULL DEFAULT 'flat', flat_price_cents INTEGER, free_above_cents INTEGER,
  neighborhoods JSONB, radius_zones JSONB, estimated_value INTEGER NOT NULL DEFAULT 60, estimated_unit TEXT NOT NULL DEFAULT 'minutes',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE FUNCTION synthetic_coupon_admission_settlement_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM synthetic_bound_faults WHERE kind='settlement') THEN RAISE EXCEPTION 'synthetic_settlement_rollback'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_coupon_admission_settlement_fault BEFORE INSERT ON payment_settlements
FOR EACH ROW EXECUTE FUNCTION synthetic_coupon_admission_settlement_fault();
-- Simulate a real conditional source CAS losing after reservation cancellation.
-- Returning NULL makes UPDATE count zero; the production command must abort TX.
CREATE FUNCTION synthetic_coupon_release_source_cas_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.coupon_code IS NULL AND OLD.coupon_code IS NOT NULL
  AND EXISTS(SELECT 1 FROM synthetic_bound_faults WHERE kind='source_cas') THEN RETURN NULL; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_coupon_release_source_cas_fault BEFORE UPDATE ON storefront_carts
FOR EACH ROW EXECUTE FUNCTION synthetic_coupon_release_source_cas_fault();
