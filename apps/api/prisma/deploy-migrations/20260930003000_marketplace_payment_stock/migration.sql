-- Existing reservations remain unbound; historical charges require reconciliation.
ALTER TABLE stock_reservations ADD COLUMN IF NOT EXISTS marketplace_funding_plan_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_marketplace_funding_plan_id_fkey'
    AND conrelid = 'stock_reservations'::regclass) THEN
    ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_marketplace_funding_plan_id_fkey
      FOREIGN KEY (marketplace_funding_plan_id) REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS stock_reservations_marketplace_funding_plan_id_idx ON stock_reservations(marketplace_funding_plan_id);

CREATE OR REPLACE FUNCTION enforce_marketplace_stock_binding() RETURNS trigger AS $$ BEGIN
  IF OLD.marketplace_funding_plan_id IS NOT NULL AND (
    NEW.marketplace_funding_plan_id IS DISTINCT FROM OLD.marketplace_funding_plan_id OR
    NEW.variant_id IS DISTINCT FROM OLD.variant_id OR NEW.stock_id IS DISTINCT FROM OLD.stock_id OR
    NEW.cart_id IS DISTINCT FROM OLD.cart_id OR NEW.quantity IS DISTINCT FROM OLD.quantity
  ) THEN RAISE EXCEPTION 'marketplace_stock_binding_immutable'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS marketplace_stock_binding_immutable ON stock_reservations;
CREATE TRIGGER marketplace_stock_binding_immutable BEFORE UPDATE ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_marketplace_stock_binding();
