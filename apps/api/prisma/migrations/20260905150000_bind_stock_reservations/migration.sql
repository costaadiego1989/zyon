-- Deploy this additive migration after the active schema baseline. Drain old
-- reservation writers before rollout: old code does not populate stock_id.
ALTER TABLE "stock_reservations" ADD COLUMN "stock_id" TEXT;

-- Historical reservations did not record the warehouse. Only a variant with
-- exactly one stock row can be backfilled without inventing that attribution.
UPDATE "stock_reservations" r
SET "stock_id" = s.id
FROM (
  SELECT "variant_id", MIN("id") AS id
  FROM "product_stock"
  GROUP BY "variant_id"
  HAVING COUNT(*) = 1
) s
WHERE r."variant_id" = s."variant_id";

CREATE INDEX "stock_reservations_stock_id_idx" ON "stock_reservations"("stock_id");
ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_stock_id_fkey"
  FOREIGN KEY ("stock_id") REFERENCES "product_stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Release gate: reconcile ACTIVE rows whose stock_id remains NULL, including
-- quantity/reserved balances. Application deliberately refuses confirmation or
-- automatic expiry for those rows. Do not assign an arbitrary warehouse.
