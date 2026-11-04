import test from "node:test";
import assert from "node:assert/strict";
import { GraphCatalogSearch } from "./graph-catalog-search.js";
import { catalogProjectionHash } from "../../graph-rag/application/graph-projection.service.js";
import { matchesCatalogVariant } from "../domain/services/catalog-search-criteria.js";

const source = { kind: "catalog", merchantId: "shop-a", id: "p1", version: 123, active: true, name: "Creme reparador",
  variants: [{ id: "v1", sku: "sku1", active: true, attributes: { fragrancia: "nao" } }] } as const;
const hit = { merchantId: "shop-a", productId: "p1", variantId: "v1", sourceVersion: 123, sourceHash: catalogProjectionHash(source),
  modelId: "model", projectedAt: 123, vectorScore: 0.9, score: 0.9 };
const input = { merchantId: "shop-a", query: "barreira da pele", queryMode: "contextual", inStockOnly: true, allowSemantic: true,
  minPriceCents: 2000, maxPriceCents: 10000, minRating: 4, currency: "BRL", categoryId: "skin",
  attributes: [{ name: "fragrancia", value: "sim", operator: "not_equals" }] } as const;
const empty = { products: [], total: 0 };

test("GRAPH-03 semantic candidates retain OR groups and strict canonical limits", async () => {
  const attributeAnyOf = [[{ name: "fragrancia", value: "nao", operator: "equals" as const }]];
  const request = { ...input, attributeAnyOf, minRatingExclusive: true, maxPriceExclusive: true } as any;
  let graphRead: any, canonicalReads = 0;
  const graph = new GraphCatalogSearch({ enabledFor: () => true, searchCatalog: async value => {
    graphRead = value; return { status: "ready", hits: [hit], partial: true };
  } } as any, { read: async () => source } as any);
  await graph.search(request, async value => {
    canonicalReads++;
    assert.deepEqual(value.attributeAnyOf, attributeAnyOf);
    assert.equal(value.minRatingExclusive, true); assert.equal(value.maxPriceExclusive, true);
    return empty;
  });
  assert.deepEqual(graphRead.attributeAnyOf, attributeAnyOf); assert.equal(canonicalReads, 2);
});
function reader(current: unknown = source, candidates: unknown[] = [hit]) {
  return new GraphCatalogSearch({ enabledFor: () => true,
    searchCatalog: async args => { assert.equal(args.merchantId, "shop-a");return { status: "ready", hits: candidates, partial: true }; } } as any,
  { read: async () => current } as any);
}
test("RAG05 canonical same variant", async () => {
  const requests: any[] = [];
  const result = await reader().search(input as any, async request => {
    requests.push(request);
    if (!request.candidateVariantIds) return empty;
    assert.deepEqual(request.candidateVariantIds, ["v1"]);
    for (const key of ["merchantId", "minPriceCents", "maxPriceCents", "minRating", "attributes", "categoryId", "currency", "inStockOnly"])
      assert.deepEqual(request[key], input[key]);
    assert.equal(request.query, undefined);
    const variant = { id: "v1", isActive: true, currency: "BRL", basePriceInCents: 3000, stockQuantity: 2, stockReserved: 0,
      attributes: { fragrancia: "nao" } } as any;
    assert.equal(matchesCatalogVariant(variant, request, "physical"), true);
    for (const changed of [{ id: "v2" }, { basePriceInCents: 10001 }, { stockQuantity: 0 }, { attributes: {} }, { isActive: false }])
      assert.equal(matchesCatalogVariant({ ...variant, ...changed }, request, "physical"), false);
    return { products: [{ id: "p1" } as any], total: 1 };
  });
  assert.equal(requests.length, 2);assert.equal(result.products[0]?.id, "p1");
});
test("RAG05 related partial evidence", async () => {
  const result = await reader().search(input as any, async request => request.candidateVariantIds
    ? { products: [{ id: "p1" } as any], total: 1, nextCursor: "not-global" } : empty);
  assert.deepEqual(result.retrieval, { engine: "neo4j", match: "semantic", partial: true });
  assert.equal(result.nextCursor, undefined);
});
test("stale, foreign, removed and changed product evidence never broadens canonical reads", async () => {
  for (const changed of [null, { ...source, merchantId: "shop-b" }, { ...source, active: false },
    { ...source, name: "Outro produto" }, { ...source, version: 124 }, { ...source, variants: [] }]) {
    let reads = 0;
    assert.deepEqual(await reader(changed).search(input as any, async () => { reads++;return empty; }), empty);
    assert.equal(reads, 1);
  }
  let reads = 0;
  assert.deepEqual(await reader(source, [{ ...hit, merchantId: "shop-b" }]).search(input as any, async () => { reads++;return empty; }), empty);
  assert.equal(reads, 1);
});
test("exact hits, cursors, disabled hints and lookup-only paths do not invoke semantic retrieval", async () => {
  const search = new GraphCatalogSearch({ enabledFor: () => { throw Error("should not reach graph"); } } as any, {} as any);
  for (const request of [{ ...input, allowSemantic: false }, { ...input, cursor: "p1" }, { ...input, inStockOnly: false }])
    assert.deepEqual(await search.search(request as any, async () => empty), empty);
  const exact = { products: [{ id: "p2" } as any], total: 1 };
  assert.equal(await search.search(input as any, async () => exact), exact);
});
