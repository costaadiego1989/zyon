-- Explicit legacy-basis-only fixture. Owned disposable database, NOT migration.
-- Products/variants are the real mapped projections from legacy checkout SQL.
-- No fake catalog/price delegate, new runtime table, provider or production data.
CREATE TABLE product_prices (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL UNIQUE REFERENCES product_variants(id),
  base_price_in_cents INTEGER NOT NULL, cost_in_cents INTEGER,
  tax_percent DOUBLE PRECISION NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
