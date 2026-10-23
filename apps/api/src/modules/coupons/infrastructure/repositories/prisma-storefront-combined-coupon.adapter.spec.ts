import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { StorefrontCart } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { PrismaStorefrontCombinedCouponAdapter } from "./prisma-storefront-combined-coupon.adapter.js";
import { PrismaStorefrontCartRepository } from "../../../storefront/infrastructure/repositories/prisma-storefront-cart.repository.js";
import { PrismaOutboxRepository } from "../../../../shared/messaging/infrastructure/prisma-outbox.repository.js";

const at = new Date("2026-10-20T12:00:00.000Z");
const option = { groupId: "options", groupName: "Size", itemId: "large", itemName: "Large", priceModifierInCents: 500 };
const initial = (): StorefrontCart & { expiresAt: Date } => ({ id: "row", merchantId: "merchant", sessionId: "cart", createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date("2100-01-01"),
  total: 15000, discount: 0, couponCode: null, freeShipping: false, items: [
    { variantId: "host", productId: "product-host", sku: "HOST", name: "Host", quantity: 1, unitPriceCents: 10000 },
    { variantId: "target", productId: "product-target", sku: "TARGET", name: "Target", quantity: 1, unitPriceCents: 5000, selectedOptions: [option],
      crossSellIntent: { version: 1, promotionId: "promotion", promotionUpdatedAt: "2026-10-18T00:00:00.000Z", acceptedQuantity: 1,
        originalUnitPriceCents: 5000, maximumUnitPriceCents: 4000, selectedOptionItemIds: ["large"] } },
  ] });
const variant = (id: string) => ({ id, sku: id.toUpperCase(), isActive: true,
  product: { id: "product-" + id, merchantId: "merchant", name: id === "host" ? "Host" : "Target", type: "physical", metadata: id === "host" ? {} : { optionGroups: [
    { id: "options", name: "Size", required: true, selectionType: "single", items: [{ id: "large", name: "Large", priceModifierInCents: 500 }] }] },
    isActive: true, deletedAt: null, categoryId: null },
  price: { variantId: id, currency: "BRL", basePriceInCents: id === "host" ? 10000 : 4500, costInCents: null as number | null }, stock: [{ quantity: 20, reserved: 0 }] });
const policy = () => ({ merchantId: "merchant", maxDiscountPercent: new Prisma.Decimal(20), minimumMarginPercent: new Prisma.Decimal(99),
  allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: new Prisma.Decimal(0), maxShippingSubsidy: new Prisma.Decimal(0), maxPartialShippingDiscount: new Prisma.Decimal(0),
  offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "consultative", couponBoxEnabled: true, autonomousEngineEnabled: true });
const coupon = () => ({ id: "coupon", merchantId: "merchant", code: "COUPON", strategyIncentiveExecutionId: null as string | null,
  discountType: "percent", discountValue: new Prisma.Decimal(10), minCartTotal: null, freeShippingMinCartTotal: null,
  maxUsages: null as number | null, minPerBuyer: null, maxPerBuyer: null as number | null, usagesCount: 0,
  allowedSkus: [] as string[], blockedSkus: [] as string[], allowedRegions: [] as string[], blockedRegions: [] as string[],
  status: "active", startsAt: new Date(0), endsAt: new Date("2100-01-01"), createdAt: new Date(0), updatedAt: new Date(0) });
function project(value: unknown, selection?: Record<string, unknown>): unknown {
  if (value == null || !selection) return value;
  if (Array.isArray(value)) return value.map(row => project(row, selection));
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(selection).map(([key, field]) => [key,
    field === true ? row[key] : project(row[key], (field as { select: Record<string, unknown> }).select)]));
}

// Serialized transactional delegates, real existing writer/reservation/reader.
// This is NOT native PostgreSQL lock, isolation, rollback or race proof.
function fixture() {
  let stored = initial(), reserves: Record<string, unknown>[] = [], events: unknown[] = [], tail = Promise.resolve();
  const variants = [variant("host"), variant("target")], rules = policy(), currentCoupon = coupon(), calls: string[] = [];
  const promo = { id: "promotion", merchantId: "merchant", updatedAt: new Date("2026-10-18T00:00:00Z"), startsAt: new Date(0), endsAt: new Date("2100-01-01"),
    status: "active", recommendedSkus: ["TARGET"], discountPercent: new Prisma.Decimal(20), maxDiscountPercent: new Prisma.Decimal(20), trigger: { sku_in_cart: ["HOST"] } };
  let failureAt: "cart" | "outbox" | "commit" | "read" | "release" | undefined, quota = 0, owners: unknown[] = [], missingRules = false;
  const failure = new Error("synthetic_db_failure"), settings: unknown[] = [];
  const prisma = { async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    calls.push("begin"); let working = structuredClone(stored), rows = structuredClone(reserves), outbox = [...events];
    const tx = { async $executeRaw() { calls.push("cart-fence"); return 1; },
      async $queryRaw(parts: TemplateStringsArray) { const sql = parts.join("?");
        if (sql.includes("FROM merchants")) { calls.push("merchant-fence"); return [{ id: "merchant" }]; }
        if (sql.includes("FROM merchant_rules")) { calls.push("rules-fence"); return []; }
        if (sql.includes("FROM checkout_settings")) { calls.push("settings-fence"); return []; }
        if (sql.includes("clock_timestamp")) { calls.push("db-clock"); return [{ now: at, isolation: "read committed" }]; }
        if (sql.includes("current_setting")) return [{ isolation: "read committed", candidates: owners }];
        if (sql.includes("coupons") && sql.includes("FOR UPDATE")) { calls.push("coupon-fence"); return sql.includes("max_usages") ? [{
          maxUsages: currentCoupon.maxUsages, maxPerBuyer: currentCoupon.maxPerBuyer, strategyIncentiveExecutionId: currentCoupon.strategyIncentiveExecutionId }] : [{ id: currentCoupon.id }]; }
        calls.push("catalog-fence"); return []; },
      storefrontCart: { async findUnique() { calls.push("cart-read"); if (failureAt === "read") throw failure; return structuredClone(working); },
        async upsert() { calls.push("cart-upsert"); return structuredClone(working); },
        async update(args: { data: Partial<StorefrontCart> }) { calls.push("cart-write"); if (failureAt === "cart") throw failure;
          working = { ...working, ...structuredClone(args.data) }; return structuredClone(working); } },
      productVariant: { async findMany(args: { where: { id?: { in: string[] }; sku?: string }; select: Record<string, unknown> }) {
        calls.push("catalog-read"); return project(variants.filter(row => args.where.id ? args.where.id.in.includes(row.id) : row.sku === args.where.sku), args.select); },
        async findFirst(args: { where: { id: string }; select: Record<string, unknown> }) { calls.push("stock-read"); return project(variants.find(row => row.id === args.where.id), args.select); } },
      productPromotion: { async findMany() { return []; } }, crossSellPromotion: { async findMany(args: { select: Record<string, unknown> }) { return project([promo], args.select); } },
      merchantRule: { async findUnique(args: { select?: Record<string, unknown> }) { return missingRules ? null : project(rules, args.select); } },
      checkoutSetting: { async findUnique() { return settings.length ? { merchantId: "merchant", advancedRules: settings } : null; } },
      coupon: { async findUnique() { calls.push("coupon-read"); return currentCoupon; }, async findFirst() { calls.push("coupon-read"); return currentCoupon; } },
      couponRedemption: { async findFirst() { return rows.length ? { ...rows[0], discountApplied: new Prisma.Decimal(String(rows[0]!.discountApplied)) } : null; },
        async findMany(args: { where: { status?: { not: string } } }) { calls.push("reservation-read");
          return rows.filter(row => row.status !== args.where.status?.not).map(row => ({ ...row, discountApplied: new Prisma.Decimal(String(row.discountApplied)) })); },
        async findUnique() { return rows[0] ?? null; }, async count() { calls.push("quota"); return rows.filter(row => row.status !== "cancelled").length + quota; },
        async create(args: { data: Record<string, unknown> }) { calls.push("reserve");const row={...args.data,createdAt:at,updatedAt:at}; rows.push(structuredClone(row)); return row; },
        async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
          calls.push("release"); if (failureAt === "release") throw failure;
          const matching = rows.filter(row => Object.entries(args.where).every(([key, value]) => key === "discountApplied"
            ? new Prisma.Decimal(String(row[key])).eq(value as Prisma.Decimal) : row[key] === value));
          for (const row of matching) Object.assign(row, args.data);
          return { count: matching.length };
        } },
      outboxMessage: { async upsert(args: unknown) { calls.push("outbox"); if (failureAt === "outbox") throw failure; outbox.push(args); return args; },
        async findFirst(args: { where: Record<string, unknown>; select?: Record<string, unknown> }) {
          calls.push("receipt-read");
          const row = outbox.map(event => (event as { create: Record<string, unknown> }).create)
            .find(event => Object.entries(args.where).every(([key, value]) => event[key] === value));
          return row ? project(structuredClone(row), args.select) : null;
        } },
    };
    try { const result = await work(tx as unknown as Prisma.TransactionClient); stored = working; reserves = rows; events = outbox; calls.push("commit");
      if (failureAt === "commit") throw failure; return result; } catch (error) { calls.push("rollback-or-unknown"); throw error; } finally { release(); }
  } } as unknown as PrismaClient;
  return { adapter: new PrismaStorefrontCombinedCouponAdapter(prisma), generic: new PrismaStorefrontCartRepository(prisma), calls, variants, rules, promo, currentCoupon, failure, settings,
    stored: () => structuredClone(stored), reserves: () => structuredClone(reserves), events: () => [...events],
    mutate: (work: (cart: StorefrontCart & { expiresAt: Date }) => void) => work(stored), reserve: (row: Record<string, unknown>) => { reserves.push(row); },
    mutateReservation: (change: (row: Record<string, unknown>) => void) => change(reserves[0]!),
    quota: (n: number) => { quota = n; }, fail: (atStage: typeof failureAt) => { failureAt = atStage; }, missingRules: () => { missingRules = true; },
    bind: () => { owners = [{ broken: true }]; } };
}
const scope = { merchantId: "merchant", cartId: "cart", trustedBuyerGlobalUserId: "buyer" };
const request = { code: " coupon " };
const release = { operationId: "a5537938-7496-4ea4-94b4-ec872a418337", action: "remove_coupon" as const, expectedCouponCode: "COUPON" };

for (const action of ["remove_coupon", "clear"] as const) test("explicit lifecycle atomically releases exact D and preserves normal cart writer: " + action, async () => {
  const f = fixture(); await f.adapter.apply(scope, request);
  const result = await f.adapter.mutate(scope, { ...release, action });
  assert.equal(result.kind, "lifecycle_recorded"); assert.equal(result.couponReleased, true);
  assert.equal(f.stored().couponCode, null); assert.equal(f.stored().discount, 0);
  assert.equal(f.stored().items.length, action === "clear" ? 0 : 2);
  assert.equal(f.reserves().length, 1); assert.equal(f.reserves()[0]!.status, "cancelled");
  assert.equal(f.reserves()[0]!.discountApplied, 14); assert.equal(f.reserves()[0]!.orderId, null);
  assert.equal(f.currentCoupon.usagesCount, 0); assert.equal(f.calls.filter(call => call === "release").length, 1);
  assert.equal(f.events().length, 2);
  const receipt = (f.events()[1] as { create: Record<string, unknown> }).create;
  assert.equal(receipt.eventType, "storefront.coupon.lifecycle-recorded");
  assert.equal(receipt.producer, "storefront-coupon-lifecycle");
  assert.equal(receipt.status, "recorded"); assert.equal(receipt.deliveredAt, undefined); assert.equal(receipt.publishedAt, undefined);
  assert.equal(JSON.stringify(receipt).includes("checkoutSessionId"), false);
});

test("explicit release-and-remove reuses bound selection and leaves remaining merchandise without coupon", async () => {
  const f = fixture(); await f.adapter.apply(scope, request);
  const result = await f.adapter.mutate(scope, { ...release, action: "remove_coupon_and_item", variantId: "target", selector: { optionItemIds: ["large"] } });
  assert.equal(result.kind, "lifecycle_recorded"); assert.equal(result.itemCount, 1);
  assert.equal(f.stored().items[0]!.variantId, "host"); assert.equal(f.stored().couponCode, null);
  assert.equal(f.reserves()[0]!.status, "cancelled");
  await f.generic.removeItem("merchant", "cart", "host");
  assert.equal(f.stored().items.length, 0); assert.equal(f.reserves()[0]!.status, "cancelled");
});

test("receipt replay after unknown commit never clears newly added items or releases twice", async () => {
  const f = fixture(); await f.adapter.apply(scope, request); f.fail("commit");
  await assert.rejects(f.adapter.mutate(scope, { ...release, action: "clear" }), error => error === f.failure);
  f.fail(undefined); f.mutate(cart => { cart.items = [initial().items[0]!]; cart.total = 10000; });
  const before = f.stored(), rows = f.reserves(), events = f.events(), writes = f.calls.filter(call => call === "cart-write").length;
  const replay = await f.adapter.mutate(scope, { ...release, action: "clear" });
  assert.equal(replay.itemCount, 0); assert.equal(replay.totalCents, 0);
  assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows); assert.deepEqual(f.events(), events);
  assert.equal(f.calls.filter(call => call === "cart-write").length, writes);
  assert.equal(f.calls.filter(call => call === "release").length, 1);
});

test("same scoped operation cannot replay different action, selection, coupon or trusted buyer", async () => {
  const f = fixture(); await f.adapter.apply(scope, request); await f.adapter.mutate(scope, release);
  const before = f.stored(), events = f.events();
  for (const input of [{ ...release, action: "clear" as const }, { ...release, expectedCouponCode: "OTHER" },
    { ...release, action: "remove_coupon_and_item" as const, variantId: "target" }]) await assert.rejects(f.adapter.mutate(scope, input));
  await assert.rejects(f.adapter.mutate({ ...scope, trustedBuyerGlobalUserId: "foreign" }, release));
  assert.deepEqual(f.stored(), before); assert.deepEqual(f.events(), events);
});

for (const stage of ["release", "cart", "outbox"] as const) test("lifecycle failure rolls reservation/cart/receipt back together: " + stage, async () => {
  const f = fixture(); await f.adapter.apply(scope, request); const before = f.stored(), rows = f.reserves(), events = f.events(); f.fail(stage);
  await assert.rejects(f.adapter.mutate(scope, { ...release, action: "clear" }), error => error === f.failure);
  assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows); assert.deepEqual(f.events(), events);
});

test("two serialized same-operation lifecycle callers produce one cancellation and one receipt", async () => {
  const f = fixture(); await f.adapter.apply(scope, request);
  const [first, second] = await Promise.all([f.adapter.mutate(scope, release), f.adapter.mutate(scope, release)]);
  assert.deepEqual(first, second); assert.equal(f.calls.filter(call => call === "release").length, 1); assert.equal(f.events().length, 2);
});

test("different-operation release/clear race cannot clear a source after the release winner", async () => {
  const f = fixture(); await f.adapter.apply(scope, request);
  const results = await Promise.allSettled([f.adapter.mutate(scope, release), f.adapter.mutate(scope,
    { ...release, operationId: "b5537938-7496-4ea4-94b4-ec872a418337", action: "clear" })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.stored().items.length, 2); assert.equal(f.calls.filter(call => call === "release").length, 1);
});

for (const [name, change] of [
  ["changed catalog", (f: ReturnType<typeof fixture>) => { f.variants[1]!.price.basePriceInCents++; }],
  ["foreign buyer", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.buyerGlobalUserId = "other"; })],
  ["wrong D", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.discountApplied = 13; })],
  ["redeemed", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.status = "redeemed"; row.orderId = "order"; })],
  ["checkout owned", (f: ReturnType<typeof fixture>) => f.bind()],
  ["corrupt single-line trigger", (f: ReturnType<typeof fixture>) => f.mutate(cart => { cart.items = [cart.items[1]!]; cart.total = 5000; })],
] as const) test("lifecycle refuses before releasing quota or losing benefit: " + name, async () => {
  const f = fixture(); await f.adapter.apply(scope, request); change(f); const before = f.stored(), rows = f.reserves(), events = f.events();
  await assert.rejects(f.adapter.mutate(scope, { ...release, action: "clear" }));
  assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows); assert.deepEqual(f.events(), events);
  assert.equal(f.calls.includes("release"), false);
});

test("lifecycle snapshots input before awaits and rejects unknown fields before transaction", async () => {
  const f = fixture(); await f.adapter.apply(scope, request);
  await assert.rejects(f.adapter.mutate(scope, { ...release, discountCents: 0 } as typeof release));
  const input = { ...release }; const pending = f.adapter.mutate(scope, input); input.expectedCouponCode = "FORGED";
  assert.equal((await pending).kind, "lifecycle_recorded");
});

for (const field of ["status", "producer", "eventType", "merchantId", "fingerprint", "cartId"] as const)
test("technical receipt cannot be reinterpreted with forged " + field, async () => {
  const f = fixture(); await f.adapter.apply(scope, request); await f.adapter.mutate(scope, release);
  const receipt = (f.events()[1] as { create: Record<string, unknown> }).create;
  if (field === "fingerprint" || field === "cartId") (receipt.payload as Record<string, unknown>)[field] = "forged";
  else receipt[field] = field === "status" ? "pending" : "forged";
  const before = f.stored(), rows = f.reserves(), writes = f.calls.filter(call => call === "cart-write").length;
  await assert.rejects(f.adapter.mutate(scope, release));
  assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows);
  assert.equal(f.calls.filter(call => call === "cart-write").length, writes);
});

test("generic outbox SQL claims only pending/expired-processing, never technical recorded rows", async () => {
  const statements: string[] = [];
  const tx = { async $executeRaw(query: Prisma.Sql) { statements.push(query.sql); return 0; },
    async $queryRaw(query: Prisma.Sql) { statements.push(query.sql); return []; } };
  const prisma = { async $transaction<T>(work: (inner: typeof tx) => Promise<T>) { return work(tx); } };
  assert.deepEqual(await new PrismaOutboxRepository(prisma as unknown as PrismaClient).claimBatch(2), []);
  assert.equal(statements.length, 2);
  for (const sql of statements) {
    assert.match(sql, /"status" = 'pending'/); assert.match(sql, /"status" = 'processing'/);
    assert.doesNotMatch(sql, /'recorded'/);
  }
  // SQL shape evidence only; native harness must prove actual DB exclusion.
});

test("clear-first race cannot release the same reservation again through another operation", async () => {
  const f = fixture(); await f.adapter.apply(scope, request);
  const results = await Promise.allSettled([f.adapter.mutate(scope, { ...release, action: "clear" }),
    f.adapter.mutate(scope, { ...release, operationId: "c5537938-7496-4ea4-94b4-ec872a418337" })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.stored().items.length, 0); assert.equal(f.events().length, 2); assert.equal(f.calls.filter(call => call === "release").length, 1);
});

test("same real transaction preserves P+D and accepted line, reserves exact D once using existing V1 writer", async () => {
  const f = fixture(), result = await f.adapter.apply(scope, request);
  assert.equal(result.applied, true); if (!result.applied) return;
  assert.equal(result.discountCents, 1400); assert.equal(result.quote.promotionDiscountCents, 1000); assert.equal(result.quote.merchandiseTotalCents, 12600);
  assert.equal(f.stored().total, 15000); assert.equal(f.stored().items[1]!.unitPriceCents, 5000);
  assert.deepEqual(f.stored().items[1]!.selectedOptions, [option]); assert.equal(f.stored().items[1]!.crossSellIntent?.maximumUnitPriceCents, 4000);
  assert.equal(f.stored().couponCode, "COUPON"); assert.equal(f.stored().discount, 1400);
  assert.equal(f.reserves().length, 1); assert.equal(f.reserves()[0]!.sessionId, "cart"); assert.equal(f.reserves()[0]!.discountApplied, 14);
  assert.equal(f.events().length, 1); assert.equal(f.calls.filter(x => x === "begin").length, 1);
  assert.equal(JSON.stringify(result).includes("cost"), false); assert.equal(JSON.stringify(result).includes("redemption"), false);
});

test("fences merchant/rules before cart; coupon/catalog before current canonical clock and writes", async () => {
  const f = fixture(); await f.adapter.apply(scope, request); const c = f.calls;
  assert.ok(c.indexOf("merchant-fence") < c.indexOf("cart-fence")); assert.ok(c.indexOf("rules-fence") < c.indexOf("cart-fence"));
  assert.ok(c.indexOf("cart-fence") < c.indexOf("coupon-fence")); assert.ok(c.indexOf("coupon-fence") < c.indexOf("catalog-fence"));
  assert.ok(c.indexOf("catalog-fence") < c.indexOf("db-clock")); assert.ok(c.indexOf("reserve") < c.indexOf("cart-write"));
});

test("joint ceiling caps ONLY new coupon D and shows notice without lowering accepted cross-sell", async () => {
  const f = fixture(); f.rules.maxDiscountPercent = new Prisma.Decimal(10);
  const result = await f.adapter.apply(scope, request); assert.equal(result.applied, true); if (!result.applied) return;
  assert.equal(result.discountCents, 500); assert.equal(result.quote.promotionDiscountCents, 1000);
  assert.equal(result.commercialNotices?.[0]?.code, "discount_limit_reached"); assert.equal(f.reserves()[0]!.discountApplied, 5);
});

test("already attained company ceiling yields notice and no fake zero goods reservation", async () => {
  const f = fixture(); f.rules.maxDiscountPercent = new Prisma.Decimal("6.6667"); const before = f.stored();
  const result = await f.adapter.apply(scope, request); assert.equal(result.applied, false);
  assert.equal(result.commercialNotices?.[0]?.code, "discount_limit_reached"); assert.equal(f.reserves().length, 0); assert.equal(f.events().length, 0); assert.deepEqual(f.stored(), before);
});

for (const [name, mutate] of [
  ["cross-sell stale", (f: ReturnType<typeof fixture>) => { f.promo.updatedAt = new Date(1); }],
  ["cross-sell expired", (f: ReturnType<typeof fixture>) => { f.promo.endsAt = new Date("2026-10-20T11:59:59Z"); }],
  ["option changed", (f: ReturnType<typeof fixture>) => { f.variants[1]!.price.basePriceInCents++; }],
  ["stock", (f: ReturnType<typeof fixture>) => { f.variants[1]!.stock[0]!.quantity = 0; }],
  ["foreign tenant", (f: ReturnType<typeof fixture>) => { f.variants[1]!.product.merchantId = "foreign"; }],
  ["foreign coupon", (f: ReturnType<typeof fixture>) => { f.currentCoupon.merchantId = "foreign"; }],
  ["expired source", (f: ReturnType<typeof fixture>) => { f.mutate(cart => { cart.expiresAt = new Date(1); }); }],
  ["existing shipping", (f: ReturnType<typeof fixture>) => { f.mutate(cart => { cart.freeShipping = true; }); }],
  ["existing unknown D", (f: ReturnType<typeof fixture>) => { f.mutate(cart => { cart.discount = 100; }); }],
  ["existing coupon", (f: ReturnType<typeof fixture>) => { f.mutate(cart => { cart.couponCode = "OTHER"; }); }],
  ["coupon expired", (f: ReturnType<typeof fixture>) => { f.currentCoupon.endsAt = new Date("2026-10-20T11:59:59Z"); }],
  ["coupon strategy", (f: ReturnType<typeof fixture>) => { f.currentCoupon.strategyIncentiveExecutionId = "strategy"; }],
  ["coupon region", (f: ReturnType<typeof fixture>) => { f.currentCoupon.allowedRegions = ["SP"]; }],
  ["shipping-only D0 needs complete quote provenance", (f: ReturnType<typeof fixture>) => { f.currentCoupon.discountType = "shipping_free"; }],
] as const) test("refuses without dropping existing benefit or reserving: " + name, async () => {
  const f = fixture(); mutate(f); const before = f.stored();
  assert.equal((await f.adapter.apply(scope, request)).applied, false);
  assert.deepEqual(f.stored(), before); assert.equal(f.reserves().length, 0); assert.equal(f.events().length, 0); assert.equal(f.calls.includes("cart-write"), false);
});

for (const stage of ["cart", "outbox", "read"] as const) test("actual existing writer/repository failures roll back draft at " + stage, async () => {
  const f = fixture(), before = f.stored(); f.fail(stage);
  await assert.rejects(f.adapter.apply(scope, request), error => error === f.failure);
  assert.deepEqual(f.stored(), before); assert.equal(f.reserves().length, 0); assert.equal(f.events().length, 0);
  assert.equal(f.calls.filter(x => x === "begin").length, 1);
});

test("commit acknowledgement unknown never becomes retry or definite refusal", async () => {
  const f = fixture(); f.fail("commit"); await assert.rejects(f.adapter.apply(scope, request), error => error === f.failure);
  assert.equal(f.stored().discount, 1400); assert.equal(f.reserves().length, 1); assert.equal(f.events().length, 1); assert.equal(f.calls.filter(x => x === "begin").length, 1);
});

test("two serialized callers cannot reserve or finance same source twice", async () => {
  const f = fixture(); const results = await Promise.allSettled([f.adapter.apply(scope, request), f.adapter.apply(scope, request)]);
  assert.equal(results.filter(result => result.status === "fulfilled" && result.value.applied).length, 1);
  assert.equal(f.reserves().length, 1); assert.equal(f.events().length, 1);
});

test("default generic writer still cannot launder a combined coupon through JSON intent", async () => {
  const f = fixture(); await f.adapter.apply(scope, request); const before = f.stored();
  await assert.rejects(f.generic.applyCoupon("merchant", "cart", "OTHER", 1)); assert.deepEqual(f.stored(), before);
});

test("scope-only reader repeats canonical price after lost ACK without reserve/cart/TTL effects", async () => {
  const f = fixture(); f.fail("commit"); await assert.rejects(f.adapter.apply(scope, request), error => error === f.failure); f.fail(undefined);
  const before = f.stored(), rows = f.reserves(), events = f.events(), writes = f.calls.filter(call => call === "cart-write").length;
  const result = await f.adapter.read(scope); assert.equal(result.applied, true); if (!result.applied) return;
  assert.equal(result.discountCents, 1400); assert.equal(result.quote.merchandiseTotalCents, 12600);
  assert.equal(result.quote.items[1]!.unitPriceCents, 4000); assert.equal(result.quote.items[1]!.baseUnitPriceCents, 5000);
  assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows); assert.deepEqual(f.events(), events);
  assert.equal(f.calls.filter(call => call === "cart-write").length, writes);
  result.quote.items[1]!.unitPriceCents = 1; const reread = await f.adapter.read(scope);
  if (reread.applied) assert.equal(reread.quote.items[1]!.unitPriceCents, 4000);
});

for (const [name, change] of [
  ["foreign reserve", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.sessionId = "other"; })],
  ["foreign tenant", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.merchantId = "other"; })],
  ["foreign buyer", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.buyerGlobalUserId = "other"; })],
  ["wrong D", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.discountApplied = 13.99; })],
  ["redeemed reserve", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.status = "redeemed"; row.orderId = "order"; })],
  ["cancelled reserve", (f: ReturnType<typeof fixture>) => f.mutateReservation(row => { row.status = "cancelled"; })],
  ["changed price", (f: ReturnType<typeof fixture>) => { f.variants[1]!.price.basePriceInCents++; }],
  ["changed maximum", (f: ReturnType<typeof fixture>) => { f.rules.maxDiscountPercent = new Prisma.Decimal(10); }],
  ["changed coupon", (f: ReturnType<typeof fixture>) => { f.currentCoupon.discountValue = new Prisma.Decimal(1); }],
  ["canonical SKU mismatch", (f: ReturnType<typeof fixture>) => f.mutate(cart => { cart.items[0]!.sku = "FORGED"; })],
] as const) test("read fails closed without repairing durable source: " + name, async () => {
  const f = fixture(); await f.adapter.apply(scope, request); change(f); const before = f.stored(), rows = f.reserves(), events = f.events();
  await assert.rejects(f.adapter.read(scope)); assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows); assert.deepEqual(f.events(), events);
});

test("real reservation protocol enforces global and buyer quotas before any cart write", async () => {
  for (const buyerLimit of [false, true]) {
    const f = fixture(); if (buyerLimit) f.currentCoupon.maxPerBuyer = 1; else f.currentCoupon.maxUsages = 1;
    f.quota(1); const before = f.stored(); const result = await f.adapter.apply(scope, request);
    assert.equal(result.applied, false); assert.equal(result.reason, "coupon_limit_reached");
    assert.deepEqual(f.stored(), before); assert.equal(f.reserves().length, 0); assert.equal(f.events().length, 0);
  }
});

test("automatic coupon-dependent rule is not hidden by the merchandise reconstruction", async () => {
  const f = fixture(); f.settings.push({ enabled: true, conditions: [{ field: "coupon_applied", operator: "eq", value: true }],
    action: { type: "offer_discount", params: { percent: 5 } }, priority: 1 });
  const before = f.stored(); assert.equal((await f.adapter.apply(scope, request)).applied, false);
  assert.deepEqual(f.stored(), before); assert.equal(f.reserves().length, 0);
});

test("absent buyer cannot claim buyer-bound quota; historical cancelled generation is not reactivated", async () => {
  const f = fixture(); f.currentCoupon.maxPerBuyer = 1;
  assert.equal((await f.adapter.apply({ merchantId: "merchant", cartId: "cart" }, request)).applied, false);
  f.currentCoupon.maxPerBuyer = null; f.reserve({ id: "old", status: "cancelled", couponId: "coupon" });
  assert.equal((await f.adapter.apply(scope, request)).applied, false); assert.equal(f.reserves()[0]!.id, "old"); assert.equal(f.events().length, 0);
});

test("input scope and selector are copied before the first await; caller cannot smuggle a receipt", async () => {
  const f = fixture(), callerScope = { ...scope }, callerRequest = { code: "COUPON" };
  const pending = f.adapter.apply(callerScope, callerRequest); callerScope.cartId = "other"; callerScope.trustedBuyerGlobalUserId = "other"; callerRequest.code = "OTHER";
  assert.equal((await pending).applied, true); assert.equal(f.reserves()[0]!.buyerGlobalUserId, "buyer");
  await assert.rejects(f.adapter.apply(scope, { code: "COUPON", _binding: "fake" } as unknown as { code: string }));
});

for (const unknown of [undefined, null, Number.NaN, -1, 1.5, "unknown"]) test("analytic cost/margin do not gate real transactional composition: " + String(unknown), async () => {
  const f = fixture();
  if (unknown === undefined) { Reflect.deleteProperty(f.rules, "minimumMarginPercent"); Reflect.deleteProperty(f.variants[1]!.price, "costInCents"); }
  else { Reflect.set(f.rules, "minimumMarginPercent", unknown); Reflect.set(f.variants[1]!.price, "costInCents", unknown); }
  const result = await f.adapter.apply(scope, request); assert.equal(result.applied, true);
  if (result.applied) { assert.equal(result.discountCents, 1400); assert.equal(result.quote.promotionDiscountCents, 1000); }
});

test("financial projection does not even evaluate analytic getters", async () => {
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.rules, "minimumMarginPercent", { enumerable: true, get() { reads++; throw new Error("private-margin"); } });
  Object.defineProperty(f.variants[1]!.price, "costInCents", { enumerable: true, get() { reads++; throw new Error("private-cost"); } });
  const result = await f.adapter.apply(scope, request); assert.equal(result.applied, true); assert.equal(reads, 0);
});

test("canonical DB clock drives coupon windows and fixed coupon retains exact ceiling allocation", async () => {
  const f = fixture(); f.currentCoupon.startsAt = at; f.currentCoupon.endsAt = at;
  f.currentCoupon.discountType = "fixed"; f.currentCoupon.discountValue = new Prisma.Decimal(20);
  const result = await f.adapter.apply(scope, request); assert.equal(result.applied, true); if (!result.applied) return;
  assert.equal(result.discountCents, 2000); assert.equal(result.quote.merchandiseTotalCents, 12000);
  assert.equal(result.commercialNotices?.[0]?.code, "discount_limit_reached"); assert.equal(f.reserves()[0]!.discountApplied, 20);
});

test("SKU ambiguity and existing checkout ownership remain hard refusals", async () => {
  const f = fixture(); const ambiguous = variant("duplicate"); ambiguous.sku = "TARGET"; f.variants.push(ambiguous);
  assert.equal((await f.adapter.apply(scope, request)).applied, false); assert.equal(f.reserves().length, 0);
  const bound = fixture(); bound.bind(); await assert.rejects(bound.adapter.apply(scope, request)); assert.equal(bound.reserves().length, 0);
});

test("generic clear cannot orphan an actual combined coupon reservation", async () => {
  const f = fixture(); await f.adapter.apply(scope, request); const before = f.stored(), rows = f.reserves(), events = f.events();
  await assert.rejects(f.generic.clear("merchant", "cart")); assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows); assert.deepEqual(f.events(), events);
});

test("generic removal of final accepted line cannot zero D and leave reservation alive", async () => {
  const f = fixture(); assert.equal((await f.adapter.apply(scope, request)).applied, true);
  // Deliberately reduced legacy/corrupt source AFTER a valid two-line
  // application. It is not a fresh valid quote or a new cross-sell trigger.
  // Generic removal must not erase it while its exact real reserve remains.
  f.mutate(cart => { cart.items = [cart.items[1]!]; cart.total = 5000; });
  const before = f.stored(), rows = f.reserves(), events = f.events();
  await assert.rejects(f.generic.removeItem("merchant", "cart", "target", { optionItemIds: ["large"] }));
  assert.deepEqual(f.stored(), before); assert.deepEqual(f.reserves(), rows); assert.deepEqual(f.events(), events);
});
