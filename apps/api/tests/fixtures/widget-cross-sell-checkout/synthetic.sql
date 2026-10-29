-- Synthetic additions to legacy-prisma/checkout-payment.sql, NOT a migration.
CREATE TABLE checkout_settings (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL UNIQUE, advanced_rules JSONB);
CREATE TABLE product_prices (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL UNIQUE REFERENCES product_variants(id),
  base_price_in_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'BRL');
CREATE TABLE product_stock (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE product_media (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id), url TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0);
CREATE TABLE product_promotions (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, product_id TEXT, variant_id TEXT, category_id TEXT,
  coupon_id TEXT, discount_type TEXT, discount_value INTEGER, promo_price_in_cents INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true, starts_at TIMESTAMP(3) NOT NULL, ends_at TIMESTAMP(3) NOT NULL);
CREATE TABLE cross_sell_promotions (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT NOT NULL, trigger JSONB NOT NULL,
  recommended_skus TEXT[] NOT NULL, discount_percent DECIMAL(12,4) NOT NULL, max_discount_percent DECIMAL(12,4) NOT NULL,
  status TEXT NOT NULL, starts_at TIMESTAMP(3) NOT NULL, ends_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL);
CREATE TABLE cross_sell_suggestions (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL,
  promo_id TEXT NOT NULL REFERENCES cross_sell_promotions(id), ranked_items TEXT[] NOT NULL,
  agent_copy TEXT NOT NULL, computed_discount DECIMAL(12,4) NOT NULL, status TEXT NOT NULL,
  suggested_at TIMESTAMP(3) NOT NULL, resolved_at TIMESTAMP(3));
-- Presence-only safety reads. This harness does not issue/redeem incentives.
CREATE TABLE coupon_redemptions (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE strategy_incentive_reservations (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL);
-- Current manual delivery config for fenced accepted-checkout tariff quotations.
CREATE TABLE own_delivery_configs (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL UNIQUE REFERENCES merchants(id),
  enabled BOOLEAN NOT NULL DEFAULT false, mode TEXT NOT NULL DEFAULT 'flat', flat_price_cents INTEGER, free_above_cents INTEGER,
  neighborhoods JSONB, radius_zones JSONB, estimated_value INTEGER NOT NULL DEFAULT 60, estimated_unit TEXT NOT NULL DEFAULT 'minutes',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
