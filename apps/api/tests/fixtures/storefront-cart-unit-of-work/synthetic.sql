-- SYNTHETIC integration fixture, NOT a migration or production evidence schema.
-- Cart column names/types mirror Prisma StorefrontCart; catalog projections below
-- contain only columns read by the actual local-cart-admission Prisma delegates.
-- Minimal read-only projection for cart-side binding discovery; NOT a checkout
-- schema/migration or authoritative binding issuer. Other harnesses may load
-- their fuller synthetic checkout table before this common cart fixture.
CREATE TABLE IF NOT EXISTS checkout_sessions (
  merchant_id TEXT NOT NULL, session_id TEXT NOT NULL, global_user_id TEXT NOT NULL,
  cart JSONB NOT NULL, UNIQUE (merchant_id, session_id)
);
CREATE TABLE storefront_carts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  coupon_code TEXT,
  discount DOUBLE PRECISION NOT NULL DEFAULT 0,
  free_shipping BOOLEAN NOT NULL DEFAULT FALSE,
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  UNIQUE (merchant_id, session_id)
);
CREATE TABLE products (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'physical', metadata JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, deleted_at TIMESTAMP(3)
);
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE product_stock (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0
);
INSERT INTO products (id,merchant_id) VALUES
  ('synthetic-product','synthetic-merchant'), ('foreign-product','foreign-merchant');
INSERT INTO product_variants (id,product_id) VALUES
  ('synthetic-variant','synthetic-product'), ('limited-variant','synthetic-product'),
  ('foreign-variant','foreign-product');
INSERT INTO product_stock (id,variant_id,quantity,reserved) VALUES
  ('synthetic-stock','synthetic-variant',1000,0),
  ('limited-stock','limited-variant',5,2), ('foreign-stock','foreign-variant',1000,0);

-- Identity extension: actual admission reads these synthetic canonical options
-- and shared physical stock. No delegate/stock/lock is stubbed or disabled.
INSERT INTO products(id,merchant_id,type,metadata) VALUES
  ('color-product','synthetic-merchant','physical',
   '{"optionGroups":[{"id":"color","name":"Color","selectionType":"single","required":false,"items":[{"id":"blue","name":"Azul","priceModifierInCents":0},{"id":"red","name":"Vermelho","priceModifierInCents":0}]}]}'::jsonb),
  ('identity-service-product','synthetic-merchant','service','{}'::jsonb);
INSERT INTO product_variants(id,product_id) VALUES
  ('color-variant','color-product'),('identity-service-variant','identity-service-product');
INSERT INTO product_stock(id,variant_id,quantity,reserved) VALUES ('color-stock','color-variant',5,0);

-- Witness only: no claim, receipt, cryptographic binding, fencing, immutable
-- ledger or terminal-state policy is implemented or proven by this table.
CREATE TABLE synthetic_cart_proof (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL,
  witness TEXT NOT NULL CHECK (witness='SYNTHETIC_TEST_ONLY')
);
CREATE SEQUENCE synthetic_cart_proof_attempts;
CREATE FUNCTION synthetic_cart_proof_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM nextval('synthetic_cart_proof_attempts');
  IF NEW.id='proof-error' THEN RAISE EXCEPTION 'synthetic_proof_rejection'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_cart_proof_insert BEFORE INSERT ON synthetic_cart_proof
FOR EACH ROW EXECUTE FUNCTION synthetic_cart_proof_insert();
CREATE FUNCTION synthetic_cart_proof_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id='commit-error' THEN RAISE EXCEPTION 'synthetic_commit_rejection'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER synthetic_cart_proof_commit AFTER INSERT ON synthetic_cart_proof
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_cart_proof_commit();
CREATE FUNCTION synthetic_cart_update_rejection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id='update-error' AND NEW.discount>0 THEN
    RAISE EXCEPTION 'synthetic_cart_update_rejection';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_cart_update_rejection BEFORE UPDATE ON storefront_carts
FOR EACH ROW EXECUTE FUNCTION synthetic_cart_update_rejection();
