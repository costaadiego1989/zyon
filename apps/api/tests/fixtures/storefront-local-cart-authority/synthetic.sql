-- SYNTHETIC native-reader fixture layered after stages29/31/32, never a migration.
-- Real mapped column types, only the Prisma projections used by this candidate.
ALTER TABLE products ADD COLUMN name TEXT NOT NULL DEFAULT 'Synthetic catalog name';
ALTER TABLE products ADD COLUMN category_id TEXT;
UPDATE products SET category_id='synthetic-category' WHERE id='synthetic-product';
ALTER TABLE product_variants ADD COLUMN sku TEXT;
UPDATE product_variants SET sku=CASE WHEN id IN ('synthetic-variant','foreign-variant') THEN 'synthetic-sku' ELSE id END;
ALTER TABLE product_variants ALTER COLUMN sku SET NOT NULL;
CREATE TABLE product_prices (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL UNIQUE REFERENCES product_variants(id),
  base_price_in_cents INTEGER NOT NULL, cost_in_cents INTEGER,
  tax_percent DOUBLE PRECISION NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO product_prices (id,variant_id,base_price_in_cents,cost_in_cents) VALUES
  ('synthetic-price','synthetic-variant',10000,2000),
  ('limited-price','limited-variant',10000,2000), ('foreign-price','foreign-variant',1,0);
INSERT INTO products(id,merchant_id,name,type,category_id)
  VALUES ('other-product','synthetic-merchant','Synthetic other product','physical','other-current-category');
INSERT INTO product_variants(id,product_id,sku) VALUES ('other-variant','other-product','other-current-sku');
INSERT INTO product_stock(id,variant_id,quantity) VALUES ('other-stock','other-variant',100);
INSERT INTO product_prices(id,variant_id,base_price_in_cents,cost_in_cents) VALUES ('other-price','other-variant',5000,1000);

CREATE TABLE merchant_rules (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL UNIQUE,
  max_discount_percent NUMERIC(12,4) NOT NULL, minimum_margin_percent NUMERIC(12,4) NOT NULL,
  allow_free_shipping BOOLEAN NOT NULL, allow_shipping_discount BOOLEAN NOT NULL,
  allow_bonus_item BOOLEAN NOT NULL, allow_stack_discount_and_free_shipping BOOLEAN NOT NULL,
  coupon_box_enabled BOOLEAN NOT NULL, autonomous_engine_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  free_shipping_min_cart_value NUMERIC(12,4) NOT NULL, max_shipping_subsidy NUMERIC(12,4) NOT NULL,
  max_partial_shipping_discount NUMERIC(12,4) NOT NULL, offer_expiration_minutes INTEGER NOT NULL,
  blocked_regions TEXT[] NOT NULL, brand_voice TEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO merchant_rules VALUES ('synthetic-policy','synthetic-merchant',10,38,TRUE,TRUE,FALSE,FALSE,TRUE,TRUE,
  250,45,20,15,ARRAY[]::TEXT[],'consultative',CURRENT_TIMESTAMP);
CREATE TABLE checkout_settings (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL UNIQUE,
  advanced_rules JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO checkout_settings VALUES ('synthetic-settings','synthetic-merchant','[]');
CREATE TABLE product_promotions (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL,
  product_id TEXT, variant_id TEXT, category_id TEXT, coupon_id TEXT,
  discount_type TEXT, discount_value INTEGER, promo_price_in_cents INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, starts_at TIMESTAMP(3) NOT NULL, ends_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
