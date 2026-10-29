import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { storefrontLocalCartWriteIntentSchema, storefrontWriteScopeSchema } from "../../domain/contracts/storefront-local-cart-write.schemas.js";
import { createPrismaStorefrontLocalCartEffectDependencies } from "./prisma-storefront-local-cart-effect.dependencies.js";
import { storefrontLocalCartCommercialOutcomeV1Schema } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";

// Real pure rules engine; explicit transaction delegates only. These fakes do
// not prove SQL isolation, row locking, database rollback or production pricing.
const scope = () => storefrontWriteScopeSchema.parse({ merchantId: "merchant", conversationId: "conversation", cartId: "session", principalId: "principal" });
const intent = () => storefrontLocalCartWriteIntentSchema.parse({ version: 1, message_id: "message", expected_revision: 0,
  command: { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 2 } } });
const variant = (id = "variant") => ({ id, sku: "CATALOG-SKU", isActive: true,
  product: { id: `product-${id}`, merchantId: "merchant", name: "Authoritative product", type: "physical", metadata: {}, isActive: true, deletedAt: null, categoryId: "CATALOG-CATEGORY" },
  price: { variantId: id, currency: "BRL", basePriceInCents: 10000, costInCents: 2000 as number | null },
});
const merchant = () => ({ merchantId: "merchant", maxDiscountPercent: new Prisma.Decimal(20), minimumMarginPercent: new Prisma.Decimal(10),
  allowFreeShipping: true, allowShippingDiscount: true, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: new Prisma.Decimal(250), maxShippingSubsidy: new Prisma.Decimal(45), maxPartialShippingDiscount: new Prisma.Decimal(20),
  offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "consultative", couponBoxEnabled: true, autonomousEngineEnabled: true });
const rule = (overrides: Record<string, unknown> = {}) => ({ id: "rule", enabled: true, priority: 1,
  conditions: [{ field: "cart_total", operator: ">=", value: "100" }], action: { type: "offer_discount", params: { percent: 15 } }, ...overrides });
const cart = (): StorefrontCart => ({ id: "cart-row", merchantId: "merchant", sessionId: "session",
  items: [{ variantId: "variant", productId: "product-variant", name: "Old name", sku: "OLD-SKU", categoryId: "OLD-CATEGORY", quantity: 2, unitPriceCents: 10000 }],
  couponCode: null, discount: 0, freeShipping: false, total: 20000, createdAt: new Date(0), updatedAt: new Date(0) });
type Call = { step: string; args: unknown };
type Options = { first?: unknown; many?: unknown; promotion?: unknown; policy?: unknown; setting?: unknown;
  promotions?: unknown; crossPromotions?: unknown; rules?: unknown; failure?: "first" | "many" | "promotion" | "policy" | "setting"; beforeRead?: Promise<void> };
function project(value: unknown, select: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(item => project(item, select));
  assert.equal(typeof value, "object");
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(select).map(([key, requested]) => [key,
    requested === true ? row[key] : project(row[key], (requested as { select: Record<string, unknown> }).select)]));
}
function fixture(options: Options = {}) {
  const calls: Call[] = [], first = variant(), policy = merchant(), failure = new Error("synthetic-reader-failure");
  const setting = { merchantId: "merchant", advancedRules: Object.hasOwn(options, "rules") ? options.rules : [rule()] };
  const read = (step: Options["failure"], result: () => unknown) => async (args: unknown) => {
    calls.push({ step: step!, args }); await options.beforeRead;
    if (options.failure === step) throw failure;
    const { select } = args as { select: Record<string, unknown> }; assert.ok(select, "explicit_projection_required");
    return project(result(), select);
  };
  const rawTx = {
    productVariant: { findFirst: read("first", () => Object.hasOwn(options, "first") ? options.first : first),
      findMany: read("many", () => Object.hasOwn(options, "many") ? options.many : [first]) },
    productPromotion: { findFirst: read("promotion", () => Object.hasOwn(options, "promotion") ? options.promotion : null),
      findMany: read("promotion", () => Object.hasOwn(options, "promotions") ? options.promotions : []) },
    crossSellPromotion: { findMany: read("promotion", () => options.crossPromotions ?? []) },
    merchantRule: { findUnique: read("policy", () => Object.hasOwn(options, "policy") ? options.policy : policy) },
    checkoutSetting: { findUnique: read("setting", () => Object.hasOwn(options, "setting") ? options.setting : setting) },
  };
  // Any unexpected transaction/delegate/write access fails instead of silently
  // returning undefined. No actual PrismaClient is instantiated.
  const guard = (value: Record<string, unknown>): object => new Proxy(value, { get(target, key) {
    if (typeof key !== "string") assert.fail(`unexpected_tx_access_${String(key)}`);
    assert.ok(Object.hasOwn(target, key), `unexpected_tx_access_${key}`);
    const member = target[key]; return member && typeof member === "object" ? guard(member as Record<string, unknown>) : member;
  } });
  const tx = guard(rawTx) as Prisma.TransactionClient;
  const dependencies = createPrismaStorefrontLocalCartEffectDependencies();
  return { dependencies, tx, calls, first, policy, setting, failure,
    resolve: () => dependencies.resolveItem(tx, scope(), intent()), evaluate: (value = cart()) => dependencies.evaluateRules(tx, scope(), value),
    evaluateLegacy: async (value = cart()) => {
      const result = storefrontLocalCartCommercialOutcomeV1Schema.parse(await dependencies.evaluateRules(tx, scope(), value));
      return { discountCents: result.discountCents, freeShipping: result.freeShipping };
    } };
}
const noIncentive = { discountCents: 0, freeShipping: false };
const promo = (extra: Record<string, unknown> = {}) => ({ id: "promo", merchantId: "merchant", variantId: "variant", productId: null, categoryId: null,
  couponId: null, discountType: "percent", discountValue: 15, promoPriceInCents: null, isActive: true,
  startsAt: new Date(0), endsAt: new Date("2100-01-01T00:00:00.000Z"), ...extra });

const crossPromotion = () => ({ id: "cross", merchantId: "merchant", updatedAt: new Date("2026-10-18T00:00:00.000Z"),
  status: "active", startsAt: new Date(0), endsAt: new Date("2100-01-01T00:00:00.000Z"), trigger: { sku_in_cart: ["HOST"] },
  recommendedSkus: ["CATALOG-SKU"], discountPercent: new Prisma.Decimal("10.0000"), maxDiscountPercent: new Prisma.Decimal("10.0000") });
function acceptedCart() {
  const value = cart(); value.items[0].quantity = 1;
  Object.assign(value.items[0], { crossSellIntent: { version: 1, promotionId: "cross", promotionUpdatedAt: "2026-10-18T00:00:00.000Z",
    acceptedQuantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 } });
  value.items.push({ variantId: "host", productId: "product-host", name: "Host", sku: "HOST", quantity: 1, unitPriceCents: 10000 });
  return value;
}
function acceptedFixture(options: Options = {}) {
  const host = variant("host"); host.sku = "HOST";
  return fixture({ many: [variant(), host], crossPromotions: [crossPromotion()], rules: [], ...options });
}
test("accepted cross-sell is reauthorized post-add using honest trigger/catalog, base persists and only transient P changes", async () => {
  const f = acceptedFixture(), value = acceptedCart(), before = structuredClone(value);
  const outcome = await f.evaluate(value); assert.equal(outcome.quote.promotionDiscountCents, 1000); assert.equal(outcome.discountCents, 0);
  assert.equal(outcome.quote.items[0].unitPriceCents, 9000); assert.deepEqual(value, before);
});
test("accepted cross-sell chooses greatest product benefit, never stacks two inline percentages", async () => {
  const f = acceptedFixture({ promotions: [promo({ discountValue: 15 })] });
  const outcome = await f.evaluate(acceptedCart()); assert.equal(outcome.quote.promotionDiscountCents, 1500);
});
for (const reason of ["cost", "policy", "version", "trigger", "quantity", "base", "sku-ambiguity", "expired", "cap"])
  test(reason === "cost" ? "accepted cross-sell retains its maximum without product cost" : `accepted cross-sell cannot silently downgrade accepted maximum (${reason})`, async () => {
    const first = variant(), host = variant("host"), promotion = crossPromotion(), value = acceptedCart(), policy = merchant(); host.sku = "HOST";
    if (reason === "cost") first.price.costInCents = null;
    if (reason === "version") promotion.updatedAt = new Date(1);
    if (reason === "trigger") host.sku = "OTHER";
    if (reason === "quantity") { value.items[0].quantity = 2; value.total = 30000; }
    if (reason === "base") first.price.basePriceInCents = 10001;
    if (reason === "expired") promotion.endsAt = new Date(1);
    if (reason === "cap") policy.maxDiscountPercent = new Prisma.Decimal(1);
    if (reason === "sku-ambiguity") host.sku = first.sku;
    const f = acceptedFixture({ many: [first, host], crossPromotions: [promotion], policy: reason === "policy" ? null : policy });
    if (reason === "cost") {
      const result = await f.evaluate(value);
      assert.equal(result.quote.items[0].unitPriceCents, 9000);
      assert.equal(result.quote.promotionDiscountCents, 1000);
    } else await assert.rejects(f.evaluate(value));
  });
test("V1 reader separates inline P from extra D within the shared original ceiling", async () => {
  const f = fixture({ promotions: [promo()], rules: [rule({ action: { type: "offer_discount", params: { percent: 30 } } })] });
  const value = cart(), before = structuredClone(value), result = await f.evaluate(value);
  assert.equal(result.version, 1); assert.equal(result.discountCents, 1000); assert.equal(result.freeShipping, false);
  assert.deepEqual(result.quote, { currency: "BRL", originalSubtotalCents: 20000, promotionDiscountCents: 3000, subtotalCents: 17000,
    merchandiseTotalCents: 16000, items: [{ variantId: "variant", productId: "product-variant", quantity: 2, baseUnitPriceCents: 10000, unitPriceCents: 8500 }],
    commercialNotices: [{ version: 1, code: "discount_limit_reached", message: "Você já obteve o desconto máximo permitido por esta loja nos produtos deste pedido. Outros benefícios não aumentam esse desconto." }] });
  assert.deepEqual(value, before); assert.equal(f.calls.filter(call => call.step === "promotion").length, 1);
});
test("V1 resolver always returns catalog BASE despite promotions and performs no promotion IO", async () => {
  const f = fixture({ promotions: [promo()] }); assert.equal((await f.resolve()).unitPriceCents, 10000);
  assert.deepEqual(f.calls.map(call => call.step), ["first"]);
});
test("V1 best promotion selects across exact tenant variant/product/category while coupon row is badge only", async () => {
  const f = fixture({ promotions: [promo({ id: "variant10", discountValue: 10 }), promo({ id: "product15", variantId: null, productId: "product-variant" }),
    promo({ id: "category20", variantId: null, categoryId: "CATALOG-CATEGORY", discountValue: 20 }),
    promo({ id: "coupon", couponId: "code", discountType: null, discountValue: null }), promo({ id: "foreign", merchantId: "foreign", discountValue: 99 })] });
  const result = await f.evaluate(); assert.equal(result.quote.promotionDiscountCents, 4000); assert.equal(result.discountCents, 0);
  assert.equal(result.quote.items[0].unitPriceCents, 8000);
});
for (const cost of [null, 9500]) test(`V1 shares P+D ceiling without requiring product margin/cost (${cost})`, async () => {
  const f = fixture({ promotions: [promo()] }); f.first.price.costInCents = cost;
  const result = await f.evaluate(); assert.equal(result.quote.promotionDiscountCents, 3000); assert.equal(result.discountCents, 1000);
  assert.equal(result.quote.subtotalCents, 17000); assert.equal(result.quote.commercialNotices?.[0].code, "discount_limit_reached");
});
test("V1 merchant zero ceiling preserves base and truthful unavailable notice", async () => {
  const f = fixture({ promotions: [promo()] }); f.policy.maxDiscountPercent = new Prisma.Decimal(0);
  const result = await f.evaluate(); assert.equal(result.quote.promotionDiscountCents, 0); assert.equal(result.discountCents, 0);
  assert.equal(result.quote.commercialNotices?.[0].code, "discount_unavailable");
});
test("V1 additional rule D respects the ceiling even without product cost", async () => {
  const f = fixture(); f.first.price.costInCents = null;
  const result = await f.evaluate(); assert.equal(result.discountCents, 3000); assert.equal(result.quote.promotionDiscountCents, 0);
  assert.equal(result.quote.merchandiseTotalCents, 17000);
});
test("V1 bounded quantity allocation leaves indivisible cent unused rather than exceeding ceiling", async () => {
  const f = fixture({ promotions: [promo({ discountValue: 100 })], rules: [] }), value = cart();
  f.first.price.basePriceInCents = 101; f.first.price.costInCents = 0; f.policy.maxDiscountPercent = new Prisma.Decimal(50);
  value.items[0].unitPriceCents = 101; value.items[0].quantity = 3; value.total = 303;
  const result = await f.evaluate(value); assert.equal(result.quote.promotionDiscountCents, 150); assert.equal(result.quote.items[0].unitPriceCents, 51);
  assert.equal(result.discountCents, 0); assert.equal(result.quote.commercialNotices?.[0].code, "discount_limited");
});
test("V1 automatic D recomputes rather than reserving old D against promotion budget", async () => {
  const f = fixture({ promotions: [promo()] }), value = cart(); value.discount = 4000;
  const result = await f.evaluate(value); assert.equal(result.quote.promotionDiscountCents, 3000); assert.equal(result.discountCents, 1000);
  assert.equal(value.discount, 4000);
});
for (const malformed of [null, [{}], [promo({ discountType: "invalid" })], [promo({ discountType: "percent", discountValue: 10, promoPriceInCents: 100 })]])
  test(`V1 malformed promotion authority never becomes no-promotion fallback ${JSON.stringify(malformed)}`, async () => {
    const f = fixture({ promotions: malformed }); await assert.rejects(f.evaluate());
  });
for (const descriptor of [{ discountType: "fixed", discountValue: 1500 }, { discountType: null, discountValue: null, promoPriceInCents: 8500 }])
  test(`V1 fixed cents and explicit price use the same P+D authority ${JSON.stringify(descriptor)}`, async () => {
    const f = fixture({ promotions: [promo(descriptor)] }), result = await f.evaluate();
    assert.equal(result.quote.promotionDiscountCents, 3000); assert.equal(result.discountCents, 1000); assert.equal(result.quote.subtotalCents, 17000);
  });
test("V1 inactive future expired and foreign promotions cannot grant a saving", async () => {
  const f = fixture({ promotions: [promo({ id: "inactive", isActive: false }), promo({ id: "future", startsAt: new Date("2100-01-01"), endsAt: new Date("2200-01-01") }),
    promo({ id: "expired", endsAt: new Date(1) }), promo({ id: "foreign", merchantId: "foreign", discountValue: 99 })] });
  const result = await f.evaluate(); assert.equal(result.quote.promotionDiscountCents, 0); assert.equal(result.discountCents, 3000);
});
test("V1 allocation is stable across cart and catalog ordering and covers another existing line", async () => {
  const second = variant("second"), value = cart(); second.price.basePriceInCents = 5001; second.price.costInCents = 0;
  value.items.push({ ...value.items[0], variantId: "second", productId: "product-second", quantity: 3, unitPriceCents: 5001 }); value.total = 35003;
  const promotions = [promo({ discountValue: 100 }), promo({ id: "other", variantId: "second", discountValue: 100 })];
  const a = fixture({ many: [variant(), second], promotions, rules: [] }), b = fixture({ many: [second, variant()], promotions: [...promotions].reverse(), rules: [] });
  const reversed = structuredClone(value); reversed.items.reverse();
  const one = await a.evaluate(value), two = await b.evaluate(reversed);
  const normalize = (result: typeof one) => ({ ...result, quote: { ...result.quote, items: [...result.quote.items].sort((left, right) => left.variantId.localeCompare(right.variantId)) } });
  assert.deepEqual(normalize(one), normalize(two));
  assert.ok(one.quote.promotionDiscountCents <= Math.floor(35003 * .2)); assert.equal(one.discountCents, 0);
});

test("zero-client factory exposes only the two transaction-bound dependency readers", () => {
  const dependencies = createPrismaStorefrontLocalCartEffectDependencies();
  assert.deepEqual(Object.keys(dependencies).sort(), ["evaluateRules", "resolveItem"]);
  assert.equal(typeof dependencies.resolveItem, "function"); assert.equal(typeof dependencies.evaluateRules, "function");
});

test("resolveItem reads current tenant catalog/base BRL price and omits unsupported image/cost fields", async () => {
  const f = fixture();
  assert.deepEqual(await f.resolve(), { productId: "product-variant", name: "Authoritative product", sku: "CATALOG-SKU", categoryId: "CATALOG-CATEGORY", unitPriceCents: 10000 });
  const lookup = f.calls.find(call => call.step === "first")!.args as { where: unknown; select: unknown };
  assert.deepEqual(lookup.where, { id: "variant", isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null } });
  assert.deepEqual(lookup.select, { id: true, sku: true, isActive: true, product: { select: { id: true, merchantId: true, name: true, type: true, metadata: true,
    isActive: true, deletedAt: true, categoryId: true } }, price: { select: { variantId: true, currency: true, basePriceInCents: true } } });
});
test("real rules engine applies percent discount with current catalog prices and known costs", async () => {
  const f = fixture(); assert.deepEqual(await f.evaluateLegacy(), { discountCents: 3000, freeShipping: false });
  assert.deepEqual((f.calls.find(call => call.step === "policy")!.args as { where: unknown }).where, { merchantId: "merchant" });
  assert.deepEqual((f.calls.find(call => call.step === "setting")!.args as { where: unknown }).where, { merchantId: "merchant" });
  const many = f.calls.find(call => call.step === "many")!.args as { where: unknown };
  assert.deepEqual(many.where, { id: { in: ["variant"] }, isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null } });
});
test("policy and setting projection contain no unrelated merchant/PII data and no default writes", async () => {
  const f = fixture(); await f.evaluateLegacy();
  const policy = (f.calls.find(call => call.step === "policy")!.args as { select: Record<string, unknown> }).select;
  assert.deepEqual(Object.keys(policy).sort(), Object.keys(merchant()).filter(key => key !== "minimumMarginPercent").sort());
  assert.equal(Object.hasOwn(policy, "minimumMarginPercent"), false);
  assert.ok(Object.values(policy).every(value => value === true));
  assert.deepEqual((f.calls.find(call => call.step === "setting")!.args as { select: unknown }).select, { merchantId: true, advancedRules: true });
});
test("promotion query uses all catalog identities and one server observation window", async () => {
  const before = Date.now(), f = fixture(); await f.evaluate(); const after = Date.now();
  const { where, select } = f.calls.find(call => call.step === "promotion")!.args as { where: { merchantId: string; isActive: boolean; startsAt: { lte: Date }; endsAt: { gt: Date }; OR: unknown[] }; select: unknown };
  assert.equal(where.merchantId, "merchant"); assert.equal(where.isActive, true);
  assert.deepEqual(select, { id: true, merchantId: true, variantId: true, productId: true, categoryId: true, couponId: true,
    discountType: true, discountValue: true, promoPriceInCents: true, isActive: true, startsAt: true, endsAt: true });
  assert.equal(where.startsAt.lte.getTime(), where.endsAt.gt.getTime());
  assert.ok(where.startsAt.lte.getTime() >= before && where.startsAt.lte.getTime() <= after);
  const serialized = JSON.stringify(where.OR);
  for (const id of ["variant", "product-variant", "CATALOG-CATEGORY"]) assert.ok(serialized.includes(id));
  assert.ok(!serialized.includes("OLD-SKU")); assert.ok(!serialized.includes("OLD-CATEGORY"));
});
test("coupon-linked promotion remains badge-only and never an automatic cart target", async () => {
  const f = fixture({ rules: [], promotions: [promo({ couponId: "code", discountType: null, discountValue: null })] });
  const result = await f.evaluate(); assert.equal(result.discountCents, 0); assert.equal(result.quote.promotionDiscountCents, 0);
});
test("categoryless catalog omits optional output category and never queries null promotion category", async () => {
  const f = fixture(); f.first.product.categoryId = null as never;
  const result = await f.resolve(); assert.equal(Object.hasOwn(result, "categoryId"), false);
  await f.evaluate();
  assert.ok(!JSON.stringify(f.calls.find(call => call.step === "promotion")!.args).includes('"categoryId":null'));
});
for (const [name, modify] of [
  ["foreign merchant", (v: ReturnType<typeof variant>) => { v.product.merchantId = "foreign"; }],
  ["inactive variant", (v: ReturnType<typeof variant>) => { v.isActive = false; }],
  ["inactive product", (v: ReturnType<typeof variant>) => { v.product.isActive = false; }],
  ["deleted product", (v: ReturnType<typeof variant>) => { v.product.deletedAt = new Date() as never; }],
  ["wrong variant", (v: ReturnType<typeof variant>) => { v.id = "other"; }],
  ["wrong price identity", (v: ReturnType<typeof variant>) => { v.price.variantId = "other"; }],
  ["currency", (v: ReturnType<typeof variant>) => { v.price.currency = "USD"; }],
  ["negative base", (v: ReturnType<typeof variant>) => { v.price.basePriceInCents = -1; }],
  ["fractional base", (v: ReturnType<typeof variant>) => { v.price.basePriceInCents = 1.5; }],
  ["overflow base", (v: ReturnType<typeof variant>) => { v.price.basePriceInCents = 2_147_483_648; }],
  ["scheduled service without a selected slot", (v: ReturnType<typeof variant>) => { v.product.type = "service";
    v.product.metadata = { serviceSchedule: { timeZone: "UTC", durationMinutes: 30,
      slots: [{ id: "slot", date: "2099-01-01", startTime: "12:00" }] } }; }],
  ["digital without deliverable content", (v: ReturnType<typeof variant>) => { v.product.type = "digital"; }],
  ["unknown product type", (v: ReturnType<typeof variant>) => { v.product.type = "unknown"; }],
  ["required options without explicit selection", (v: ReturnType<typeof variant>) => { v.product.metadata = { optionGroups: [{ id: "size", name: "Size", required: true, items: [{ id: "one", name: "One" }] }] }; }],
] as const) for (const method of ["resolve", "evaluate"] as const) test(`${method} fails closed for ${name}`, async () => {
  const f = fixture(); modify(f.first); await assert.rejects(f[method]());
});
for (const type of ["digital", "service", "food"] as const)
  test(`legacy unpinned catalog cannot switch to ${type} without NORMAL authority`, async () => {
    const first = variant(); first.product.type = type;
    first.product.metadata = type === "digital" ? { downloadUrl: "https://example.test/synthetic.pdf" } : {};
    first.price.costInCents = null;
    const f = fixture({ first, many: [first], rules: [] });
    // Reader parity is not permission to expand the legacy resolver/writer,
    // whose shown quote does not pin type/fulfillment revisions.
    await assert.rejects(f.resolve());
    const before = cart(); await assert.rejects(f.evaluate(before));
    assert.deepEqual(before, cart());
  });
// Reclassify analytic-only malformed measurements explicitly, rather than
// deleting the prior negative/fractional-cost characterizations for green.
for (const cost of [-1, 1.5]) for (const method of ["resolve", "evaluate"] as const)
  test(`${method} does not use analytic cost ${cost} as eligibility`, async () => {
    const f = fixture(); f.first.price.costInCents = cost;
    if (method === "resolve") assert.equal((await f.resolve()).unitPriceCents, 10000);
    else assert.deepEqual(await f.evaluateLegacy(), { discountCents: 3000, freeShipping: false });
  });
for (const margin of [-1, null, undefined, Number.NaN, "10"]) test(`unknown analytic margin ${String(margin)} is not a policy eligibility gate`, async () => {
  const f = fixture(); if (margin === undefined) Reflect.deleteProperty(f.policy, "minimumMarginPercent"); else Reflect.set(f.policy, "minimumMarginPercent", margin);
  assert.deepEqual(await f.evaluateLegacy(), { discountCents: 3000, freeShipping: false });
});
for (const first of [null, { ...variant(), price: null }, { ...variant(), sku: "" }, { ...variant(), product: { ...variant().product, id: "\ud800" } }]) {
  test(`missing/malformed resolver row never becomes zero-priced item ${JSON.stringify(first)}`, async () => {
    const f = fixture({ first }); await assert.rejects(f.resolve());
  });
}
test("explicit zero base price is valid, unlike a missing price row", async () => {
  const f = fixture(); f.first.price.basePriceInCents = 0;
  assert.equal((await f.resolve()).unitPriceCents, 0);
});
for (const policy of [null, { ...merchant(), merchantId: "foreign" }, { ...merchant(), maxDiscountPercent: new Prisma.Decimal(101) },
  { ...merchant(), maxDiscountPercent: new Prisma.Decimal("NaN") },
  { ...merchant(), brandVoice: "unknown" }, { ...merchant(), autonomousEngineEnabled: "yes" }]) {
  test(`mandatory merchant policy is strict/read-only ${String(policy?.merchantId)}:${Object.keys(policy ?? {}).join()}`, async () => {
    const f = fixture({ policy, rules: [] }); await assert.rejects(f.evaluateLegacy());
  });
}
for (const setting of [null, { merchantId: "merchant", advancedRules: null }]) test(`missing/null setting is explicit no-rules ${String(setting)}`, async () => {
  const f = fixture({ setting }); assert.deepEqual(await f.evaluateLegacy(), noIncentive);
  assert.ok(f.calls.some(call => call.step === "policy"));
});
test("empty rules reset prior automatic discount/free-shipping without compounding", async () => {
  const f = fixture({ rules: [] }), value = cart(); value.discount = 500; value.freeShipping = true;
  assert.deepEqual(await f.evaluateLegacy(value), noIncentive); assert.equal(value.discount, 500); assert.equal(value.freeShipping, true);
});
test("merchant policy remains mandatory even if no checkout setting exists", async () => {
  const f = fixture({ policy: null, setting: null }); await assert.rejects(f.evaluateLegacy());
});
for (const rules of [{}, [null], [rule({ enabled: "true" })], [rule({ priority: NaN })], [rule({ conditions: [{ field: "unknown", operator: "eq", value: 1 }] })],
  [rule({ conditions: [{ field: "cart_total", operator: "unknown", value: 1 }] })], [rule({ action: { type: "unknown", params: {} } })],
  [rule({ action: { type: "offer_discount", params: { percent: 101 } } })], [rule({ action: { type: "offer_discount", params: { percent: "infinity" } } })],
  [rule({ action: { type: "offer_discount", params: { percent: 10, maxDiscountReais: -1 } } })]]) {
  test(`malformed persisted advanced rule cannot become empty fallback ${JSON.stringify(rules)}`, async () => {
    const f = fixture({ rules }); await assert.rejects(f.evaluateLegacy());
  });
}
test("foreign checkout setting cannot supply another tenant's rules", async () => {
  const f = fixture({ setting: { merchantId: "foreign", advancedRules: [] } }); await assert.rejects(f.evaluateLegacy());
});
test("disabled rules remain disabled and enabled rules honor ascending priority first-match", async () => {
  const f = fixture({ rules: [rule({ priority: 5 }), rule({ enabled: false, priority: 0, action: { type: "offer_discount", params: { percent: 90 } } }),
    rule({ priority: 1, action: { type: "offer_discount", params: { percent: 5 } } })] });
  assert.deepEqual(await f.evaluateLegacy(), { discountCents: 1000, freeShipping: false });
});
test("real merchant percent cap, including Prisma Decimal, limits a larger requested discount", async () => {
  const f = fixture({ rules: [rule({ action: { type: "offer_discount", params: { percent: 90 } } })] });
  assert.deepEqual(await f.evaluateLegacy(), { discountCents: 4000, freeShipping: false });
});
test("real max-reais cap and compatible numeric strings are applied without inventing a second formula", async () => {
  const f = fixture({ rules: [rule({ action: { type: "offer_discount", params: { percent: "15", maxDiscountReais: "10" } } })] });
  assert.deepEqual(await f.evaluateLegacy(), { discountCents: 1000, freeShipping: false });
});
for (const cost of [null, 9500]) test(`high or absent product cost cannot block a valid discount (${cost})`, async () => {
  const f = fixture(); f.first.price.costInCents = cost; assert.deepEqual(await f.evaluateLegacy(), { discountCents: 3000, freeShipping: false });
});
test("zero known cost is not confused with missing cost", async () => {
  const f = fixture(); f.first.price.costInCents = 0; assert.equal((await f.evaluateLegacy()).discountCents, 3000);
});
test("free-shipping rule never authorizes shipping without a carrier quote", async () => {
  const f = fixture({ rules: [rule({ action: { type: "offer_free_shipping", params: {} } })] });
  assert.deepEqual(await f.evaluateLegacy(), noIncentive);
});
test("SKU/category conditions use freshly hydrated catalog identities without mutating cart snapshots", async () => {
  const f = fixture({ rules: [rule({ conditions: [{ field: "product_in_cart", operator: "contains", value: "CATALOG-SKU" },
    { field: "category_in_cart", operator: "contains", value: "CATALOG-CATEGORY" }] })] }), value = cart(), before = structuredClone(value);
  assert.equal((await f.evaluateLegacy(value)).discountCents, 3000); assert.deepEqual(value, before);
});
for (const operator of [">=", "gte", "=", "===", " GTE "]) test(`compatible evaluator operator ${operator} remains supported`, async () => {
  const f = fixture({ rules: [rule({ conditions: [{ field: "cart_total", operator, value: "200" }] })] });
  assert.equal((await f.evaluateLegacy()).discountCents, 3000);
});
test("valid rule presentation fields do not turn existing policy JSON into malformed data", async () => {
  const f = fixture({ rules: [rule({ name: "UI label", description: "UI description", extraPresentation: { color: "blue" } })] });
  assert.equal((await f.evaluateLegacy()).discountCents, 3000);
});
test("enabled product-scoped rule is unsupported even when different catalog products share SKU", async () => {
  const one = variant(), two = variant("second"), value = cart(); value.items.push({ ...value.items[0], variantId: "second", productId: "product-second" }); value.total = 40000;
  const f = fixture({ many: [one, two], rules: [rule({ productId: "product-variant" })] }); await assert.rejects(f.evaluateLegacy(value));
});
test("disabled well-formed product-scoped rule does not acquire enabled authority", async () => {
  const f = fixture({ rules: [rule({ enabled: false, productId: "product-variant" })] }); assert.deepEqual(await f.evaluateLegacy(), noIncentive);
});
test("disabled autonomous policy refuses enabled rules instead of silently applying them", async () => {
  const f = fixture(); f.policy.autonomousEngineEnabled = false; await assert.rejects(f.evaluateLegacy());
});
test("disabled autonomous policy is compatible with explicitly empty rules", async () => {
  const f = fixture({ rules: [] }); f.policy.autonomousEngineEnabled = false; assert.deepEqual(await f.evaluateLegacy(), noIncentive);
});
test("empty conditions are malformed authoring, never an unconditional discount authorization", async () => {
  const f = fixture({ rules: [rule({ conditions: [] })] }); await assert.rejects(f.evaluateLegacy());
});
test("persisted policy above authoring limit of twenty rules is refused", async () => {
  const f = fixture({ rules: Array.from({ length: 21 }, (_, i) => rule({ id: `rule-${i}`, priority: i })) });
  await assert.rejects(f.evaluateLegacy());
});
for (const [field, operator, value] of [["cart_total", "lt", "Infinity"], ["shipping_cost", "eq", "NaN"],
  ["cart_item_count", "gte", NaN], ["cart_total", "lt", Infinity], ["cart_total", "gte", ""],
  ["cart_total", "gte", " "], ["cart_total", "gte", true], ["cart_total", "eq", ["200"]],
  ["product_in_cart", "gt", "200"]] as const) test(`condition authority rejects non-finite/incompatible ${field}/${operator}/${String(value)}`, async () => {
  const f = fixture({ rules: [rule({ conditions: [{ field, operator, value }] })] }); await assert.rejects(f.evaluateLegacy());
});
test("real Prisma cart expiry field is valid reader input without extra commercial reads", async () => {
  const f = fixture(), value = { ...cart(), expiresAt: new Date("2026-10-21T00:00:00.000Z") };
  assert.deepEqual(await f.evaluateLegacy(value), { discountCents: 3000, freeShipping: false });
  assert.deepEqual(f.calls.map(call => call.step).sort(), ["many", "policy", "promotion", "setting"]);
});
test("malformed optional Prisma cart expiry is rejected before any read", async () => {
  const f = fixture(), value = { ...cart(), expiresAt: "not-a-date" };
  await assert.rejects(f.evaluateLegacy(value)); assert.deepEqual(f.calls, []);
});
for (const [name, modify] of [
  ["foreign tenant", (value: StorefrontCart) => { value.merchantId = "foreign"; }],
  ["foreign session", (value: StorefrontCart) => { value.sessionId = "foreign"; }],
  ["coupon", (value: StorefrontCart) => { value.couponCode = "SYNTHETIC"; }],
  ["duplicate variant", (value: StorefrontCart) => { value.items.push({ ...value.items[0] }); value.total *= 2; }],
  ["zero quantity", (value: StorefrontCart) => { value.items[0].quantity = 0; value.total = 0; }],
  ["fractional quantity", (value: StorefrontCart) => { value.items[0].quantity = 1.5; value.total = 15000; }],
  ["quantity above99", (value: StorefrontCart) => { value.items[0].quantity = 100; value.total = 1_000_000; }],
  ["fractional price", (value: StorefrontCart) => { value.items[0].unitPriceCents = 10000.5; value.total = 20001; }],
  ["subtotal mismatch", (value: StorefrontCart) => { value.total += 1; }],
  ["empty cart", (value: StorefrontCart) => { value.items = []; value.total = 0; }],
  ["service slot", (value: StorefrontCart) => { value.items[0].selectedServiceSlot = { slotId: "slot" } as never; }],
  ["marketplace", (value: StorefrontCart) => { value.items[0].marketplace = { lineItemId: "line", sellerMerchantId: "seller", federatedProductId: "federated" }; }],
] as const) test(`cart validation rejects ${name} before authority reads`, async () => {
  const f = fixture(), value = cart(); modify(value); await assert.rejects(f.evaluateLegacy(value)); assert.deepEqual(f.calls, []);
});
test("unknown but structurally valid option snapshots require canonical lookup and fail before policy or writes", async () => {
  const f = fixture(), value = cart();
  value.items[0].selectedOptions = [{ groupId: "g", groupName: "G", itemId: "i", itemName: "I", priceModifierInCents: 0 }];
  await assert.rejects(f.evaluateLegacy(value));
  assert.deepEqual(f.calls.map(call => call.step), ["many"]);
});
test("physical product with optional unselected groups preserves explicit no-option base, never a guessed choice", async () => {
  const f = fixture(); f.first.product.metadata = { optionGroups: [{ id: "size", name: "Size", items: [{ id: "large", name: "Large", priceModifierInCents: 500 }] }] };
  assert.equal((await f.resolve()).unitPriceCents, 10000);
  assert.equal((await f.evaluate()).quote.originalSubtotalCents, 20000);
});
for (const mismatch of ["price", "product"] as const) test(`stale existing ${mismatch} is refused rather than silently repriced`, async () => {
  const f = fixture(), value = cart();
  if (mismatch === "price") { value.items[0].unitPriceCents = 10001; value.total = 20002; }
  else value.items[0].productId = "other-product";
  await assert.rejects(f.evaluateLegacy(value));
  assert.ok(!f.calls.some(call => ["policy", "setting"].includes(call.step)));
});
for (const many of [[], [variant(), variant()], [variant("foreign-id")]]) test(`full-cart authority requires exact unique returned variant set ${JSON.stringify(many.map(value => value.id))}`, async () => {
  const f = fixture({ many }); await assert.rejects(f.evaluateLegacy());
});
test("promo lookup spans every cart line with current catalog product/category IDs", async () => {
  const second = variant("second"); second.product.categoryId = "SECOND-CATEGORY";
  const f = fixture({ many: [variant(), second] }), value = cart();
  value.items.push({ ...value.items[0], variantId: "second", productId: "product-second" }); value.total = 40000;
  await f.evaluateLegacy(value);
  const serialized = JSON.stringify(f.calls.find(call => call.step === "promotion")!.args);
  for (const id of ["variant", "second", "product-variant", "product-second", "CATALOG-CATEGORY", "SECOND-CATEGORY"]) assert.ok(serialized.includes(id));
  assert.ok(!serialized.includes("OLD-CATEGORY"));
});
test("missing cost on another cart line cannot veto the whole-cart ceiling", async () => {
  const second = variant("second"); second.price.costInCents = null;
  const f = fixture({ many: [variant(), second] }), value = cart();
  value.items.push({ ...value.items[0], variantId: "second", productId: "product-second" }); value.total = 40000;
  assert.deepEqual(await f.evaluateLegacy(value), { discountCents: 6000, freeShipping: false });
});
for (const [method, steps] of [["resolve", ["first"]], ["evaluate", ["many", "promotion", "policy", "setting"]]] as const)
  for (const failure of steps) test(`${method} propagates ${failure} read failure unchanged without fallback or retry`, async () => {
    const f = fixture({ failure }); await assert.rejects(f[method](), error => error === f.failure);
    assert.equal(f.calls.filter(call => call.step === failure).length, 1);
  });
for (const method of ["resolveItem", "evaluateRules"] as const) test(`${method} rejects malformed scope before any IO`, async () => {
  const f = fixture();
  if (method === "resolveItem") await assert.rejects(f.dependencies.resolveItem(f.tx, { ...scope(), merchantId: "x\0y" }, intent()));
  else await assert.rejects(f.dependencies.evaluateRules(f.tx, { ...scope(), cartId: "\ud800" }, cart()));
  assert.deepEqual(f.calls, []);
});
test("intent parsing disallows public-style price, SKU aliases or forged selected options before IO", async () => {
  const f = fixture(), value = intent();
  await assert.rejects(f.dependencies.resolveItem(f.tx, scope(), { ...value, command: { ...value.command, args: { ...value.command.args, unitPriceCents: 1 } } } as never));
  assert.deepEqual(f.calls, []);
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
test("resolve snapshots scope/intent before awaiting the first transaction read", async () => {
  const gate = deferred(), f = fixture({ beforeRead: gate.promise }), bound = scope(), command = intent();
  const pending = f.dependencies.resolveItem(f.tx, bound, command);
  bound.merchantId = "changed"; command.command.args.variantId = "changed"; gate.resolve();
  assert.equal((await pending).unitPriceCents, 10000);
  const serialized = JSON.stringify(f.calls); assert.ok(!serialized.includes("changed"));
});
test("evaluate snapshots cart/scope before awaiting reads without mutating caller cart", async () => {
  const gate = deferred(), f = fixture({ beforeRead: gate.promise }), bound = scope(), value = cart();
  const pending = f.dependencies.evaluateRules(f.tx, bound, value);
  bound.merchantId = "changed"; value.items[0].quantity = 99; value.items[0].unitPriceCents = 1; value.total = 99; gate.resolve();
  const result = storefrontLocalCartCommercialOutcomeV1Schema.parse(await pending);
  assert.deepEqual({ discountCents: result.discountCents, freeShipping: result.freeShipping }, { discountCents: 3000, freeShipping: false });
  assert.equal(value.items[0].quantity, 99); assert.equal(value.total, 99);
  assert.ok(!JSON.stringify(f.calls).includes("changed"));
});
test("one stateless factory uses each supplied transaction without cross-tenant cache or captured client", async () => {
  const one = fixture(), two = fixture(); two.first.id = "second"; two.first.product.merchantId = "other-merchant";
  two.first.price.variantId = "second"; two.first.price.basePriceInCents = 5000;
  const reader = createPrismaStorefrontLocalCartEffectDependencies(), otherScope = { ...scope(), merchantId: "other-merchant" }, otherIntent = intent();
  otherIntent.command.args.variantId = "second";
  const result = await Promise.all([reader.resolveItem(one.tx, scope(), intent()), reader.resolveItem(two.tx, otherScope, otherIntent)]);
  assert.deepEqual(result.map(item => item.unitPriceCents), [10000, 5000]);
  assert.ok(!JSON.stringify(one.calls).includes("other-merchant"));
});
for (const field of ["payment_method", "trigger_fired"]) {
  test(`enabled ${field} condition cannot manufacture authority from missing-context null sentinel`, async () => {
    const f = fixture({ rules: [rule({ conditions: [{ field, operator: "eq", value: "null" }] })] }); await assert.rejects(f.evaluateLegacy());
  });
  test(`disabled well-formed ${field} condition remains inert`, async () => {
    const f = fixture({ rules: [rule({ enabled: false, conditions: [{ field, operator: "eq", value: "null" }] })] });
    assert.deepEqual(await f.evaluateLegacy(), noIncentive);
  });
  test(`enabled ${field} is unsupported even with a legitimate non-sentinel value`, async () => {
    const f = fixture({ rules: [rule({ conditions: [{ field, operator: "is", value: field === "payment_method" ? "pix" : "exit_intent" }] })] });
    await assert.rejects(f.evaluateLegacy());
  });
}
test("disabled malformed rule is still rejected rather than hidden as inert policy", async () => {
  const f = fixture({ rules: [rule({ enabled: false, conditions: [] })] }); await assert.rejects(f.evaluateLegacy());
});

test("approved legacy saved line remains S and B-S+D consumes the ceiling once, without a second P", async () => {
  const f = fixture({ promotions: [promo({ discountValue: 50 })], rules: [] }), value = cart();
  value.items[0]!.unitPriceCents = 9000; value.total = 18000; value.discount = 1000;
  const before = structuredClone(value), outcome = await f.evaluate(value);
  assert.equal(outcome.quote.originalSubtotalCents, 20000); assert.equal(outcome.quote.promotionDiscountCents, 2000);
  assert.equal(outcome.quote.subtotalCents, 18000); assert.equal(outcome.discountCents, 1000);
  assert.equal(outcome.quote.merchandiseTotalCents, 17000);
  assert.equal(outcome.quote.items[0]!.baseUnitPriceCents, 10000); assert.equal(outcome.quote.items[0]!.unitPriceCents, 9000);
  assert.deepEqual(value, before);
});
test("legacy above-cap reader warns without a clamp or mutation; saved price above B also reviews", async () => {
  const f = fixture({ rules: [] }), value = cart(); value.items[0]!.unitPriceCents = 7900; value.total = 15800;
  const before = structuredClone(value);
  await assert.rejects(f.evaluate(value), (error: { getStatus(): number }) => error.getStatus() === 409); assert.deepEqual(value, before);
  value.items[0]!.unitPriceCents = 10001; value.total = 20002;
  await assert.rejects(f.evaluate(value), (error: { getStatus(): number }) => error.getStatus() === 409);
});

