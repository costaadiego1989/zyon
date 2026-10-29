CREATE UNIQUE INDEX completed_orders_id_merchant_id_key ON completed_orders(id, merchant_id);
CREATE TABLE strategy_order_cost_snapshots (
  order_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  definition TEXT NOT NULL CHECK (definition = 'catalog-cost-at-order-v1'),
  currency TEXT NOT NULL,
  line_costs JSONB NOT NULL CHECK (jsonb_typeof(line_costs) = 'array'),
  product_cost_cents BIGINT CHECK (product_cost_cents BETWEEN 0 AND 9007199254740991),
  issues TEXT[] NOT NULL,
  captured_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT strategy_order_cost_snapshots_order_id_merchant_id_fkey FOREIGN KEY (order_id, merchant_id)
    REFERENCES completed_orders(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT strategy_order_cost_snapshots_assignment_id_merchant_id_fkey FOREIGN KEY (assignment_id, merchant_id)
    REFERENCES strategy_assignments(id, merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX strategy_order_cost_snapshots_order_id_merchant_id_key ON strategy_order_cost_snapshots(order_id, merchant_id);
CREATE INDEX strategy_order_cost_snapshots_merchant_id_assignment_id_idx ON strategy_order_cost_snapshots(merchant_id, assignment_id);

CREATE FUNCTION protect_strategy_order_cost_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Insertions belong to the order trigger below. No application endpoint can
  -- submit a catalog cost, rewrite one, or relabel a historical order.
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'STRATEGY_ORDER_COST_SNAPSHOT_IMMUTABLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM completed_orders o JOIN strategy_assignments a
    ON a.merchant_id = o.merchant_id AND a.session_id = o.session_id
    WHERE o.id = NEW.order_id AND o.merchant_id = NEW.merchant_id AND a.id = NEW.assignment_id AND o.currency = NEW.currency)
  THEN RAISE EXCEPTION 'STRATEGY_ORDER_COST_SCOPE_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_order_cost_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON strategy_order_cost_snapshots
  FOR EACH ROW EXECUTE FUNCTION protect_strategy_order_cost_snapshot();

CREATE FUNCTION capture_strategy_order_catalog_cost() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment strategy_assignments; line_costs JSONB; product_cost NUMERIC; issues TEXT[];
BEGIN
  SELECT * INTO assignment FROM strategy_assignments WHERE merchant_id = NEW.merchant_id AND session_id = NEW.session_id;
  IF assignment.id IS NULL THEN RETURN NEW; END IF;

  -- One statement sees the order's frozen lines and tenant-owned catalog prices
  -- together. Buyer-supplied cart cost is never a cost source. Missing data is
  -- retained explicitly and never prevents recording an otherwise valid order.
  WITH lines AS (
    SELECT item, ordinal, CASE WHEN jsonb_typeof(item->'quantity') = 'number'
      AND item->>'quantity' ~ '^[1-9][0-9]{0,8}$' THEN (item->>'quantity')::NUMERIC END AS quantity
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.line_items_json) = 'array' THEN NEW.line_items_json ELSE '[]'::JSONB END)
      WITH ORDINALITY AS source(item, ordinal)
  ), priced AS (
    SELECT l.*, p.id AS price_id, p.updated_at AS price_updated_at, p.cost_in_cents, p.tax_percent,
      CASE WHEN quantity IS NULL OR jsonb_typeof(item->'variantId') IS DISTINCT FROM 'string' THEN 'order_line_invalid'
        WHEN p.id IS NULL THEN 'catalog_price_missing'
        WHEN p.currency <> NEW.currency THEN 'catalog_currency_mismatch'
        WHEN p.cost_in_cents IS NULL OR p.cost_in_cents < 0 THEN 'catalog_cost_missing'
        WHEN p.cost_in_cents * quantity > 9007199254740991 THEN 'line_product_cost_overflow'
        WHEN EXISTS (SELECT 1 FROM checkout_sessions s,
          jsonb_array_elements(CASE WHEN jsonb_typeof(s.cart->'items') = 'array' THEN s.cart->'items' ELSE '[]'::JSONB END) AS cart_line
          WHERE s.merchant_id = NEW.merchant_id AND s.session_id = NEW.session_id
            AND (cart_line->>'variantId' = item->>'variantId' OR cart_line->>'sku' = item->>'sku')
            AND jsonb_typeof(cart_line->'selected_options') = 'array' AND cart_line->'selected_options' <> '[]'::JSONB)
          THEN 'option_cost_unverified'
        ELSE NULL END AS issue
    FROM lines l
      LEFT JOIN product_variants v ON v.id = l.item->>'variantId'
      LEFT JOIN products product ON product.id = v.product_id AND product.merchant_id = NEW.merchant_id
      LEFT JOIN product_prices p ON p.variant_id = v.id AND product.id IS NOT NULL
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('variantId', item->>'variantId', 'quantity', quantity,
      'priceId', price_id, 'priceUpdatedAt', price_updated_at, 'configuredTaxPercent', tax_percent,
      'unitCostCents', CASE WHEN issue IS NULL THEN cost_in_cents ELSE NULL END,
      'costCents', CASE WHEN issue IS NULL THEN cost_in_cents * quantity ELSE NULL END, 'issue', issue) ORDER BY ordinal), '[]'::JSONB),
    sum(CASE WHEN issue IS NULL THEN cost_in_cents * quantity ELSE 0 END),
    COALESCE(array_agg(DISTINCT issue) FILTER (WHERE issue IS NOT NULL), ARRAY[]::TEXT[])
    INTO line_costs, product_cost, issues FROM priced;
  IF jsonb_array_length(line_costs) = 0 THEN issues := array_append(issues, 'order_items_missing'); END IF;
  IF product_cost > 9007199254740991 THEN issues := array_append(issues, 'product_cost_overflow'); END IF;
  INSERT INTO strategy_order_cost_snapshots(order_id, merchant_id, assignment_id, definition, currency, line_costs,
    product_cost_cents, issues, captured_at)
    VALUES (NEW.id, NEW.merchant_id, assignment.id, 'catalog-cost-at-order-v1', NEW.currency, line_costs,
      CASE WHEN cardinality(issues) = 0 THEN product_cost::BIGINT ELSE NULL END, issues, clock_timestamp());
  RETURN NEW;
END $$;
CREATE TRIGGER capture_strategy_order_catalog_cost AFTER INSERT ON completed_orders
  FOR EACH ROW EXECUTE FUNCTION capture_strategy_order_catalog_cost();

CREATE FUNCTION protect_strategy_order_cost_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM strategy_order_cost_snapshots WHERE order_id = OLD.id)
    AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.external_order_id IS DISTINCT FROM OLD.external_order_id
      OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.line_items_json IS DISTINCT FROM OLD.line_items_json)
  THEN RAISE EXCEPTION 'STRATEGY_ORDER_COST_CONTEXT_IMMUTABLE'; END IF;
  -- Refund/cancellation state, tracking and separately recorded corrections
  -- remain writable; they never rewrite the original merchandise cost.
  RETURN NEW;
END $$;
CREATE TRIGGER strategy_order_cost_context_guard BEFORE UPDATE ON completed_orders
  FOR EACH ROW EXECUTE FUNCTION protect_strategy_order_cost_context();
