import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { inspectNativePrismaClient, assertNativePrismaUrl } from "./native-prisma-admission-guards.mjs";

const [url, runId] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
const parsed = assertNativePrismaUrl(url);
assert.equal(parsed.searchParams.get("application_name"), `aacp_write_native_${runId}`);
assert.match(runId, /^[a-f0-9-]{36}$/);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_binding_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
const { PrismaStorefrontCartUnitOfWork } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart-unit-of-work.ts");
const { PrismaStorefrontCrossSellCartAdapter } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.ts");
const { PrismaStorefrontCouponCartAdapter } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-coupon-cart.adapter.ts");
const { PrismaMarketplaceCartRepository } = await import("../src/modules/marketplace/infrastructure/repositories/prisma-marketplace-cart.repository.ts");
const { lockStorefrontCart, withStorefrontCartInTransaction } = await import("../src/modules/storefront/infrastructure/repositories/storefront-cart-transaction.ts");
const { lockCheckoutSessionAnchor } = await import("../src/shared/persistence/checkout-session-lock.ts");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [], transactionOptions: { timeout: 20_000, maxWait: 15_000 } });
const repo = new PrismaStorefrontCartRepository(prisma), uow = new PrismaStorefrontCartUnitOfWork(prisma), cross = new PrismaStorefrontCrossSellCartAdapter(prisma);
const merchantId = "synthetic-merchant", cartId = "synthetic-binding-cart", checkoutSessionId = "synthetic-binding-checkout";
const scope = { merchantId, cartId }, key = "_storefrontCouponBinding";
const item = () => ({ variantId: "synthetic-variant", productId: "synthetic-product", sku: "SYNTHETIC", name: "Synthetic only", unitPriceCents: 1000, quantity: 1 });
const binding = (patch = {}) => ({ version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId, cartId, checkoutSessionId,
  buyerId: "synthetic-buyer", reservationBuyerId: null, couponId: "synthetic-coupon", redemptionId: "synthetic-redemption", discountCents: 100, basisHash: "ab".repeat(32), state: "active", ...patch });
const rawCart = () => prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const insertBinding = (tx, value = binding(), rowMerchant = merchantId, rowSession = checkoutSessionId, cartRef = cartId) =>
  tx.$executeRaw`INSERT INTO checkout_sessions(merchant_id,session_id,global_user_id,cart)
    VALUES (${rowMerchant},${rowSession},${value?.buyerId ?? "synthetic-buyer"},${JSON.stringify({ cart_ref: cartRef, [key]: value })}::jsonb)`;
// Explicit SYNTHETIC ISSUER SIMULATOR only. Not application handoff, reservation
// authentication, customer hydration, payment admission or real coupon release.
async function simulateIssuer(tx, expected, value = binding()) {
  await lockCheckoutSessionAnchor(tx, merchantId, checkoutSessionId);
  await lockStorefrontCart(tx, merchantId, cartId);
  const cart = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } });
  if (!isDeepStrictEqual(cart?.items, expected.items)) throw new Error("synthetic_issuer_snapshot_changed");
  await insertBinding(tx, value);
}
const seed = async () => {
  await prisma.$executeRaw`TRUNCATE checkout_sessions,storefront_carts,synthetic_cart_proof`;
  await repo.addItem(merchantId, cartId, item());
  await repo.applyCoupon(merchantId, cartId, "SYNTHETIC", 100);
};
const snapshot = async () => ({ cart: await rawCart(), writes: await prisma.$queryRaw`SELECT last_value,is_called FROM synthetic_binding_cart_writes`,
  checkout: await prisma.$queryRaw`SELECT * FROM checkout_sessions ORDER BY merchant_id,session_id`,
  proofs: await prisma.$queryRaw`SELECT * FROM synthetic_cart_proof ORDER BY id`,
  proofAttempts: await prisma.$queryRaw`SELECT last_value,is_called FROM synthetic_cart_proof_attempts` });
const boundError = error => error?.message === "storefront_cart_checkout_bound";
const conflictError = error => error?.message === "storefront_cart_binding_conflict";
async function waitForCartWaiters(expected) {
  const lock = JSON.stringify(["storefront-cart", merchantId, cartId]), deadline = Date.now() + 9000;
  let observed = 0;
  do {
    observed = Number((await prisma.$queryRaw`SELECT count(DISTINCT a.pid)::int AS n FROM pg_stat_activity a
      JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=${`aacp_write_native_${runId}`}
        AND a.wait_event_type='Lock' AND a.state='active' AND l.locktype='advisory' AND NOT l.granted AND l.objsubid=1
        AND l.classid::bigint=((hashtextextended(${lock},0)>>32)&4294967295)
        AND l.objid::bigint=(hashtextextended(${lock},0)&4294967295)`)[0].n);
    if (observed === expected) return observed;
    await pause(20);
  } while (Date.now() < deadline);
  assert.equal(observed, expected, "exact_cart_waiters_not_observed");
}
const mutations = {
  addItem: () => repo.addItem(merchantId, cartId, item()),
  removeItem: () => repo.removeItem(merchantId, cartId, "synthetic-variant"),
  updateItemQuantity: () => repo.updateItemQuantity(merchantId, cartId, "synthetic-variant", 2),
  clear: () => repo.clear(merchantId, cartId),
  applyCoupon: () => repo.applyCoupon(merchantId, cartId, "OTHER", 200),
  removeCoupon: () => repo.removeCoupon(merchantId, cartId),
  applyRuleOutcome: () => repo.applyRuleOutcome(merchantId, cartId, { discountCents: 200, freeShipping: true }),
};
let checks = 0, active = "owned marker", maxWaiters = 0;
const check = async (name, work) => { active = name; await work(); checks++; console.log(JSON.stringify({ test: name, status: "passed" })); };
try {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  await prisma.$executeRawUnsafe("CREATE SEQUENCE synthetic_binding_cart_writes");
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_binding_write_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM nextval('synthetic_binding_cart_writes'); RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_binding_write_attempt BEFORE INSERT OR UPDATE ON storefront_carts
    FOR EACH ROW EXECUTE FUNCTION synthetic_binding_write_attempt()`);
  for (const [name, mutate] of Object.entries(mutations)) await check(`bound ${name} makes zero write attempts including TTL`, async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx)); const before = await snapshot();
    await assert.rejects(mutate, boundError); assert.deepEqual(await snapshot(), before);
  });
  for (const state of ["active", "released", "redeemed"]) await check(`${state} bound read preserves expired snapshot without SQL writes`, async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx, binding({ state, ...(state === "redeemed" ? { orderId: "synthetic-order" } : {}) })));
    await prisma.$executeRaw`UPDATE storefront_carts SET expires_at='2000-01-01' WHERE merchant_id=${merchantId} AND session_id=${cartId}`;
    const before = await snapshot(); const cart = await repo.getOrCreate(merchantId, cartId);
    assert.deepEqual(cart, before.cart); assert.equal(JSON.stringify(cart).includes(key), false);
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(mutations.clear, boundError);
  });
  await check("bound missing cart does not get recreated", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx));
    await prisma.$executeRaw`DELETE FROM storefront_carts WHERE merchant_id=${merchantId} AND session_id=${cartId}`;
    const before = await snapshot(); await assert.rejects(repo.getOrCreate(merchantId, cartId), conflictError);
    assert.deepEqual(await snapshot(), before);
  });
  await check("UoW denies before callback or proof attempt even when callback would swallow errors", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx)); const before = await snapshot(); let called = false;
    await assert.rejects(uow.run(scope, async ({ tx, cart }) => {
      called = true; await tx.$executeRaw`INSERT INTO synthetic_cart_proof VALUES ('forbidden',${merchantId},${cartId},'SYNTHETIC_TEST_ONLY')`;
      try { await cart.clear(merchantId, cartId); } catch {}
    }), boundError);
    assert.equal(called, false); assert.deepEqual(await snapshot(), before);
  });
  await check("caught bound-operation error stays sticky and rolls back earlier transaction proof", async () => {
    await seed(); const before = await snapshot(); let callback = false;
    await assert.rejects(uow.run(scope, async ({ tx, cart }) => {
      callback = true;
      await tx.$executeRaw`INSERT INTO synthetic_cart_proof VALUES ('sticky',${merchantId},${cartId},'SYNTHETIC_TEST_ONLY')`;
      // Fixture corruption/setup within an already-owned cart TX, not a runtime
      // issuer and NOT a recommendation to acquire checkout locks after cart.
      await insertBinding(tx);
      try { await cart.clear(merchantId, cartId); } catch (error) { assert.equal(boundError(error), true); }
    }), boundError);
    assert.equal(callback, true);
    const after = await snapshot(); assert.deepEqual(after.cart, before.cart); assert.deepEqual(after.writes, before.writes);
    assert.deepEqual(after.checkout, []); assert.deepEqual(after.proofs, []);
    assert.equal(after.proofAttempts[0].last_value, before.proofAttempts[0].last_value + (before.proofAttempts[0].is_called ? 1n : 0n));
    assert.equal(after.proofAttempts[0].is_called, true);
  });
  await check("coupon adapter refuses before reservations or outbox delegates", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx)); const before = await snapshot();
    const forbidden = () => assert.fail("bound_cart_exposed_coupon_dependency");
    const adapter = new PrismaStorefrontCouponCartAdapter(prisma, { authorizeDiscount: forbidden },
      { couponsFor: forbidden, transactionsFor: forbidden, promotionsFor: forbidden, readExistingRules: forbidden });
    await assert.rejects(adapter.apply(scope, { code: "SYNTHETIC" }), boundError);
    assert.deepEqual(await snapshot(), before);
  });
  await check("marketplace adapter refuses before stock or cross-store delegates", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx)); const before = await snapshot();
    await assert.rejects(new PrismaMarketplaceCartRepository(prisma).add({ merchantId, checkoutSessionId: cartId,
      sellerMerchantId: "synthetic-seller", federatedProductId: "synthetic-product", quantity: 1 }), boundError);
    assert.deepEqual(await snapshot(), before);
  });
  for (const operation of ["quote", "project", "projectForCheckout"]) await check(`cross-sell ${operation} denied before absent catalog delegates`, async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx)); const before = await snapshot();
    await assert.rejects(operation === "quote" ? cross.quote(scope, { variantId: "synthetic-target", promotionId: "synthetic-promo", quantity: 1 }) : cross[operation](scope), boundError);
    assert.deepEqual(await snapshot(), before);
  });
  await check("malformed private field present by canonical cart_ref fails closed", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx, null)); const before = await snapshot();
    await assert.rejects(mutations.clear, conflictError); assert.deepEqual(await snapshot(), before);
  });
  await check("private cartId match cannot hide mismatched canonical cart_ref", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx, binding(), merchantId, checkoutSessionId, "synthetic-other-cart"));
    const before = await snapshot(); await assert.rejects(mutations.clear, conflictError); assert.deepEqual(await snapshot(), before);
  });
  for (const [label, value] of [["tenant", binding({ merchantId: "wrong-tenant" })], ["checkout", binding({ checkoutSessionId: "wrong-session" })]]) {
    await check(`private ${label} mismatch is a conflict with no effects`, async () => {
      await seed(); await prisma.$transaction(tx => insertBinding(tx, value)); const before = await snapshot();
      await assert.rejects(mutations.clear, conflictError); assert.deepEqual(await snapshot(), before);
    });
  }
  await check("numeric canonical cart_ref is not coerced into an authoritative string", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx, binding({ cartId: "123" }), merchantId, checkoutSessionId, 123));
    const before = await snapshot(); await assert.rejects(repo.clear(merchantId, "123"), conflictError);
    assert.deepEqual(await snapshot(), before);
  });
  await check("two synthetic owners conflict rather than selecting the first", async () => {
    await seed(); await prisma.$transaction(async tx => { await insertBinding(tx); await insertBinding(tx, binding({ checkoutSessionId: "synthetic-second" }), merchantId, "synthetic-second"); });
    const before = await snapshot(); await assert.rejects(mutations.clear, conflictError); assert.deepEqual(await snapshot(), before);
  });
  await check("foreign tenant's same cart reference does not fence this tenant", async () => {
    await seed(); await prisma.$transaction(tx => insertBinding(tx, binding({ merchantId: "foreign-merchant" }), "foreign-merchant"));
    await mutations.updateItemQuantity(); assert.equal((await rawCart()).items[0].quantity, 2);
  });
  await check("unbound reads still renew TTL, create missing rows and allow all mutators", async () => {
    for (const mutate of Object.values(mutations)) { await seed(); await mutate(); }
    await seed(); await prisma.$executeRaw`UPDATE storefront_carts SET expires_at='2000-01-01' WHERE merchant_id=${merchantId} AND session_id=${cartId}`;
    const before = await snapshot(); await repo.getOrCreate(merchantId, cartId); assert.notDeepEqual(await snapshot(), before);
    await prisma.$executeRaw`DELETE FROM storefront_carts WHERE merchant_id=${merchantId} AND session_id=${cartId}`;
    assert.equal((await repo.getOrCreate(merchantId, cartId)).items.length, 0);
  });
  await check("real RR pre-lock snapshot is rejected, never used as absence proof", async () => {
    await seed(); const before = await snapshot();
    await assert.rejects(prisma.$transaction(tx => withStorefrontCartInTransaction(tx, merchantId, cartId, async () => assert.fail("work exposed")), { isolationLevel: "RepeatableRead" }), conflictError);
    assert.deepEqual(await snapshot(), before);
  });
  await check("20 actual cart waiters reread committed simulator binding and all deny without writes", async () => {
    await seed(); const expected = await rawCart(), acquired = deferred(), release = deferred(); let writers = [];
    const issuer = prisma.$transaction(async tx => { await simulateIssuer(tx, expected); acquired.resolve(); await release.promise; });
    void issuer.catch(() => {});
    try {
      await acquired.promise;
      const operations = Object.values(mutations);
      writers = Array.from({ length: 20 }, (_, index) => operations[index % operations.length]().then(() => ({ allowed: true }), error => ({ error: error.message })));
      maxWaiters = await waitForCartWaiters(20); const before = await snapshot();
      release.resolve(); await issuer;
      assert.deepEqual(await Promise.all(writers), Array.from({ length: 20 }, () => ({ error: "storefront_cart_checkout_bound" })));
      const after = await snapshot(); assert.deepEqual(after.cart, before.cart); assert.deepEqual(after.writes, before.writes);
      assert.equal(after.checkout.length, 1); assert.deepEqual(after.proofs, []);
    } finally { release.resolve(); await Promise.allSettled([issuer, ...writers]); }
  });
  await check("writer first forces waiting simulator to revalidate and abort changed snapshot", async () => {
    await seed(); const expected = await rawCart(), acquired = deferred(), release = deferred(); let issuer;
    const writer = uow.run(scope, async ({ cart }) => { await cart.updateItemQuantity(merchantId, cartId, "synthetic-variant", 2); acquired.resolve(); await release.promise; });
    void writer.catch(() => {});
    try {
      await acquired.promise;
      issuer = prisma.$transaction(tx => simulateIssuer(tx, expected)).then(() => "unexpected", error => error.message);
      await waitForCartWaiters(1); release.resolve(); await writer;
      assert.equal(await issuer, "synthetic_issuer_snapshot_changed");
      assert.equal((await rawCart()).items[0].quantity, 2); assert.deepEqual(await prisma.$queryRaw`SELECT * FROM checkout_sessions`, []);
    } finally { release.resolve(); await Promise.allSettled([writer, ...(issuer ? [issuer] : [])]); }
  });
  await check("rolled-back simulator releases fence for legitimate waiting writer without phantom binding", async () => {
    await seed(); const expected = await rawCart(), acquired = deferred(), release = deferred(); let writer;
    const issuer = prisma.$transaction(async tx => { await simulateIssuer(tx, expected); acquired.resolve(); await release.promise; throw new Error("synthetic_issuer_rollback"); })
      .then(() => "unexpected", error => error.message);
    try {
      await acquired.promise; writer = mutations.updateItemQuantity(); void writer.catch(() => {});
      await waitForCartWaiters(1); release.resolve(); assert.equal(await issuer, "synthetic_issuer_rollback"); await writer;
      assert.equal((await rawCart()).items[0].quantity, 2); assert.deepEqual(await prisma.$queryRaw`SELECT * FROM checkout_sessions`, []);
    } finally { release.resolve(); await Promise.allSettled([issuer, ...(writer ? [writer] : [])]); }
  });
  console.log(JSON.stringify({ nativeBindingFencePassed: checks, maxCartWaiters: maxWaiters, issuer: "SYNTHETIC_SIMULATOR_ONLY", actualHandoffProven: false, providerCalls: 0 }));
} catch (error) { console.error(JSON.stringify({ failed: active, message: error.message })); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
