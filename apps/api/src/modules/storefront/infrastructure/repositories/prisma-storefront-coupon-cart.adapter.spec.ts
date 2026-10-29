import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaStorefrontCouponCartAdapter } from "./prisma-storefront-coupon-cart.adapter.js";
import { RulesEngineDiscountAdapter } from "../../../coupons/infrastructure/adapters/rules-engine-discount.adapter.js";
import { PrismaCouponRepository } from "../../../coupons/infrastructure/repositories/prisma-coupon.repository.js";
import { PrismaCouponTransactionRepository } from "../../../coupons/infrastructure/repositories/prisma-coupon-transaction.repository.js";
import { PrismaProductPromotionRepository } from "../../../catalog/infrastructure/repositories/prisma-product-promotion.repository.js";
import { readExistingPrismaMerchantRules } from "../../../merchant/infrastructure/prisma-merchant.repository.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";

// Explicit delegate/rollback simulation. NOT native SQL isolation/concurrency proof.
const cart = (): StorefrontCart => ({ id: "row", merchantId: "merchant", sessionId: "cart", createdAt: new Date(0), updatedAt: new Date(0),
  items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Item", quantity: 1, unitPriceCents: 10000 }],
  total: 10000, discount: 0, couponCode: null, freeShipping: false });
const coupon = () => ({ id: "coupon", merchantId: "merchant", code: "COUPON", strategyIncentiveExecutionId: null as string | null,
  discountType: "percent", discountValue: new Prisma.Decimal(10), minCartTotal: null, freeShippingMinCartTotal: null,
  maxUsages: null as number | null, minPerBuyer: null, maxPerBuyer: null as number | null, usagesCount: 0,
  allowedSkus: [] as string[], blockedSkus: [] as string[], allowedRegions: [] as string[], blockedRegions: [] as string[],
  status: "active", startsAt: new Date(0), endsAt: new Date("2100-01-01"), createdAt: new Date(0), updatedAt: new Date(0) });
const policy = () => ({ merchantId: "merchant", maxDiscountPercent: new Prisma.Decimal(20), minimumMarginPercent: new Prisma.Decimal(10),
  allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: new Prisma.Decimal(0), maxShippingSubsidy: new Prisma.Decimal(0), maxPartialShippingDiscount: new Prisma.Decimal(0),
  offerExpirationMinutes: 15, blockedRegions: [], brandVoice: "consultative", couponBoxEnabled: true, autonomousEngineEnabled: true,
  originZip: null, quickReplies: null, cryptoPayments: null });
function fixture() {
  let saved = cart(), redemptions: Record<string, unknown>[] = [], outbox: unknown[] = [];
  const transactionClients: Prisma.TransactionClient[] = [];
  const dependencyClients: Array<{ name: string; tx: Prisma.TransactionClient }> = [];
  const calls: Array<{ step: string; args?: unknown }> = [], promotionRows: unknown[] = [];
  const currentCoupon = coupon(), currentPolicy = policy(), failure = new Error("synthetic_database_failure");
  let failAt: "cart" | "outbox" | "read" | "commit" | undefined, policyMissing = false, cost: number | null = 2000;
  const generationAt=new Date("2026-10-20T12:00:00.123Z");
  let generationFault:"missing"|"invalid"|"foreign-id"|undefined;
  const generation=(row:Record<string,unknown>)=>({id:generationFault==="foreign-id"?"foreign-reservation":row.id,
    ...(generationFault==="missing"?{}:{updatedAt:generationFault==="invalid"?new Date(NaN):row.updatedAt})});
  let beforeTransaction: Promise<void> | undefined;
  const prisma = { async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    calls.push({ step: "begin" }); const pause = beforeTransaction; beforeTransaction = undefined; await pause;
    let working = structuredClone(saved), rows = structuredClone(redemptions), events = [...outbox];
    const tx = {
      async $executeRaw(_parts: TemplateStringsArray, ...args: unknown[]) { calls.push({ step: "cart-lock", args }); return 1; },
      async $queryRaw(parts: TemplateStringsArray, ...args: unknown[]) { const sql = parts.join("?");
        if (sql.includes("current_setting('transaction_isolation')")) return [{ isolation: "read committed", candidates: [] }];
        calls.push({ step: "coupon-lock", args });
        assert.match(sql, /FROM\s+"?coupons"?/); assert.match(sql, /FOR UPDATE/);
        return [{ id: currentCoupon.id, maxUsages: currentCoupon.maxUsages, maxPerBuyer: currentCoupon.maxPerBuyer, strategyIncentiveExecutionId: currentCoupon.strategyIncentiveExecutionId }]; },
      storefrontCart: { async findUnique() { calls.push({ step: "cart-read" }); if (failAt === "read") throw failure; return structuredClone(working); },
        async upsert() { calls.push({ step: "cart-read" }); return structuredClone(working); },
        async update(args: { data: Partial<StorefrontCart> }) { calls.push({ step: "cart-write", args }); if (failAt === "cart") throw failure;
          working = { ...working, ...structuredClone(args.data) }; return structuredClone(working); } },
      coupon: { async findUnique(args: unknown) { calls.push({ step: "coupon-read", args }); return currentCoupon; } },
      couponRedemption: { async findFirst(args: unknown) { calls.push({ step: "active-reservation", args }); const active = rows.find(row => row.status !== "cancelled"); return active ? { id: active.id } : null; },
        async findUnique(args: unknown) { calls.push({ step: "existing-redemption", args }); return rows[0] ?? null; },
        async count(args: unknown) { calls.push({ step: "count", args }); return rows.filter(row => row.status !== "cancelled").length; },
        async create(args: { data: Record<string, unknown>;select?:unknown }) { calls.push({ step: "reserve", args });
          assert.deepEqual(args.select,{id:true,updatedAt:true});
          const row={...structuredClone(args.data),createdAt:new Date(generationAt.getTime()),updatedAt:new Date(generationAt.getTime())};rows.push(row);return generation(row); },
        async update(args: { data: Record<string, unknown>;select?:unknown }) { calls.push({ step: "reserve-update", args });
          assert.deepEqual(args.select,{id:true,updatedAt:true});Object.assign(rows[0],args.data,{updatedAt:new Date(generationAt.getTime())});return generation(rows[0]!); } },
      outboxMessage: { async upsert(args: unknown) { calls.push({ step: "outbox", args }); if (failAt === "outbox") throw failure; events.push(args); return args; } },
      merchantRule: { async findUnique(args: unknown) { calls.push({ step: "policy", args }); return policyMissing ? null : currentPolicy; } },
      merchant: { async findUnique(args: unknown) { calls.push({ step: "merchant", args }); return { storeSettings: {} }; } },
      productPrice: { async findMany(args: unknown) { calls.push({ step: "cost", args }); return [{ variantId: "variant", costInCents: cost, basePriceInCents: 10000,
        variant: { sku: "SKU", productId: "product", product: { categoryId: null } } }]; } },
      productVariant: { async findFirst(args: unknown) { calls.push({ step: "catalog", args }); return { id: "variant", sku: "SKU", productId: "product", isActive: true,
        product: { id: "product", merchantId: "merchant", categoryId: null, isActive: true, deletedAt: null } }; } },
      productPromotion: { async findMany(args: unknown) { calls.push({ step: "promotion", args }); return promotionRows; } },
    };
    const transactionClient = tx as unknown as Prisma.TransactionClient;
    transactionClients.push(transactionClient);
    try { const result = await work(transactionClient); saved = working; redemptions = rows; outbox = events;
      calls.push({ step: "commit" }); if (failAt === "commit") throw failure; return result; }
    catch (error) { calls.push({ step: "rollback-or-unknown" }); throw error; }
  } } as unknown as PrismaClient;
  const dependencies = {
    couponsFor(tx: Prisma.TransactionClient) { dependencyClients.push({ name: "coupons", tx }); return new PrismaCouponRepository(tx); },
    transactionsFor(tx: Prisma.TransactionClient) { dependencyClients.push({ name: "transactions", tx }); return new PrismaCouponTransactionRepository(tx, true); },
    promotionsFor(tx: Prisma.TransactionClient) { dependencyClients.push({ name: "promotions", tx }); return new PrismaProductPromotionRepository(tx); },
    readExistingRules(tx: Prisma.TransactionClient, merchantId: string) { dependencyClients.push({ name: "rules", tx }); return readExistingPrismaMerchantRules(tx, merchantId); },
  };
  return { adapter: new PrismaStorefrontCouponCartAdapter(prisma, new RulesEngineDiscountAdapter(), dependencies), calls, currentCoupon, currentPolicy, promotionRows, failure,
    transactionClients, dependencyClients,
    saved: () => structuredClone(saved), redemptions: () => structuredClone(redemptions), outbox: () => [...outbox],
    changeCart: (change: (cart: StorefrontCart) => void) => change(saved), seedReservation: () => redemptions.push({ id: "legacy", status: "applied", couponId: "old" }),
    fail: (stage: typeof failAt) => { failAt = stage; }, missingPolicy: () => { policyMissing = true; }, setCost: (value: number | null) => { cost = value; },
    failGeneration:(kind:typeof generationFault)=>{generationFault=kind;},generationAt,
    pause: (value: Promise<void>) => { beforeTransaction = value; } };
}
const scope = { merchantId: "merchant", cartId: "cart" };
test("coupon, reservation, promotion and policy dependencies receive exactly the cart transaction client", async () => {
  const f = fixture();
  assert.equal((await f.adapter.apply(scope, { code: "COUPON" })).applied, true);
  assert.equal(f.transactionClients.length, 1);
  assert.deepEqual(f.dependencyClients.map(call => call.name), ["coupons", "rules", "promotions", "transactions"]);
  for (const call of f.dependencyClients) assert.equal(call.tx, f.transactionClients[0]);
});
test("atomic coupon uses cart-before-coupon lock and commits reservation/outbox/cart together with unchanged envelope", async () => {
  const f = fixture(), result = await f.adapter.apply(scope, { code: " coupon " });
  assert.equal(result.applied, true); if (!result.applied) assert.fail("expected_applied");
  assert.equal(result.discountCents, 1000); assert.equal(result.newTotal, 90); assert.equal(result.total, 100);
  assert.equal(f.saved().items[0].unitPriceCents, 10000); assert.equal(f.saved().discount, 1000); assert.equal(f.saved().couponCode, "COUPON");
  assert.equal(f.redemptions().length, 1); assert.equal(f.outbox().length, 1); assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
  const steps = f.calls.map(call => call.step); assert.ok(steps.indexOf("cart-lock") < steps.indexOf("coupon-lock"));
  assert.ok(steps.indexOf("coupon-lock") < steps.indexOf("coupon-read")); assert.ok(steps.indexOf("outbox") < steps.indexOf("cart-write"));
  assert.equal(JSON.stringify(result).includes('"cost"'), false);
});

test("atomic coupon application event references the exact persisted reservation generation",async()=>{
  const f=fixture();assert.equal((await f.adapter.apply(scope,{code:"COUPON"})).applied,true);
  const row=f.redemptions()[0]!,event=f.outbox()[0]as{create:{merchantId:string;payload:Record<string,unknown>}};
  assert.equal(event.create.merchantId,scope.merchantId);assert.equal(event.create.payload.session_id,scope.cartId);
  assert.equal(event.create.payload.redemption_id,row.id);assert.equal(event.create.payload.reservation_updated_at,f.generationAt.toISOString());
  assert.deepEqual(row.updatedAt,f.generationAt);
});

for(const fault of ["missing","invalid","foreign-id"]as const)
  test(`atomic coupon refuses ${fault} reservation generation and rolls back without event/cart/retry`,async()=>{
    const f=fixture(),before=f.saved();f.failGeneration(fault);
    await assert.rejects(f.adapter.apply(scope,{code:"COUPON"}),/^Error: coupon_reservation_generation_unavailable$/);
    assert.deepEqual(f.saved(),before);assert.equal(f.redemptions().length,0);assert.equal(f.outbox().length,0);
    assert.equal(f.calls.some(call=>call.step==="cart-write"||call.step==="outbox"),false);
    assert.equal(f.calls.filter(call=>call.step==="begin").length,1);
  });
for (const reason of ["cost", "margin", "policy", "zero-cap", "buyer", "allowed-region", "blocked-region", "paused", "expired", "strategy", "active-reservation", "cross-sell", "tenant"])
  test(reason === "cost" || reason === "margin" ? `atomic coupon preserves the ceiling without ${reason} eligibility` : `atomic coupon refuses ${reason} without reservation/outbox/cart or TTL effects`, async () => {
    const f = fixture();
    if (reason === "cost") f.setCost(null);
    if (reason === "margin") f.setCost(9500);
    if (reason === "policy") f.missingPolicy();
    if (reason === "zero-cap") f.currentPolicy.maxDiscountPercent = new Prisma.Decimal(0);
    if (reason === "buyer") f.currentCoupon.maxPerBuyer = 1;
    if (reason === "allowed-region") f.currentCoupon.allowedRegions = ["SP"];
    if (reason === "blocked-region") f.currentCoupon.blockedRegions = ["SP"];
    if (reason === "paused") f.currentCoupon.status = "paused";
    if (reason === "expired") f.currentCoupon.endsAt = new Date(1);
    if (reason === "strategy") f.currentCoupon.strategyIncentiveExecutionId = "strategy";
    if (reason === "active-reservation") f.seedReservation();
    if (reason === "cross-sell") f.changeCart(cart => { cart.items[0].crossSellIntent = { version: 1, promotionId: "p", promotionUpdatedAt: "2026-10-18T00:00:00Z", acceptedQuantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 }; });
    if (reason === "tenant") f.changeCart(cart => { cart.merchantId = "foreign"; });
    const before = f.saved(), result = await f.adapter.apply(scope, { code: "COUPON" });
    if (reason === "cost" || reason === "margin") {
      assert.equal(result.applied, true); if (!result.applied) assert.fail("expected_applied");
      assert.equal(result.discountCents, 1000); assert.equal(f.saved().discount, 1000);
      assert.equal(f.redemptions().length, 1); assert.equal(f.outbox().length, 1);
      return;
    }
    assert.equal(result.applied, false);
    assert.deepEqual(f.saved(), before); assert.equal(f.outbox().length, 0); assert.equal(f.calls.some(call => call.step === "reserve" || call.step === "cart-write"), false);
  });
for (const stage of ["read", "cart", "outbox"] as const) test(`${stage} failure preserves original cart and rolls back synthetic reservations/outbox without retry`, async () => {
  const f = fixture(), before = f.saved(); f.fail(stage);
  await assert.rejects(f.adapter.apply(scope, { code: "COUPON" }), error => error === f.failure);
  assert.deepEqual(f.saved(), before); assert.equal(f.redemptions().length, 0); assert.equal(f.outbox().length, 0);
  assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
});
test("lost commit acknowledgement is unknown, never a definite refusal or automatic replay", async () => {
  const f = fixture(); f.fail("commit"); await assert.rejects(f.adapter.apply(scope, { code: "COUPON" }), error => error === f.failure);
  assert.equal(f.saved().discount, 1000); assert.equal(f.redemptions().length, 1); assert.equal(f.outbox().length, 1);
});
test("trusted buyer is passed to reservation and buyer usage count", async () => {
  const f = fixture(); f.currentCoupon.maxPerBuyer = 2;
  assert.equal((await f.adapter.apply(scope, { code: "COUPON", trustedBuyerGlobalUserId: "verified-buyer" })).applied, true);
  assert.equal(f.redemptions()[0].buyerGlobalUserId, "verified-buyer");
  assert.ok(f.calls.some(call => call.step === "count" && (call.args as { where: { buyerGlobalUserId?: string } }).where.buyerGlobalUserId === "verified-buyer"));
});
test("input is detached before awaiting transaction admission", async () => {
  const f = fixture(); let resume!: () => void; f.pause(new Promise<void>(resolve => { resume = resolve; }));
  const request = { code: "COUPON", trustedBuyerGlobalUserId: "original-buyer" }, pending = f.adapter.apply(scope, request);
  request.code = "OTHER"; request.trustedBuyerGlobalUserId = "mutated-buyer"; resume();
  assert.equal((await pending).applied, true); assert.equal(f.redemptions()[0].buyerGlobalUserId, "original-buyer");
});

test("scope is detached before awaiting admission and cannot donate the reservation/event to another tenant or cart",async()=>{
  const f=fixture();let resume!:()=>void;f.pause(new Promise<void>(resolve=>{resume=resolve;}));
  const mutableScope={...scope},pending=f.adapter.apply(mutableScope,{code:"COUPON"});
  mutableScope.merchantId="foreign-merchant";mutableScope.cartId="foreign-cart";resume();
  assert.equal((await pending).applied,true);const row=f.redemptions()[0]!;
  assert.equal(row.merchantId,scope.merchantId);assert.equal(row.sessionId,scope.cartId);
  const event=f.outbox()[0]as{create:{merchantId:string;payload:Record<string,unknown>}};
  assert.equal(event.create.merchantId,scope.merchantId);assert.equal(event.create.payload.session_id,scope.cartId);
});
test("coupon eligibility uses current catalog SKU, never a stale remembered cart SKU", async () => {
  const f = fixture(); f.changeCart(cart => { cart.items[0].sku = "STALE-SKU"; }); f.currentCoupon.allowedSkus = ["STALE-SKU"];
  const result = await f.adapter.apply(scope, { code: "COUPON" }); assert.equal(result.applied, false); assert.equal(result.reason, "COUPON_SKU_NOT_ALLOWED");
  assert.equal(f.redemptions().length, 0); assert.equal(f.calls.some(call => call.step === "cart-write"), false);
});
const promotion = (percent: number) => ({ id: "product-promotion", merchantId: "merchant", variantId: "variant", productId: null,
  categoryId: null, couponId: null, discountType: "percent", discountValue: percent, promoPriceInCents: null,
  isActive: true, startsAt: new Date(0), endsAt: new Date("2100-01-01"), createdAt: new Date(0), updatedAt: new Date(0) });
test("actual product promotion reaching the global ceiling refuses extra coupon before reservation", async () => {
  const f = fixture(), before = f.saved(); f.promotionRows.push(promotion(20));
  const result = await f.adapter.apply(scope, { code: "COUPON" }); assert.equal(result.applied, false); assert.equal(result.reason, "discount_limit_reached");
  assert.deepEqual(f.saved(), before); assert.equal(f.redemptions().length, 0); assert.equal(f.outbox().length, 0);
});
test("atomic coupon shares the original global P+D budget and persists base plus only D", async () => {
  const f = fixture(); f.promotionRows.push(promotion(15));
  const result = await f.adapter.apply(scope, { code: "COUPON" }); assert.equal(result.applied, true); if (!result.applied) assert.fail("expected_applied");
  assert.equal(result.items[0].unitPrice, 85); assert.equal(result.items[0].originalPrice, 100);
  assert.equal(result.discountCents, 500); assert.equal(result.total, 85); assert.equal(result.newTotal, 80);
  assert.equal(f.saved().items[0].unitPriceCents, 10000); assert.equal(f.saved().discount, 500);
  assert.equal(f.redemptions()[0].discountApplied, 5); assert.equal(f.outbox().length, 1);
});

