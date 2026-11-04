import test from "node:test";
import assert from "node:assert/strict";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { createShoppingRecommendationReader } from "./shopping-recommendation.handler.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { planStorefrontShopping } from "../ai/structured-shopping-planner.js";
import { createProductHandlers } from "./product.handlers.js";

const plan = (extra: Record<string, unknown> = {}) => shoppingSearchPlanSchema.parse({ version: 1, query: "*", ...extra });
const or = [[{ name: "cor", value: "azul", operator: "equals" }, { name: "cor", value: "verde", operator: "equals" }]];
function fixture() {
  const rows = [
    { id: "at-boundary", rating: 4, price: 10000, attributes: { cor: "azul", material: "algodão" } },
    { id: "above-rating", rating: 4.1, price: 9999, attributes: { cor: "verde", material: "algodão" } },
    { id: "wrong-color", rating: 5, price: 9999, attributes: { cor: "vermelho", material: "algodão" } },
    { id: "missing-material", rating: 5, price: 9999, attributes: { cor: "azul" } },
  ];
  const products = rows.map(row => ({ id: row.id, name: row.id, rating: row.rating, price: row.price, type: "physical",
    inStock: true, source: "local", variants: [{ id: "v:" + row.id, basePriceInCents: row.price, stockQuantity: 3,
      stockReserved: 0, attributes: row.attributes }] }));
  const queries: any[] = [];
  const read = createShoppingRecommendationReader({ merchantRepo: { getExistingRules: async () => ({ maxDiscountPercent: 0, minimumMarginPercent: 0 }) },
    prisma: { productPromotion: { findMany: async () => [] }, productPrice: { findMany: async (query: any) => {
      assert.equal(query.where.variant.product.merchantId, "shop");
      const p = products.find(p => p.variants[0]!.id === query.where.variantId.in[0])!;
      return [{ variantId: p.variants[0]!.id, basePriceInCents: p.price, costInCents: 1,
        variant: { productId: p.id, product: { categoryId: "category", metadata: {} } } }];
    } } }, cartRepo: new Proxy({}, { get() { assert.fail("read must not use cart repository"); } }),
  } as never, { merchantId: "shop", sessionId: "cart" }, async args => { queries.push(args); return { products, nextCursor: null }; });
  return { read: async (criteria: ReturnType<typeof plan>) => storefrontToolOutputSchemas.search_products.parse(await read({ criteria })), queries };
}

test("GRAPH-02 inclusive and strict price/rating boundaries return the exact canonical product set", async () => {
  const f = fixture();
  const criteria = plan({ maxPriceCents: 10000, minRating: 4, attributeAnyOf: or,
    attributes: [{ name: "material", value: "couro", operator: "not_equals", priority: "required" }] });
  assert.deepEqual((await f.read(criteria)).products.map(p => p.id), ["at-boundary", "above-rating"]);
  const strict = await f.read({ ...criteria, maxPriceExclusive: true, minRatingExclusive: true });
  assert.deepEqual(strict.products.map(p => [p.id, p.price, p.rating]), [["above-rating", 9999, 4.1]]);
  assert.deepEqual(strict.searchEvidence!.appliedPlan, { ...criteria, maxPriceExclusive: true, minRatingExclusive: true });
  assert.match(strict.searchEvidence!.message, /abaixo de/); assert.match(strict.searchEvidence!.message, /acima de 4 estrelas/);
  assert.match(strict.searchEvidence!.message, /azul ou cor: verde/);
  assert.deepEqual(f.queries[1].criteria.attributeAnyOf, or);
  assert.equal(f.queries[1].criteria.maxPriceCents, undefined);
  assert.equal(f.queries[1].criteria.maxPriceExclusive, undefined);
});

test("GRAPH-03 structured wire preserves OR and strict operators in both response modes without relaxed retries", async () => {
  for (const mode of ["json_object", "json_schema"] as const) {
    let calls = 0;
    const expected = plan({ query: "camiseta", maxPriceCents: 10000, minRating: 4, minRatingExclusive: true, attributeAnyOf: or });
    const result = await planStorefrontShopping({ chat: async () => { calls++; return { content: JSON.stringify({ schemaVersion: 1,
      plan: { minPriceCents: null, maxPriceCents: null, minRating: null, sortBy: null, delivery: null, ...expected } }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; } } as never,
      { userMessage: "Camiseta azul ou verde até 100 reais com nota acima de 4", history: [] }, { mode });
    assert.deepEqual(result.plan, expected); assert.equal(calls, 1);
  }
});

test("GRAPH-03 rejects missing strict bounds, impossible ranges, contradictory alternatives and unbounded expressions", () => {
  for (const extra of [{ maxPriceExclusive: true }, { minRatingExclusive: true },
    { minPriceCents: 100, maxPriceCents: 100, minPriceExclusive: true }, { attributeAnyOf: [[]] },
    { attributeAnyOf: Array(7).fill(or[0]) },
    { attributes: [{ name: "cor", value: "preto", operator: "equals", priority: "required" }], attributeAnyOf: or }])
    assert.equal(shoppingSearchPlanSchema.safeParse({ version: 1, query: "*", ...extra }).success, false);
});

test("GRAPH-03 product reader forwards every predicate without accepting a supplied merchant", async () => {
  let request: any;
  const reader = createProductHandlers({ productRepo: { search: async (args: any) => { request = args; return { products: [], total: 0 }; } },
    prisma: { checkoutSetting: { findUnique: async () => null } } } as never, { merchantId: "owned", sessionId: "cart" });
  const criteria = plan({ minRating: 4, minRatingExclusive: true, attributeAnyOf: or });
  await reader.searchProducts({ query: "*", criteria });
  assert.equal(request.merchantId, "owned"); assert.equal(request.minRatingExclusive, true);
  assert.deepEqual(request.attributeAnyOf, or);
});
