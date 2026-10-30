import test from "node:test";
import assert from "node:assert/strict";
import { createShoppingRecommendationReader } from "./shopping-recommendation.handler.js";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";

const merchantId = "merchant", ctx = { merchantId, sessionId: "owned" };
const variant = (id: string, basePriceInCents: number, extra: Record<string, unknown> = {}) => ({ id, sku: id,
  basePriceInCents, stockQuantity: 5, stockReserved: 0, attributes: {}, ...extra });
const product = (id: string, variants: ReturnType<typeof variant>[]) => ({ id, name: id, type: "physical" as const,
  inStock: true, price: variants[0]!.basePriceInCents, variants, source: "local" as const });
const promotion = (productId: string, discountValue = 10, extra: Record<string, unknown> = {}) => ({ id: `promo:${productId}`,
  merchantId, productId, isActive: true, discountType: "percent", discountValue, startsAt: new Date(0),
  endsAt: new Date("2099-01-01"), ...extra });
const plan = (extra: Record<string, unknown> = {}) => shoppingSearchPlanSchema.parse({ version: 1, query: "organizador", ...extra });

function fixture(products: ReturnType<typeof product>[], promotions = [promotion("completo")], options: any = {}) {
  const queries: any[] = [], reads: any[] = [];
  let writes = 0;
  const reader = createShoppingRecommendationReader({
    merchantRepo: { getExistingRules: async () => options.rules === undefined
      ? { maxDiscountPercent: 10, minimumMarginPercent: 0, allowFreeShipping: false } : options.rules },
    prisma: {
      productPromotion: { findMany: async (query: any) => { assert.equal(query.where.merchantId, merchantId); return promotions; } },
      productPrice: { findMany: async (query: any) => {
        reads.push(query); assert.equal(query.where.variant.product.merchantId, merchantId);
        const id = query.where.variantId.in[0];
        const p = products.find(p => p.variants.some(v => v.id === id))!;
        const v = p.variants.find(v => v.id === id)!;
        return options.missingPrice ? [] : [{ variantId: id, basePriceInCents: options.stale ? v.basePriceInCents + 1 : v.basePriceInCents,
          costInCents: 100, variant: { productId: options.foreign ? "foreign" : p.id,
            product: { categoryId: "category", metadata: {} } } }];
      } },
    },
    cartRepo: new Proxy({}, { get: () => () => { writes++; throw Error("no_writes"); } }),
  } as never, ctx, async args => { queries.push(structuredClone(args));
    return options.page ? options.page(args, queries.length) : { products, nextCursor: null, query: args.query };
  });
  return { read: (criteria: ReturnType<typeof plan>, limit?: number, scope?: { categoryId?: string; cursor?: string }) => reader({ criteria, limit, ...scope }), queries, reads,
    writes: () => writes };
}

test("R$70 admits the real R$60 item and rejects the canonical R$90 offer, without a cart or stock write", async () => {
  const products = [product("essencial", [variant("v60", 6000)]), product("completo", [variant("v100", 10000)])];
  const before = structuredClone(products), context = fixture(products);
  const result = storefrontToolOutputSchemas.search_products.parse(await context.read(plan({ maxPriceCents: 7000 })));
  assert.deepEqual(result.products.map(p => [p.id, p.price]), [["essencial", 6000]]);
  assert.match(result.searchEvidence!.message, /70,00/);
  assert.equal(context.queries[0].criteria.maxPriceCents, undefined);
  assert.equal(context.writes(), 0); assert.deepEqual(products, before);
});

test("a corrected R$95 ceiling includes the authoritative offer of R$90 despite its R$100 base", async () => {
  const context = fixture([product("completo", [variant("v100", 10000)]), product("sem-oferta", [variant("v95", 9500)])]);
  const result = storefrontToolOutputSchemas.search_products.parse(await context.read(plan({ minPriceCents: 9000, maxPriceCents: 9500, sortBy: "price_asc" })));
  assert.deepEqual(result.products.map(p => [p.id, p.price]), [["completo", 9000], ["sem-oferta", 9500]]);
  assert.equal(result.products[0]!.variants![0]!.basePriceInCents, 10000);
  assert.equal(result.products[0]!.variants![0]!.price, 9000);
});

test("price, stock and attributes must hold on the same canonical variant", async () => {
  const filtered = product("completo", [variant("red-expensive", 12000, { attributes: { cor: "vermelho" } })]);
  const context = fixture([filtered], [promotion("completo")]);
  const criteria = plan({ maxPriceCents: 9500, attributes: [{ name: "cor", value: "vermelho", operator: "equals", priority: "required" }] });
  const result = storefrontToolOutputSchemas.search_products.parse(await context.read(criteria));
  assert.deepEqual(result.products, []);
  assert.deepEqual(context.queries[0].criteria.attributes, criteria.attributes);
});

test("two eligible variants present the cheaper authorized variant first and retain the original catalog basis", async () => {
  const context = fixture([product("completo", [variant("v80", 8000), variant("v75", 7500)])]);
  const result = storefrontToolOutputSchemas.search_products.parse(await context.read(plan({ maxPriceCents: 8000 })));
  assert.equal(result.products[0]!.price, 6750);
  assert.deepEqual(result.products[0]!.variants!.map(v => [v.id, v.price, v.basePriceInCents]), [["v75", 6750, 7500], ["v80", 7200, 8000]]);
});

for (const [name, row] of [
  ["expired", promotion("completo", 90, { endsAt: new Date(1) })],
  ["inactive", promotion("completo", 90, { isActive: false })],
  ["foreign", promotion("completo", 90, { merchantId: "other" })],
  ["coupon badge", promotion("completo", 0, { couponId: "code", discountType: null, discountValue: null })],
] as const) test(`${name} cannot turn a R$100 item into an eligible R$95 result`, async () => {
  const result = storefrontToolOutputSchemas.search_products.parse(await fixture([product("completo", [variant("v100", 10000)])], [row]).read(plan({ maxPriceCents: 9500 })));
  assert.deepEqual(result.products, []);
});

test("a desired discount cannot exceed the shared canonical commercial ceiling", async () => {
  const context = fixture([product("completo", [variant("v100", 10000)])], [promotion("completo", 50)]);
  const result = storefrontToolOutputSchemas.search_products.parse(await context.read(plan({ maxPriceCents: 9500 })));
  assert.equal(result.products[0]!.price, 9000); assert.equal(result.products[0]!.discountPercent, 10);
});

for (const options of [{ rules: null }, { missingPrice: true }, { stale: true }, { foreign: true }])
  test(`unknown price authority refuses the read: ${JSON.stringify(options)}`, async () => {
    const context = fixture([product("completo", [variant("v100", 10000)])], undefined, options);
    await assert.rejects(context.read(plan({ maxPriceCents: 9500 })));
    assert.equal(context.writes(), 0);
  });

test("delivery and unsupported criteria do not execute relaxed pricing or catalog searches", async () => {
  for (const criteria of [plan({ delivery: { freeOnly: true } }), plan({ unsupportedCriteria: ["prazo garantido"] })]) {
    const context = fixture([]);
    const result = storefrontToolOutputSchemas.search_products.parse(await context.read(criteria));
    assert.equal(context.queries.length, 0); assert.equal(context.reads.length, 0);
    assert.notEqual(result.searchEvidence!.status, "verified");
  }
});

test("bounded scans follow empty pages without losing the budget and disclose incomplete selection", async () => {
  const products = [product("essencial", [variant("v60", 6000)])];
  const context = fixture(products, [], { page: (_args: unknown, index: number) => ({ products: index === 2 ? products : [], nextCursor: `cursor:${index}` }) });
  const result = storefrontToolOutputSchemas.search_products.parse(await context.read(plan({ maxPriceCents: 7000 })));
  assert.equal(context.queries.length, 3); assert.equal(result.products[0]!.price, 6000);
  assert.match(result.searchEvidence!.message, /não uma listagem completa/);
  assert.equal(result.nextCursor, null);
});

test("discountOnly is a supported capability: only the authorized automatic R$100 to R$90 variant is eligible", async () => {
  const f = fixture([product("essencial", [variant("v60", 6000)]), product("completo", [variant("v100", 10000)])]);
  const criteria = plan({ query: "*", discountOnly: true });
  const result = storefrontToolOutputSchemas.search_products.parse(await f.read(criteria));
  assert.deepEqual(result.products.map(p => [p.id, p.price, p.originalPrice, p.discountPercent]), [["completo", 9000, 10000, 10]]);
  assert.deepEqual(result.products[0]!.variants!.map(v => [v.id, v.basePriceInCents, v.price]), [["v100", 10000, 9000]]);
  assert.equal(result.searchEvidence!.appliedPlan.discountOnly, true);
  assert.match(result.searchEvidence!.message, /promo|desconto/i);
  assert.equal(f.queries[0].criteria.discountOnly, undefined); assert.equal(f.writes(), 0);
});

test("discountOnly preserves the R$70 cap instead of advertising the R$90 offer", async () => {
  const f = fixture([product("essencial", [variant("v60", 6000)]), product("completo", [variant("v100", 10000)])]);
  const out = storefrontToolOutputSchemas.search_products.parse(await f.read(plan({ maxPriceCents: 7000, discountOnly: true })));
  assert.deepEqual(out.products, []); assert.equal(f.writes(), 0);
});

for (const [label, promotions, rules] of [
  ["no active promotion despite internal discount capacity", [], undefined],
  ["inactive", [promotion("completo", 10, { isActive: false })], undefined],
  ["expired", [promotion("completo", 10, { endsAt: new Date(1) })], undefined],
  ["future", [promotion("completo", 10, { startsAt: new Date("2098-01-01") })], undefined],
  ["foreign", [promotion("completo", 10, { merchantId: "foreign" })], undefined],
  ["coupon only", [promotion("completo", 0, { couponId: "coupon", discountType: null, discountValue: null })], undefined],
  ["zero authority", [promotion("completo")], { maxDiscountPercent: 0, minimumMarginPercent: 0 }],
] as const) test(`discountOnly excludes ${label}`, async () => {
  const f = fixture([product("completo", [variant("v100", 10000)])], promotions as any, { rules });
  const out = storefrontToolOutputSchemas.search_products.parse(await f.read(plan({ discountOnly: true })));
  assert.deepEqual(out.products, []); assert.equal(f.writes(), 0);
});

test("discountOnly is checked on the same in-stock variant as required attributes, rating and canonical price", async () => {
  const row = { ...product("completo", [variant("wrong-color", 10000, { attributes: { cor: "preto", material: "couro" } }),
    variant("blue-stockless", 10000, { attributes: { cor: "azul", material: "poliéster" }, stockReserved: 5 })]), rating: 4.5 };
  const f = fixture([row]); const out = storefrontToolOutputSchemas.search_products.parse(await f.read(plan({ discountOnly: true,
    minRating: 4, maxPriceCents: 9500, attributes: [
      { name: "cor", value: "azul", operator: "equals", priority: "required" },
      { name: "material", value: "couro", operator: "not_equals", priority: "preferred" }] })));
  assert.deepEqual(out.products, []); assert.equal(f.writes(), 0);
});

test("false means no discount filter, with no inverse interpretation", async () => {
  const f = fixture([product("essencial", [variant("v60", 6000)]), product("completo", [variant("v100", 10000)])]);
  const out = storefrontToolOutputSchemas.search_products.parse(await f.read(plan({ discountOnly: false })));
  assert.deepEqual(out.products.map(p => p.id), ["essencial", "completo"]);
});

test("discountOnly cannot claim absence when current eligible pricing is unknown", async () => {
  const f = fixture([product("completo", [variant("v100", 10000)])], undefined, { missingPrice: true });
  await assert.rejects(f.read(plan({ discountOnly: true }))); assert.equal(f.writes(), 0);
  const missingBase = fixture([{ ...product("completo", [variant("v100", 10000, { basePriceInCents: undefined })]), price: 10000 }]);
  await assert.rejects(missingBase.read(plan({ discountOnly: true }))); assert.equal(missingBase.writes(), 0);
});

test("canonical category/cursor scope survives the projection and incomplete prefix never triggers family recovery", async () => {
  const rows = [product("completo", [variant("v100", 10000)])]; const f = fixture(rows);
  const out = storefrontToolOutputSchemas.search_products.parse(await f.read(plan({ discountOnly: true }), 3, { categoryId: "category" }));
  assert.equal(f.queries[0].categoryId, "category"); assert.equal(out.categoryId, "category"); assert.equal(out.products[0]!.price, 9000);
  const wrongCategory = fixture(rows);
  assert.deepEqual((await wrongCategory.read(plan({ discountOnly: true }), 3, { categoryId: "different" }) as any).products, []);
  const paged = fixture(rows, undefined, { page: () => ({ products: [], nextCursor: null }) });
  const result = storefrontToolOutputSchemas.search_products.parse(await paged.read(plan({ query: "organizador viajante", discountOnly: true,
    recovery: { familyQuery: "organizador", optionalQueryTerms: ["viajante"] } }), 3, { cursor: "page-2" }));
  assert.equal(paged.queries.length, 1); assert.equal(paged.queries[0].cursor, "page-2");
  assert.equal(result.searchEvidence!.matchType, "incomplete"); assert.doesNotMatch(result.searchEvidence!.message, /não encontrei/i);
});

test("new canonical category/cursor hints are runtime validated before a catalog read", async () => {
  for (const scope of [{ categoryId: "" }, { categoryId: "x".repeat(192) }, { cursor: 12 }, { cursor: "x".repeat(2049) }]) {
    const f = fixture([]); await assert.rejects(f.read(plan({ discountOnly: true }), 3, scope as never)); assert.equal(f.queries.length, 0);
  }
});
