-- Synthetic layer over cart-UoW and authority-reader fixtures. Not a migration.
CREATE TABLE cross_sell_promotions (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger JSONB NOT NULL,
  recommended_skus TEXT[] DEFAULT ARRAY[]::TEXT[],
  discount_percent DECIMAL(12,4) NOT NULL,
  max_discount_percent DECIMAL(12,4) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TIMESTAMP(3) NOT NULL,
  ends_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX cross_sell_promotions_merchant_id_status_idx ON cross_sell_promotions (merchant_id, status);

-- Counts committed commercial cart changes, NOT requests/claims/receipts or
-- exactly-once financial effects. Rolled-back witness inserts roll back too.
CREATE TABLE synthetic_cross_sell_changes (cart_id TEXT NOT NULL);
CREATE FUNCTION synthetic_cross_sell_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.items IS DISTINCT FROM NEW.items OR OLD.total IS DISTINCT FROM NEW.total
    OR OLD.discount IS DISTINCT FROM NEW.discount OR OLD.coupon_code IS DISTINCT FROM NEW.coupon_code
    OR OLD.free_shipping IS DISTINCT FROM NEW.free_shipping THEN
    INSERT INTO synthetic_cross_sell_changes VALUES (NEW.session_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER synthetic_cross_sell_changed AFTER UPDATE ON storefront_carts
FOR EACH ROW EXECUTE FUNCTION synthetic_cross_sell_changed();
