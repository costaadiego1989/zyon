import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { ApplyCouponUseCase } from "./apply-coupon.use-case.js";
import { RulesEngineDiscountAdapter } from "../../infrastructure/adapters/rules-engine-discount.adapter.js";
import { checkoutSession, merchantRules } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { readStorefrontCouponForCheckout } from "../../../../shared/persistence/storefront-coupon/admission.js";
import type { NormalCheckoutCouponReader } from "../../domain/ports/normal-checkout-coupon-reader.port.js";
import { toCheckoutSession } from "../../../checkout/domain/services/checkout-session-projection.js";

// Explicit transaction/delegate doubles; not native SQL, authentication or PSP
// proof. Real coupon command/repository/engine are used inside that transaction.
function fixture({ saved = 10000, verified = true, discountPercent = 10, cap = 20, paidOptions = false } = {}) {
  const now = new Date("2026-10-20T00:00:00Z"), calls: string[] = [];
  const canonical = paidOptions ? 11000 : 10000;
  const option = { groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 1000 };
  const rules = merchantRules({ maxDiscountPercent: cap });
  const row = { id: "checkout-row", ...checkoutSession({ merchantId: "merchant", sessionId: "checkout-id", globalUserId: "buyer", persistenceVersion: 4,
    customer: { email: "buyer@example.test", email_verified: verified, address: { city: "Synthetic", state: "SP", zip: "01310100" } },
    cart: { source: "storefront", cart_ref: "cart-id", currency: "BRL", total: saved / 100, currentDiscount: 0,
      ...(saved < canonical ? { discountBudget: { version: 1 as const, originalSubtotalCents: canonical, promotionDiscountCents: canonical - saved } } : {}),
      items: [{ variantId: "variant", product_id: "product", sku: "SKU", name: "Saved", price: saved / 100, quantity: 1,
        ...(saved < canonical ? { originalPrice: canonical / 100 } : {}),
        ...(paidOptions ? { variant: JSON.stringify(["variant", ["large"]]), selected_options: [{ group_name: "Tamanho", item_name: "Grande", price_modifier: 10 }] } : {}) }] } }), version: 4, createdAt: now, updatedAt: now };
  const source = { id: "source-row", merchantId: "merchant", sessionId: "cart-id", items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Saved", unitPriceCents: saved, quantity: 1,
    ...(paidOptions ? { selectedOptions: [option] } : {}) }],
    total: saved, discount: 0, couponCode: null as string | null, freeShipping: false, createdAt: now, updatedAt: now, expiresAt: new Date("2100-01-01") };
  const coupon = { id: "coupon", merchantId: "merchant", code: "SAVE", strategyIncentiveExecutionId: null, discountType: "percent", discountValue: discountPercent,
    minCartTotal: null, maxUsages: 1, maxPerBuyer: 1, usagesCount: 0, allowedSkus: [], blockedSkus: [], allowedRegions: [] as string[], blockedRegions: [] as string[],
    status: "active", startsAt: new Date(0), endsAt: new Date("2100-01-01"), createdAt: now, updatedAt: now };
  let current = { row: structuredClone(row), source: structuredClone(source), reservations: [] as Array<Record<string, unknown>>, outbox: [] as unknown[], events: [] as unknown[] };
  const variant = { id: "variant", productId: "product", sku: "SKU", isActive: true,
    product: { id: "product", merchantId: "merchant", isActive: true, deletedAt: null as Date | null, type: "physical", metadata: paidOptions
      ? { optionGroups: [{ id: "size", name: "Tamanho", required: false, selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 1000 }] }] } : {} },
    price: { variantId: "variant", basePriceInCents: 10000, costInCents: null, currency: "BRL" }, stock: [{ quantity: 100, reserved: 0 }] };
  let fail: "source" | "checkout" | "outbox" | "commit" | undefined, activePayment = false, usedQuota = 0,strictVersionTrigger=false;
  const tx = {
    async $executeRaw(parts: TemplateStringsArray, ...values: unknown[]) { calls.push(parts.join("?") + JSON.stringify(values)); return 1; },
    async $queryRaw(parts: TemplateStringsArray) { const sql = parts.join("?"); calls.push(sql);
      if (sql.includes("clock_timestamp")) return [{ now }];
      if (sql.includes("current_setting")) return [{ isolation: "read committed", candidates: [] }];
      if (sql.includes('FROM "coupons"')) return [{ maxUsages: 1, maxPerBuyer: 1, strategyIncentiveExecutionId: null }];
      if (sql.includes("FROM coupons")) return [{ id: "coupon" }];
      return [];
    },
    merchantRule: { findUnique: async () => ({ ...rules, merchantId: "merchant" }), upsert: async () => rules },
    checkoutSetting: { findUnique: async () => ({ merchantId: "merchant", advancedRules: [] }) },
    checkoutSession: { findUnique: async () => structuredClone(current.row), findUniqueOrThrow: async () => structuredClone(current.row),
      update: async ({ data }: { data: object }) => { current.row = { ...current.row, ...structuredClone(data), version: current.row.version + 1 }; return current.row; },
      updateMany: async ({ data }: { data: object }) => { if (fail === "checkout") return { count: 0 };
        if(strictVersionTrigger&&"version"in data&&data.version!==current.row.version)throw Error("CHECKOUT_SESSION_VERSION_READ_ONLY");
        current.row = { ...current.row, ...structuredClone(data),version:current.row.version+1 }; return { count: 1 }; } },
    storefrontCart: { findUnique: async () => structuredClone(current.source), updateMany: async ({ data }: { data: object }) => {
      if (fail === "source") return { count: 0 }; current.source = { ...current.source, ...structuredClone(data) }; return { count: 1 }; } },
    coupon: { findFirst: async () => coupon, findUnique: async () => coupon },
    couponRedemption: { findFirst: async () => current.reservations[0] ?? null,
      findUnique: async () => current.reservations[0] ?? null,
      findMany: async () => current.reservations.map(value => ({ ...value, discountApplied: new Prisma.Decimal(String(value.discountApplied)) })),
      count: async () => current.reservations.length + usedQuota,
      create: async ({ data }: { data: Record<string, unknown> }) => { calls.push("reservation-create");const row={...data,createdAt:now,updatedAt:now};current.reservations.push(row); return row; } },
    outboxMessage: { upsert: async ({ create }: { create: unknown }) => { if (fail === "outbox") throw Error("synthetic_outbox_failure"); current.outbox.push(create); return create; } },
    checkoutEvent: { findFirst: async () => null, create: async ({ data }: { data: unknown }) => { current.events.push(data); return data; } },
    completedOrder: { findFirst: async () => null }, paymentIntent: { findFirst: async () => activePayment ? { id: "active" } : null, findMany: async () => [] },
    strategyIncentiveAssignment: { findUnique: async () => null }, strategyAssignment: { findUnique: async () => null }, checkoutChatRequest: { findFirst: async () => null },
    productVariant: { findMany: async () => [variant] },
    productPrice: { findMany: async () => [{ variantId: "variant", basePriceInCents: 10000, currency: "BRL", costInCents: null,
      variant: { id: "variant", productId: "product", sku: "SKU", isActive: true, product: { merchantId: "merchant", metadata: {}, isActive: true, deletedAt: null } } }] },
  };
  const prisma = { async $transaction<T>(work: (value: typeof tx) => Promise<T>) { calls.push("transaction"); const before = structuredClone(current);
    try { const result = await work(tx); if (fail === "commit") throw Error("synthetic_commit_unknown"); return result; } catch (error) { current = before; throw error; } } };
  const useCase = new ApplyCouponUseCase({} as never, {} as never, new RulesEngineDiscountAdapter(), prisma as unknown as PrismaClient);
  return { useCase, tx, source, calls, coupon, variant, rules,
    withReader:(reader:NormalCheckoutCouponReader<Prisma.TransactionClient>)=>new ApplyCouponUseCase({}as never,{}as never,new RulesEngineDiscountAdapter(),prisma as unknown as PrismaClient,reader),
    state: () => structuredClone(current), fail: (value: typeof fail) => { fail = value; },
    change: (edit: (value: typeof current) => void) => edit(current), quota: () => { usedQuota = 1; },versionTrigger:()=>{strictVersionTrigger=true;},
    stock: (value: number) => { variant.stock[0]!.quantity = value; }, payment: () => { activePayment = true; } };
}
const request = { merchant_id: "merchant", session_id: "checkout-id", code: "SAVE", expectedVersion: 4 };
test("source coupon writer respects the database-owned version and verifies exactly one increment",async()=>{
  const f=fixture();f.versionTrigger();const result=await f.useCase.executeForCheckout(request);
  assert.equal(result.session.persistenceVersion,5);assert.equal(f.state().row.version,5);
});

test("normal-intent coupon application stays closed without the composition-only same-TX reader",async()=>{
  const f=fixture();f.change(state=>Reflect.set(state.row.cart.items[0]!,"crossSellIntent",{version:1}));
  await assert.rejects(f.useCase.executeForCheckout(request));assert.equal(f.state().reservations.length,0);assert.equal(f.state().source.discount,0);
});
test("source coordinator calls the internal normal reader before reservation and after both CAS writes",async()=>{
  // Coordinator seam test only: canonical normal provenance itself is covered
  // by authority/native tests. This explicit callback is not a SQL proof.
  const f=fixture();f.change(state=>Reflect.set(state.row.cart.items[0]!,"crossSellIntent",{version:1}));
  const seen:number[]=[];
  const command=f.withReader(async(tx,scope)=>{assert.equal(tx,f.tx);assert.deepEqual(scope,{merchantId:"merchant",sessionId:"checkout-id"});
    const stored=await f.tx.checkoutSession.findUnique();seen.push(stored.version);return toCheckoutSession(stored);});
  const result=await command.executeForCheckout(request);assert.deepEqual(seen,[4,5]);
  assert.equal(result.session.cart.currentDiscount,10);assert.equal(f.state().reservations[0]!.sessionId,"cart-id");
});
test("post-reserve canonical reader disagreement rolls back source/session/reservation/event as one transaction",async()=>{
  const f=fixture();f.change(state=>Reflect.set(state.row.cart.items[0]!,"crossSellIntent",{version:1}));
  const before=f.state();let reads=0;
  const command=f.withReader(async()=>{const session=toCheckoutSession(await f.tx.checkoutSession.findUnique());
    if(++reads===2)session.cart.currentDiscount=999;return session;});
  await assert.rejects(command.executeForCheckout(request));assert.deepEqual(f.state(),before);
});

test("normal storefront checkout reserves the real cartId and commits source plus checkout together", async () => {
  const f = fixture(), result = await f.useCase.executeForCheckout(request), after = f.state();
  assert.equal(after.reservations.length, 1); assert.equal(after.reservations[0]!.sessionId, "cart-id");
  assert.equal(after.source.couponCode, "SAVE"); assert.equal(after.source.discount, 1000); assert.equal(result.session.cart.currentDiscount, 10);
  assert.equal(after.row.cart.currentDiscount, 10); assert.equal(after.row.version, 5); assert.equal(result.session.persistenceVersion, 5);
  assert.equal(after.outbox.length, 1); assert.equal(after.events.length, 1); assert.equal(f.calls.filter(call => call === "transaction").length, 1);
  const candidate = await readStorefrontCouponForCheckout(f.tx as never, result.session, { requireVerifiedBuyer: true, requireRegion: true });
  assert.equal(candidate?.cartId, "cart-id"); assert.equal(candidate?.checkoutSessionId, "checkout-id");
});

test("saved P0 and the new coupon D share the ceiling without source repricing", async () => {
  const f = fixture({ saved: 9000, discountPercent: 50 }), result = await f.useCase.executeForCheckout(request), after = f.state();
  assert.equal(result.result.discount_applied, 10); assert.equal(after.source.items[0]!.unitPriceCents, 9000); assert.equal(after.source.total, 9000);
  assert.equal(after.source.discount, 1000); assert.equal(result.session.cart.total - result.session.cart.currentDiscount!, 80);
  assert.equal(result.session.cart.commercialNotices?.[0]?.code,"discount_limit_reached");
});

for (const kind of ["unverified", "stock", "payment", "version"] as const) test(`source checkout coupon rejects ${kind} before reserve/source mutation`, async () => {
  const f = fixture({ verified: kind !== "unverified" }); if (kind === "stock") f.stock(0); if (kind === "payment") f.payment();
  const expected = { unverified: "COUPON_BUYER_IDENTITY_REQUIRED", stock: "checkout_insufficient_stock", payment: "CHECKOUT_COUPON_SESSION_NOT_MUTABLE", version: "CHECKOUT_SESSION_VERSION_CONFLICT" };
  const before = f.state(); await assert.rejects(f.useCase.executeForCheckout({ ...request, expectedVersion: kind === "version" ? 3 : 4 }), (error: Error) => {
    assert.equal(error.message, expected[kind]); return true;
  });
  assert.deepEqual(f.state(), before);
});

for (const stage of ["source", "checkout", "outbox", "commit"] as const) test(`one source coupon transaction rolls back ${stage} failure without retry`, async () => {
  const f = fixture(); f.fail(stage); const before = f.state(); await assert.rejects(f.useCase.executeForCheckout(request), (error: Error) => {
    assert.equal(error.message, { source: "As condições do cupom mudaram. Revise o pedido antes de pagar.", checkout: "CHECKOUT_SESSION_VERSION_CONFLICT",
      outbox: "synthetic_outbox_failure", commit: "synthetic_commit_unknown" }[stage]); return true;
  });
  assert.deepEqual(f.state(), before); assert.equal(f.calls.filter(call => call === "transaction").length, 1);
});

for (const change of ["source tenant", "source sum", "source expired", "existing source D", "source free shipping", "buyer absent", "options mismatch",
  "foreign catalog", "deleted catalog", "invalid stock", "stale nominal B", "stale paid option B", "quota", "blocked region"] as const) {
  test(`new checkout source coupon refuses ${change} without any reservation`, async () => {
    const f = fixture({ paidOptions: change === "stale paid option B" });
    if (change === "source tenant") f.change(value => { value.source.merchantId = "foreign"; });
    if (change === "source sum") f.change(value => { value.source.total++; });
    if (change === "source expired") f.change(value => { value.source.expiresAt = new Date(0); });
    if (change === "existing source D") f.change(value => { value.source.discount = 1; });
    if (change === "source free shipping") f.change(value => { value.source.freeShipping = true; });
    if (change === "buyer absent") f.change(value => { value.row.globalUserId = ""; });
    if (change === "options mismatch") f.change(value => { value.row.cart.items[0]!.variant = JSON.stringify(["variant", ["unknown"]]); });
    if (change === "foreign catalog") f.variant.product.merchantId = "foreign";
    if (change === "deleted catalog") f.variant.product.deletedAt = new Date(0);
    if (change === "invalid stock") f.stock(Number.NaN);
    if (change === "stale nominal B") f.variant.price.basePriceInCents++;
    if (change === "stale paid option B") f.variant.product.metadata.optionGroups![0]!.items[0]!.priceModifierInCents++;
    if (change === "quota") f.quota();
    if (change === "blocked region") f.coupon.blockedRegions = ["SP"];
    const before = f.state(); await assert.rejects(f.useCase.executeForCheckout(request), (error: Error) => {
      assert.ok(["As condições do cupom mudaram. Revise o pedido antes de pagar.", "checkout_coupon_binding_conflict",
        "COUPON_EXHAUSTED", "COUPON_REGION_BLOCKED"].includes(error.message), error.name); return true;
    });
    assert.deepEqual(f.state(), before); assert.equal(f.calls.includes("reservation-create"), false);
  });
}

test("paid options belong to B and P0+D share its headroom, without changing source options", async () => {
  const f = fixture({ paidOptions: true, discountPercent: 50 }), before = f.state().source;
  const { result, session } = await f.useCase.executeForCheckout(request), after = f.state();
  assert.equal(result.discount_applied, 12); assert.equal(session.cart.total - session.cart.currentDiscount!, 88);
  assert.deepEqual(after.source.items, before.items); assert.equal(after.source.total, before.total);
  assert.equal(after.reservations[0]!.buyerGlobalUserId, "buyer");
});

test("source and checkout may reorder two selections of the same variant without donating P0 across options", async () => {
  const f = fixture({ paidOptions: true, discountPercent: 50 });
  f.variant.product.metadata.optionGroups![0]!.items.push({ id: "small", name: "Pequeno", priceModifierInCents: 0 });
  f.change(value => {
    value.source.items.push({ ...value.source.items[0]!, selectedOptions: [{ groupId: "size", groupName: "Tamanho", itemId: "small", itemName: "Pequeno", priceModifierInCents: 0 }] });
    value.source.total = 20000;
    value.row.cart.items.unshift({ ...value.row.cart.items[0]!, originalPrice: 100, variant: JSON.stringify(["variant", ["small"]]),
      selected_options: [{ group_name: "Tamanho", item_name: "Pequeno", price_modifier: 0 }] });
    value.row.cart.total = 200; value.row.cart.discountBudget = { version: 1, originalSubtotalCents: 21000, promotionDiscountCents: 1000 };
  });
  const before = f.state().source.items, { result, session } = await f.useCase.executeForCheckout(request);
  assert.equal(result.discount_applied, 32); assert.equal(session.cart.total - session.cart.currentDiscount!, 168);
  assert.deepEqual(f.state().source.items, before);
});

test("configuration, checkout, cart, catalog and coupon locks remain ordered", async () => {
  const f = fixture(); await f.useCase.executeForCheckout(request);
  const position = (text: string) => f.calls.findIndex(call => call.includes(text));
  for (const token of ["FROM merchants", "FROM merchant_rules", "FROM checkout_settings", "FROM checkout_sessions", "storefront-cart", "FROM products", "FROM product_stock", "FROM coupons"])
    assert.ok(position(token) >= 0, token);
  const tokens = ["FROM merchants", "FROM merchant_rules", "FROM checkout_settings", "FROM checkout_sessions", "storefront-cart", "FROM products", "FROM product_stock", "FROM coupons"];
  for (let i = 1; i < tokens.length; i++) assert.ok(position(tokens[i - 1]!) < position(tokens[i]!), tokens[i]);
});

test("a storage error during source projection is not reclassified as commercial review or retried", async () => {
  const f = fixture({ saved: 9000 }), fault = new Error("synthetic_catalog_storage_failure"), before = f.state();
  f.tx.productVariant.findMany = async () => { throw fault; };
  await assert.rejects(f.useCase.executeForCheckout(request), error => error === fault);
  assert.deepEqual(f.state(), before); assert.equal(f.calls.includes("reservation-create"), false);
  assert.equal(f.calls.filter(call => call === "transaction").length, 1);
});
