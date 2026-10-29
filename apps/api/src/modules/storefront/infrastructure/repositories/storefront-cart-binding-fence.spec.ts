import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PrismaStorefrontCartRepository } from "./prisma-storefront-cart.repository.js";
import { PrismaStorefrontCartUnitOfWork } from "./prisma-storefront-cart-unit-of-work.js";
import { PrismaStorefrontCrossSellCartAdapter } from "./prisma-storefront-cross-sell-cart.adapter.js";
import { withStorefrontCartInTransaction } from "./storefront-cart-transaction.js";
import { PrismaMarketplaceCartRepository } from "../../../marketplace/infrastructure/repositories/prisma-marketplace-cart.repository.js";
import { PrismaStorefrontCouponCartAdapter } from "./prisma-storefront-coupon-cart.adapter.js";

const merchantId = "synthetic-fence-merchant", cartId = "synthetic-fence-cart";
const binding = () => ({ version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId, cartId,
  checkoutSessionId: "synthetic-fence-checkout", buyerId: "synthetic-buyer", reservationBuyerId: null,
  redemptionId: "synthetic-redemption", couponId: "synthetic-coupon", discountCents: 100, basisHash: "ab".repeat(32), state: "active" });
const owner = () => ({ merchantId, sessionId: binding().checkoutSessionId, buyerId: binding().buyerId, cartRef: cartId, binding: binding() });
const row = () => ({ id: "synthetic-row", merchantId, sessionId: cartId, items: [{ variantId: "variant", productId: "product",
  sku: "SKU", name: "Synthetic", quantity: 1, unitPriceCents: 1000 }], total: 1000, discount: 100,
  couponCode: "SYNTHETIC", freeShipping: false, createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date(0) });

function fixture(options: { candidates?: unknown[]; isolation?: string; missing?: boolean; malformed?: unknown } = {}) {
  const calls: string[] = [], sqlCalls: Array<{ sql: string; values: unknown[] }> = [];
  const persisted = row();
  const tx = {
    async $executeRaw(parts:TemplateStringsArray) { calls.push(parts.join("?").includes("FROM merchants")?"normal-merchant-fence":"lock"); return 1; },
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      if(parts.join("?").includes("normal_checkout_source_read")){
        calls.push("normal-presence");sqlCalls.push({sql:parts.join("?"),values});
        assert.deepEqual(values,[merchantId,cartId]);
        return [{isolation:"read committed",candidates:[]}];
      }
      calls.push("discover"); sqlCalls.push({ sql: parts.join("?"), values });
      return options.malformed === undefined ? [{ isolation: options.isolation ?? "read committed", candidates: options.candidates ?? [owner()] }] : options.malformed;
    },
    storefrontCart: {
      async findUnique() { calls.push("read"); return options.missing ? null : structuredClone(persisted); },
      async upsert() { calls.push("upsert"); return structuredClone(persisted); },
      async update() { calls.push("write"); return structuredClone(persisted); },
    },
  };
  const prisma = { async $transaction<T>(work: (client: Prisma.TransactionClient) => Promise<T>) {
    calls.push("begin"); try { const value = await work(tx as unknown as Prisma.TransactionClient); calls.push("commit"); return value; }
    catch (error) { calls.push("rollback"); throw error; }
  } } as unknown as PrismaClient;
  const forbiddenCouponDependency = () => assert.fail("bound_cart_exposed_coupon_dependency");
  return { calls, sqlCalls, tx: tx as unknown as Prisma.TransactionClient, persisted,
    repo: new PrismaStorefrontCartRepository(prisma), uow: new PrismaStorefrontCartUnitOfWork(prisma), crossSell: new PrismaStorefrontCrossSellCartAdapter(prisma),
    marketplace: new PrismaMarketplaceCartRepository(prisma), coupons: new PrismaStorefrontCouponCartAdapter(prisma,
      { authorizeDiscount: forbiddenCouponDependency }, { couponsFor: forbiddenCouponDependency, transactionsFor: forbiddenCouponDependency,
        promotionsFor: forbiddenCouponDependency, readExistingRules: forbiddenCouponDependency }) };
}
const rejectsBound = (work: () => Promise<unknown>) => assert.rejects(work, /storefront_cart_checkout_bound/);
const rejectsConflict = (work: () => Promise<unknown>) => assert.rejects(work, /storefront_cart_binding_conflict/);

for (const name of ["addItem", "removeItem", "updateItemQuantity", "clear", "applyCoupon", "removeCoupon", "applyRuleOutcome"] as const) {
  test(`bound ${name} refuses before work, upsert and TTL`, async () => {
    const f = fixture();
    const operations = {
      addItem: () => f.repo.addItem(merchantId, cartId, row().items[0]),
      removeItem: () => f.repo.removeItem(merchantId, cartId, "variant"),
      updateItemQuantity: () => f.repo.updateItemQuantity(merchantId, cartId, "variant", 1),
      clear: () => f.repo.clear(merchantId, cartId),
      applyCoupon: () => f.repo.applyCoupon(merchantId, cartId, "SYNTHETIC", 100),
      removeCoupon: () => f.repo.removeCoupon(merchantId, cartId),
      applyRuleOutcome: () => f.repo.applyRuleOutcome(merchantId, cartId, { discountCents: 100, freeShipping: false }),
    };
    await rejectsBound(operations[name]);
    assert.deepEqual(f.calls, ["begin", "lock", "discover", "rollback"]);
  });
}
for (const state of ["active", "released", "redeemed"]) {
  test(`${state} binding read is a persisted snapshot, no TTL, work or reprice`, async () => {
    const candidate = owner(); candidate.binding.state = state;
    const f = fixture({ candidates: [{ ...candidate, binding: { ...candidate.binding, ...(state === "redeemed" ? { orderId: "synthetic-order" } : {}) } }] });
    assert.deepEqual(await f.repo.getOrCreate(merchantId, cartId), f.persisted);
    assert.deepEqual(f.calls, ["begin", "normal-merchant-fence", "normal-presence", "lock", "discover", "read", "commit"]);
    assert.equal(JSON.stringify(await f.repo.getOrCreate(merchantId, cartId)).includes("bindingId"), false);
  });
}
test("bound missing cart cannot be recreated", async () => {
  const f = fixture({ missing: true }); await rejectsConflict(() => f.repo.getOrCreate(merchantId, cartId));
  assert.deepEqual(f.calls, ["begin", "normal-merchant-fence", "normal-presence", "lock", "discover", "read", "rollback"]);
});
test("unbound getOrCreate preserves create/TTL behavior", async () => {
  const f = fixture({ candidates: [] }); await f.repo.getOrCreate(merchantId, cartId);
  assert.deepEqual(f.calls, ["begin", "normal-merchant-fence", "normal-presence", "lock", "discover", "upsert", "write", "commit"]);
});
test("UoW refuses before exposing transaction, even for a swallowed-error callback", async () => {
  const f = fixture(); let callback = false;
  await rejectsBound(() => f.uow.run({ merchantId, cartId }, async () => { callback = true; try { await f.repo.clear(merchantId, cartId); } catch {} }));
  assert.equal(callback, false); assert.deepEqual(f.calls, ["begin", "lock", "discover", "rollback"]);
});
test("enlisted writer refuses before invoking work without checkout locks", async () => {
  const f = fixture(); let invoked = false;
  await rejectsBound(() => withStorefrontCartInTransaction(f.tx, merchantId, cartId, async () => { invoked = true; }));
  assert.equal(invoked, false); assert.deepEqual(f.calls, ["lock", "discover"]);
});
test("marketplace add is fenced before stock, partner and order effects", async () => {
  const f = fixture(); await rejectsBound(() => f.marketplace.add({ merchantId, checkoutSessionId: cartId, sellerMerchantId: "synthetic-seller", federatedProductId: "synthetic-product", quantity: 1 }));
  assert.deepEqual(f.calls, ["begin", "lock", "discover", "rollback"]);
});
test("coupon apply is fenced before coupon reservation, dependencies and outbox", async () => {
  const f = fixture(); await rejectsBound(() => f.coupons.apply({ merchantId, cartId }, { code: "SYNTHETIC" }));
  assert.deepEqual(f.calls, ["begin", "lock", "discover", "rollback"]);
});
for (const operation of ["quote", "project", "projectForCheckout"] as const) {
  test(`cross-sell ${operation} refuses before commercial lookup`, async () => {
    const f = fixture();
    await rejectsBound(() => operation === "quote" ? f.crossSell.quote({ merchantId, cartId }, { variantId: "variant", promotionId: "promo", quantity: 1 })
      : f.crossSell[operation]({ merchantId, cartId }));
    assert.deepEqual(f.calls, operation === "quote"
      ? ["begin", "discover", "discover", "discover", "lock", "discover", "rollback"]
      : ["begin", "normal-merchant-fence", "normal-presence", "lock", "discover", "rollback"]);
  });
}
for (const patch of [
  { merchantId: "foreign" }, { sessionId: "foreign" }, { buyerId: "foreign" }, { cartRef: "foreign" },
  { binding: null }, { binding: { ...binding(), cartId: "foreign" } }, { binding: { ...binding(), extra: true } },
  { cartRef: 123 }, { binding: { ...binding(), merchantId: "foreign" } }, { binding: { ...binding(), buyerId: "foreign" } },
]) test(`malformed or mismatched owner conflicts: ${JSON.stringify(patch)}`, async () => {
  const f = fixture({ candidates: [{ ...owner(), ...patch }] }); await rejectsConflict(() => f.repo.clear(merchantId, cartId));
  assert.deepEqual(f.calls, ["begin", "lock", "discover", "rollback"]);
});
test("multiple owners are conflicts, not first-match admission", async () => {
  const f = fixture({ candidates: [owner(), owner()] }); await rejectsConflict(() => f.repo.clear(merchantId, cartId));
});
for (const isolation of ["repeatable read", "serializable"]) test(`${isolation} cannot silently reuse a stale pre-lock snapshot`, async () => {
  const f = fixture({ isolation, candidates: [] }); await rejectsConflict(() => f.repo.clear(merchantId, cartId));
  assert.deepEqual(f.calls, ["begin", "lock", "discover", "rollback"]);
});
test("discovery uses exact parameters, bounded projection, no checkout row lock or full cart", async () => {
  const f = fixture({ candidates: [] }); await f.repo.getOrCreate(merchantId, cartId);
  const query = f.sqlCalls.find(call=>!call.sql.includes("normal_checkout_source_read")); assert.ok(query);
  assert.deepEqual(query.values, [merchantId, cartId, cartId]);
  assert.match(query.sql, /LIMIT 101/i); assert.match(query.sql, /current_setting\('transaction_isolation'\)/);
  assert.doesNotMatch(query.sql, /FOR UPDATE|FOR SHARE|SELECT \*|customer|chat_history|pg_advisory/i);
});
for (const malformed of [[], null, [{}], [{ isolation: "read committed", candidates: null }]]) test(`invalid database projection fails closed: ${JSON.stringify(malformed)}`, async () => {
  const f = fixture({ malformed }); await rejectsConflict(() => f.repo.clear(merchantId, cartId));
});
