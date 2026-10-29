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
  return { read: (criteria: ReturnType<typeof plan>, limit?: number) => reader({ criteria, limit }), queries, reads,
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
