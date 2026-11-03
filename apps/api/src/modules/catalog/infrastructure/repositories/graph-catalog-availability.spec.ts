import test from "node:test";
import assert from "node:assert/strict";
import { searchAvailableCatalog } from "./catalog-availability-search.js";

test("semantic identity restriction is compiled inside the same SQL variant predicate as price stock and attributes", async () => {
  const queries: any[] = [];
  await searchAvailableCatalog({ $transaction: async work => work({
    product: { findMany: async () => [] },
    $queryRaw: async query => { queries.push(query);return queries.length === 1 ? [] : [{ total: 0n }]; },
  }) } as any, { merchantId: "shop-a", candidateVariantIds: ["candidate-variant"], inStockOnly: true,
    currency: "BRL", minPriceCents: 2000, maxPriceCents: 10000, minRating: 4,
    attributes: [{ name: "material", value: "couro", operator: "not_equals" }] });
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /v\.product_id = p\.id AND v\.is_active AND v\.id = ANY\(/);
    assert.match(query.sql, /s\.variant_id = v\.id/);
    assert.match(query.sql, /pr\.variant_id = v\.id/);
    assert.match(query.sql, /jsonb_each_text\(CASE WHEN jsonb_typeof\(v\.attributes\)/);
    assert.ok(query.values.some(value => Array.isArray(value) && value[0] === "candidate-variant"));
    for (const value of ["shop-a", "BRL", 2000, 10000, 4, "material", "couro"]) assert.ok(query.values.includes(value));
  }
});
