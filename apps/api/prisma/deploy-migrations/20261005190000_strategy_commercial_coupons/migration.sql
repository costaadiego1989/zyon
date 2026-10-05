-- A strategy coupon is a presentation record for one reviewed execution.
-- It cannot enter the ordinary coupon redemption path or be repurposed later.
ALTER TABLE coupons ADD COLUMN strategy_incentive_execution_id TEXT;
CREATE UNIQUE INDEX coupons_strategy_incentive_execution_id_key ON coupons(strategy_incentive_execution_id);
ALTER TABLE coupons ADD CONSTRAINT coupons_strategy_incentive_execution_id_merchant_id_fkey
  FOREIGN KEY(strategy_incentive_execution_id, merchant_id)
  REFERENCES strategy_incentive_executions(id, merchant_id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_strategy_incentive_coupon() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e strategy_incentive_executions; b strategy_incentive_budgets; t JSONB; expected_type TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.strategy_incentive_execution_id IS NOT NULL THEN RAISE EXCEPTION 'strategy coupon history is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.strategy_incentive_execution_id IS DISTINCT FROM NEW.strategy_incentive_execution_id
    THEN RAISE EXCEPTION 'strategy coupon binding is immutable'; END IF;
  IF NEW.strategy_incentive_execution_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO e FROM strategy_incentive_executions WHERE id=NEW.strategy_incentive_execution_id AND merchant_id=NEW.merchant_id;
  SELECT * INTO b FROM strategy_incentive_budgets WHERE id=e.budget_id AND merchant_id=NEW.merchant_id;
  t := e.recommendation->'test';
  expected_type := CASE t->>'kind' WHEN 'capped_percentage_discount' THEN 'percent'
    WHEN 'capped_fixed_discount' THEN 'fixed' WHEN 'capped_shipping_discount' THEN 'shipping_fixed' END;
  IF e.id IS NULL OR b.id IS NULL OR e.recommendation->>'definition' IS DISTINCT FROM 'weekly-incentive-recommendation-v3'
    OR t->'delivery'->>'mode' IS DISTINCT FROM 'coupon_code'
    OR NEW.code IS DISTINCT FROM t->'delivery'->>'code' OR NEW.code !~ '^ZYON[A-F0-9]{20}$'
    OR expected_type IS NULL OR NEW.discount_type IS DISTINCT FROM expected_type
    OR NEW.discount_value IS DISTINCT FROM (CASE WHEN expected_type='percent' THEN (t->>'discountPercent')::numeric
      ELSE (t->>'maxDiscountCents')::numeric / 100 END)
    OR NEW.min_cart_total IS DISTINCT FROM (t->'audience'->>'minCartTotalCents')::numeric / 100
    OR NEW.max_usages IS DISTINCT FROM b.max_redemptions OR NEW.max_per_buyer IS DISTINCT FROM 1
    OR NEW.min_per_buyer IS NOT NULL OR NEW.free_shipping_min_cart_total IS NOT NULL
    OR cardinality(NEW.allowed_skus)<>0 OR cardinality(NEW.blocked_skus)<>0
    OR cardinality(NEW.allowed_regions)<>0 OR cardinality(NEW.blocked_regions)<>0
    OR NEW.starts_at IS DISTINCT FROM e.started_at OR NEW.ends_at IS DISTINCT FROM e.ends_at
    OR NEW.usages_count IS DISTINCT FROM b.spent_count
    OR NEW.status NOT IN ('active','paused','expired','archived')
    OR (NEW.status='active' AND b.closed_at IS NOT NULL)
    OR (TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.status<>'active' AND NEW.status='active')))
  THEN RAISE EXCEPTION 'strategy coupon terms differ from approved execution'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_incentive_coupon_guard BEFORE INSERT OR UPDATE OR DELETE ON coupons
  FOR EACH ROW EXECUTE FUNCTION guard_strategy_incentive_coupon();

CREATE FUNCTION deny_ordinary_strategy_coupon_redemption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM coupons WHERE id=NEW.coupon_id AND strategy_incentive_execution_id IS NOT NULL)
    THEN RAISE EXCEPTION 'strategy coupon requires incentive assignment and budget'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_coupon_redemption_guard BEFORE INSERT OR UPDATE ON coupon_redemptions
  FOR EACH ROW EXECUTE FUNCTION deny_ordinary_strategy_coupon_redemption();

CREATE FUNCTION sync_strategy_incentive_coupon() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE coupons c SET usages_count=NEW.spent_count,
    status=CASE WHEN NEW.closed_at IS NOT NULL OR NEW.ends_at <= (clock_timestamp() AT TIME ZONE 'UTC') THEN 'expired' ELSE c.status END,
    updated_at=(clock_timestamp() AT TIME ZONE 'UTC')
  FROM strategy_incentive_executions e
  WHERE e.budget_id=NEW.id AND e.merchant_id=NEW.merchant_id AND c.strategy_incentive_execution_id=e.id
    AND c.merchant_id=NEW.merchant_id;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_coupon_budget_sync AFTER UPDATE OF spent_count, closed_at ON strategy_incentive_budgets
  FOR EACH ROW EXECUTE FUNCTION sync_strategy_incentive_coupon();
