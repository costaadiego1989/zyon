import test from "node:test";
import assert from "node:assert/strict";
import { createProductHandlers, type ProductHandlerDeps } from "./product.handlers.js";

const merchantId = "merchant";
const variantId = "variant";
const productId = "product";
const policy = { maxDiscountPercent: 20, minimumMarginPercent: 0, allowFreeShipping: false };
const promo = (overrides: Record<string, unknown> = {}) => ({
  id: "promotion", merchantId, productId, variantId: null, categoryId: null, couponId: null,
  discountType: "percent", discountValue: 50, promoPriceInCents: null, isActive: true,
  startsAt: new Date(0), endsAt: new Date("2099-01-01"), createdAt: new Date(0), updatedAt: new Date(0), ...overrides,
});

function fixture(options: { rules?: unknown; base?: number; priceBase?: number; cost?: number | null;
  rows?: ReturnType<typeof promo>[]; priceProductId?: string; priceFailure?: boolean;
  existingRules?: unknown; existingRulesFailure?: boolean } = {}) {
  const base = options.base ?? 10000;
  const product = { id: productId, merchantId, categoryId: "category", name: "Actual product", isActive: true,
    type: "physical", hasStock: true,
    defaultVariant: { id: variantId, sku: "sku", basePriceInCents: base },
    variants: [{ id: variantId, sku: "sku", isActive: true, basePriceInCents: base, media: [] }] };
  const priceReads: unknown[] = [];
  let writes = 0;
  let legacyPolicyReads = 0;
  const deps = {
    productRepo: { search: async () => ({ products: [product], nextCursor: null }) },
    merchantRepo: { getRules: async () => { legacyPolicyReads++; return Object.hasOwn(options, "rules") ? options.rules : policy; },
      ...(Object.hasOwn(options, "existingRules") || options.existingRulesFailure ? { getExistingRules: async () => {
        if (options.existingRulesFailure) throw new Error("synthetic_policy_read_failed");
        return options.existingRules;
      } } : {}) },
    prisma: {
      productPromotion: { findMany: async () => options.rows ?? [promo()] },
      productPrice: { findMany: async (input: unknown) => {
        priceReads.push(input);
        if (options.priceFailure) throw new Error("synthetic_price_read_failed");
        return [{ variantId, basePriceInCents: options.priceBase ?? base,
          costInCents: Object.hasOwn(options, "cost") ? options.cost : 1000,
          variant: { productId: options.priceProductId ?? productId, product: { categoryId: "category", metadata: {} } } }];
      } },
    },
    cartRepo: new Proxy({}, { get: () => async () => { writes++; throw new Error("daily_deals_must_not_write_cart"); } }),
  } as unknown as ProductHandlerDeps;
  const handlers = createProductHandlers(deps, { merchantId, sessionId: "conversation" });
  return { read: async () => handlers.getDailyDeals({}) as Promise<{ deals: Array<Record<string, unknown>> }>,
    priceReads, writeCount: () => writes, legacyPolicyReadCount: () => legacyPolicyReads };
}

test("daily deals advertise only the policy-authorized promotional price, not the raw promotion", async () => {
  const context = fixture();
  const { deals } = await context.read();
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.price, 8000);
  assert.equal(deals[0]!.originalPrice, 10000);
  assert.equal(deals[0]!.discountPercent, 20);
  assert.equal(context.writeCount(), 0);
  assert.deepEqual(context.priceReads, [{ where: { variantId: { in: [variantId] }, currency: "BRL",
    variant: { isActive: true, product: { merchantId, isActive: true, deletedAt: null } } },
    select: { variantId: true, costInCents: true, basePriceInCents: true,
      variant: { select: { productId: true, product: { select: { categoryId: true, metadata: true } } } } } }]);
});

test("daily deals select the largest applicable promotion regardless of product/variant priority or read order", async () => {
  const rows = [promo({ id: "product-small", discountValue: 5 }),
    promo({ id: "variant-large", productId: null, variantId, discountValue: 15 }),
    promo({ id: "category-middle", productId: null, categoryId: "category", discountValue: 10 })];
  for (const candidates of [rows, [...rows].reverse()]) {
    const { deals } = await fixture({ rows: candidates }).read();
    assert.equal(deals[0]!.price, 8500);
    assert.equal(deals[0]!.discountPercent, 15);
  }
});

for (const [name, rules] of [
  ["missing", null], ["malformed", { ...policy, maxDiscountPercent: "20" }],
  ["foreign", { ...policy, merchantId: "other-merchant" }], ["zero", { ...policy, maxDiscountPercent: 0 }],
] as const) test(`daily deals cannot advertise an inline discount under ${name} merchant policy`, async () => {
  assert.deepEqual((await fixture({ rules }).read()).deals, []);
});

for (const [name, options] of [
  ["missing cost", { cost: null }], ["stale catalog price", { priceBase: 9999 }],
  ["foreign catalog product", { priceProductId: "other-product" }], ["price read failure", { priceFailure: true }],
  ["insufficient margin", { cost: 7900, rules: { ...policy, minimumMarginPercent: 20 } }],
] as const) test(`daily deals validate commercial authority: ${name}`, async () => {
  const context = fixture(options), { deals } = await context.read();
  if (name === "missing cost" || name === "insufficient margin") {
    assert.equal(deals.length, 1); assert.equal(deals[0].price, 8000);
    assert.equal(deals[0].originalPrice, 10000); assert.equal(deals[0].discountPercent, 20);
  } else assert.deepEqual(deals, []);
  assert.equal(context.writeCount(), 0);
});

test("daily deals retain a coupon badge at the authoritative base price without fabricating savings", async () => {
  const { deals } = await fixture({ rows: [promo({ couponId: "coupon", discountType: null, discountValue: null })] }).read();
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.price, 10000);
  assert.equal(deals[0]!.coupon, true);
  assert.equal(deals[0]!.originalPrice, undefined);
  assert.equal(deals[0]!.discountPercent, undefined);
});

test("daily deals use floor-discount cents rather than rounding a half-cent discount upward", async () => {
  const { deals } = await fixture({ base: 101, cost: 1, rules: { ...policy, maxDiscountPercent: 50 } }).read();
  assert.equal(deals[0]!.price, 51);
  assert.ok(Number(deals[0]!.discountPercent) <= 50);
});

test("daily deals ignore foreign scope and refuse malformed promotion descriptors", async () => {
  for (const row of [promo({ merchantId: "other-merchant" }), promo({ productId: "other-product" }),
    promo({ discountValue: 50.5 }), promo({ discountValue: 150 }), promo({ promoPriceInCents: 1 })]) {
    assert.deepEqual((await fixture({ rows: [row] }).read()).deals, []);
  }
});

for (const [name, options] of [["missing", { existingRules: undefined }],
  ["failed", { existingRulesFailure: true }]] as const) test(`daily deals ${name} existing policy never invokes a legacy upsert/default getter`, async () => {
  const context = fixture(options);
  assert.deepEqual((await context.read()).deals, []);
  assert.equal(context.legacyPolicyReadCount(), 0);
});

