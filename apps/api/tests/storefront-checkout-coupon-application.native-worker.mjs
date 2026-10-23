import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { inspectNativePrismaClient, assertNativePrismaUrl } from "./native-prisma-admission-guards.mjs";

const [url, runId] = process.argv.slice(2); assert.equal(process.argv.slice(2).length, 2);
const parsed = assertNativePrismaUrl(url); assert.match(runId, /^[a-f0-9-]{36}$/);
const applicationName = `aacp_write_native_${runId}`;
assert.equal(parsed.searchParams.get("application_name"), applicationName);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_checkout_coupon_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [], transactionOptions: { timeout: 20000, maxWait: 15000 } });
const merchantId = "synthetic-merchant", code = "CHECKOUT10", couponId = "checkout-source-coupon", buyerId = "synthetic-buyer";
let passed = 0, waiters = 0, active = "marker";
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
let useCase, ApplyCouponUseCase, RulesEngineDiscountAdapter, readStorefrontCouponForCheckout, lockCheckoutSessionAnchor, lockStorefrontCart;
const state = async () => ({ source: await prisma.storefrontCart.findMany({ orderBy: { id: "asc" } }),
  checkout: await prisma.checkoutSession.findMany({ orderBy: { id: "asc" } }),
  reserve: await prisma.couponRedemption.findMany({ orderBy: { id: "asc" } }),
  outbox: await prisma.outboxMessage.findMany({ orderBy: { eventId: "asc" } }),
  events: await prisma.checkoutEvent.findMany({ orderBy: { id: "asc" } }) });
const marker = async () => assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
async function seed({ saved = 10000, options = false, suffix = "one", reset = true, couponPercent = 10 } = {}) {
  await marker();
  if (reset) {
    await prisma.$executeRaw`DELETE FROM checkout_events`; await prisma.$executeRaw`DELETE FROM payment_intents`;
    await prisma.$executeRaw`DELETE FROM completed_orders`; await prisma.$executeRaw`DELETE FROM checkout_sessions`;
    await prisma.$executeRaw`DELETE FROM outbox_messages`; await prisma.$executeRaw`DELETE FROM coupon_redemptions`;
    await prisma.$executeRaw`DELETE FROM coupons`; await prisma.$executeRaw`DELETE FROM storefront_carts`;
    await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=20,minimum_margin_percent=99,autonomous_engine_enabled=true`;
    await prisma.$executeRaw`UPDATE products SET metadata='{}'::jsonb,is_active=true,deleted_at=NULL WHERE id='synthetic-product'`;
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=10000,cost_in_cents=NULL,currency='BRL' WHERE variant_id='synthetic-variant'`;
    await prisma.$executeRaw`UPDATE product_stock SET quantity=100,reserved=0 WHERE variant_id='synthetic-variant'`;
    await prisma.coupon.create({ data: { id: couponId, merchantId, code, discountType: "percent", discountValue: couponPercent,
      maxUsages: 1, maxPerBuyer: 1, startsAt: new Date("2000-01-01"), endsAt: new Date("2100-01-01"), updatedAt: new Date() } });
  }
  const option = { groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 500 };
  if (options) await prisma.$executeRaw`UPDATE products SET metadata=${JSON.stringify({ optionGroups: [{ id: "size", name: "Tamanho", required: false,
    selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 500 }] }] })}::jsonb WHERE id='synthetic-product'`;
  const cartId = `checkout-source-${suffix}`, sessionId = `checkout-distinct-${suffix}`, canonical = options ? 10500 : 10000;
  const sourceItems = [{ variantId: "synthetic-variant", productId: "synthetic-product", sku: "synthetic-sku", name: "Saved synthetic",
    quantity: 1, unitPriceCents: saved, ...(options ? { selectedOptions: [option] } : {}) }];
  await prisma.storefrontCart.create({ data: { id: cartId, merchantId, sessionId: cartId, items: sourceItems, total: saved,
    discount: 0, freeShipping: false, expiresAt: new Date("2100-01-01"), updatedAt: new Date() } });
  await prisma.checkoutSession.create({ data: { id: sessionId, merchantId, sessionId, globalUserId: buyerId, conversationId: "synthetic-conversation", version: 4,
    cart: { source: "storefront", cart_ref: cartId, currency: "BRL", total: saved / 100, currentDiscount: 0,
      ...(saved < canonical ? { discountBudget: { version: 1, originalSubtotalCents: canonical, promotionDiscountCents: canonical - saved } } : {}),
      items: [{ variantId: "synthetic-variant", product_id: "synthetic-product", sku: "synthetic-sku", name: "Saved synthetic", price: saved / 100, quantity: 1,
        ...(saved < canonical ? { originalPrice: canonical / 100 } : {}), ...(options ? { variant: JSON.stringify(["synthetic-variant", ["large"]]),
          selected_options: [{ group_name: "Tamanho", item_name: "Grande", price_modifier: 5 }] } : {}) }] },
    customer: { email: "synthetic@example.test", email_verified: true, address: { city: "Synthetic", state: "SP", zip: "01310100" } },
    createdAt: new Date(), updatedAt: new Date() } });
  return { merchant_id: merchantId, session_id: sessionId, code, expectedVersion: 4, cartId };
}
const apply = ({ cartId: _cartId, ...input }, command = useCase) => command.executeForCheckout(input);
const review = error => { assert.ok([400, 409, 422].includes(error?.getStatus?.()), error?.name); return true; };
async function waitFor(query) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { const count = await query(); if (count > 0) { waiters += count; return; } await pause(20); }
  assert.fail("native_checkout_coupon_lock_waiter_required");
}
async function hold(acquire) {
  let ready, reject, release; const acquired = new Promise((resolve, rejectPromise) => { ready = resolve; reject = rejectPromise; });
  const released = new Promise(resolve => { release = resolve; });
  const done = prisma.$transaction(async tx => { await acquire(tx); ready(); await released; }, { timeout: 20000 });
  void done.catch(reject); await acquired; return { done, release };
}

try {
  await prisma.$connect(); await marker();
  ({ ApplyCouponUseCase } = await import("../src/modules/coupons/application/use-cases/apply-coupon.use-case.ts"));
  ({ RulesEngineDiscountAdapter } = await import("../src/modules/coupons/infrastructure/adapters/rules-engine-discount.adapter.ts"));
  ({ readStorefrontCouponForCheckout } = await import("../src/shared/persistence/storefront-coupon/admission.ts"));
  ({ lockCheckoutSessionAnchor } = await import("../src/shared/persistence/checkout-session-lock.ts"));
  ({ lockStorefrontCart } = await import("../src/shared/persistence/storefront-cart-lock.ts"));
  useCase = new ApplyCouponUseCase({}, {}, new RulesEngineDiscountAdapter(), prisma);
  for (const shape of [{}, { saved: 9000, couponPercent: 50 }, { saved: 9000, couponPercent: 50, options: true }])
    await check(`real source checkout issuance ${JSON.stringify(shape)} commits exact identities and canonical headroom`, async () => {
      const command = await seed(shape), before = await state(), result = await apply(command), after = await state();
      const expected = shape.options ? 600 : shape.saved ? 1000 : 1000;
      assert.equal(after.reserve.length, 1); assert.equal(after.reserve[0].sessionId, command.cartId);
      assert.equal(after.reserve[0].buyerGlobalUserId, buyerId); assert.equal(Number(after.reserve[0].discountApplied) * 100, expected);
      assert.deepEqual(after.source[0].items, before.source[0].items); assert.equal(after.source[0].total, before.source[0].total);
      assert.equal(after.source[0].discount, expected); assert.equal(after.source[0].couponCode, code);
      assert.equal(after.checkout[0].cart.currentDiscount * 100, expected); assert.equal(after.checkout[0].version, 5);
      assert.equal(after.events.length, 1); assert.equal(after.events[0].sessionId, command.session_id);
      assert.equal(after.outbox.length, 1); assert.equal(after.outbox[0].payload.session_id, command.cartId);
      await prisma.$transaction(async tx => {
        // The read-only candidate also requires its documented caller fences;
        // a quiet fixture is not a replacement for the real lock contract.
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id=${merchantId} FOR UPDATE`;
        await tx.$queryRaw`SELECT merchant_id FROM checkout_settings WHERE merchant_id=${merchantId} FOR SHARE`;
        await lockCheckoutSessionAnchor(tx, merchantId, command.session_id);
        await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${merchantId} AND session_id=${command.session_id} FOR UPDATE`;
        await lockStorefrontCart(tx, merchantId, command.cartId);
        const candidate = await readStorefrontCouponForCheckout(tx, result.session, { requireVerifiedBuyer: true, requireRegion: true });
        assert.equal(candidate.cartId, command.cartId); assert.equal(candidate.checkoutSessionId, command.session_id);
      });
    });
  for (const kind of ["unverified", "buyer absent", "stock", "stale B", "source sum", "blocked region", "version", "payment"]) await check(`real source coupon ${kind} refuses without money/quota/outbox writes`, async () => {
    const command = await seed();
    if (kind === "unverified") await prisma.checkoutSession.update({ where: { id: command.session_id }, data: { customer: { email: "synthetic@example.test", email_verified: false } } });
    if (kind === "buyer absent") await prisma.checkoutSession.update({ where: { id: command.session_id }, data: { globalUserId: "" } });
    if (kind === "stock") await prisma.$executeRaw`UPDATE product_stock SET quantity=0 WHERE variant_id='synthetic-variant'`;
    if (kind === "stale B") await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=10001 WHERE variant_id='synthetic-variant'`;
    if (kind === "source sum") await prisma.storefrontCart.update({ where: { id: command.cartId }, data: { total: 10001 } });
    if (kind === "blocked region") await prisma.coupon.update({ where: { id: couponId }, data: { blockedRegions: ["SP"] } });
    if (kind === "version") command.expectedVersion = 3;
    if (kind === "payment") await prisma.paymentIntent.create({ data: { id: "synthetic-pending-payment", merchantId, sessionId: command.session_id,
      idempotencyKey: "synthetic-key", amountCents: 10000, currency: "BRL", method: "pix", status: "pending" } });
    const before = await state(); await assert.rejects(apply(command), review); assert.deepEqual(await state(), before);
  });
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_checkout_coupon_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_TABLE_NAME='storefront_carts' THEN
      IF NEW.session_id='checkout-source-source-fault' AND NEW.discount>0 THEN RETURN NULL; END IF;
    ELSIF TG_TABLE_NAME='checkout_sessions' THEN
      IF NEW.session_id='checkout-distinct-checkout-fault' AND NEW.version=5 THEN RETURN NULL; END IF;
    END IF;
    RETURN NEW; END $$`);
  for (const table of ["storefront_carts", "checkout_sessions"]) await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_checkout_coupon_fault BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION synthetic_checkout_coupon_fault()`);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_checkout_coupon_outbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.payload->>'session_id'='checkout-source-outbox-fault' THEN RAISE EXCEPTION 'synthetic_checkout_coupon_outbox_fault'; END IF;
    RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_checkout_coupon_outbox_fault BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_checkout_coupon_outbox_fault()`);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_checkout_coupon_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.payload->>'session_id'='checkout-source-commit-fault' THEN RAISE EXCEPTION 'synthetic_checkout_coupon_commit_fault'; END IF;
    RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER synthetic_checkout_coupon_commit_fault AFTER INSERT ON outbox_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_checkout_coupon_commit_fault()`);
  for (const stage of ["source", "checkout", "outbox", "commit"]) await check(`real SQL ${stage} failure atomically rolls back source, checkout, quota, event and outbox`, async () => {
    const command = await seed({ suffix: `${stage}-fault` }), before = await state(); await assert.rejects(apply(command)); assert.deepEqual(await state(), before);
  });
  await check("actual committed issuance with lost acknowledgement propagates exact uncertainty without retry", async () => {
    const command = await seed(), fault = new Error("synthetic_checkout_coupon_ack_lost"); let transactions = 0;
    const uncertain = new Proxy(prisma, { get(target, key) { if (key === "$transaction") return async (...args) => {
      await target.$transaction(...args); transactions++; throw fault; };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
    await assert.rejects(apply(command, new ApplyCouponUseCase({}, {}, new RulesEngineDiscountAdapter(), uncertain)), error => error === fault);
    const after = await state(); assert.equal(transactions, 1); assert.equal(after.reserve.length, 1); assert.equal(after.outbox.length, 1);
    assert.equal(after.source[0].discount, 1000); assert.equal(after.checkout[0].version, 5);
  });
  await check("two distinct source/checkouts compete for one actual quota under merchant lock", async () => {
    const one = await seed({ suffix: "race-one" }), two = await seed({ suffix: "race-two", reset: false });
    const gate = await hold(tx => tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`);
    const results = Promise.allSettled([apply(one), apply(two)]);
    try { await waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE application_name=${applicationName}
      AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM merchants%'`)[0].n); }
    finally { gate.release(); await gate.done; }
    const settled = await results, after = await state(); assert.equal(settled.filter(value => value.status === "fulfilled").length, 1);
    assert.equal(settled.filter(value => value.status === "rejected").length, 1); assert.equal(after.reserve.length, 1); assert.equal(after.outbox.length, 1);
    assert.equal(after.source.filter(row => row.couponCode === code).length, 1); assert.equal(after.checkout.filter(row => row.version === 5).length, 1);
  });
  console.log(JSON.stringify({ status: "passed", checks: passed, realWaitersObserved: waiters, realPrismaTransactions: true,
    realProviderCalls: 0, publicEndpointProof: false, paymentProof: false, fullJourneyProof: false }));
} catch (error) { console.error(JSON.stringify({ status: "failed", test: active, checksPassed: passed, errorName: error?.name ?? "unknown",
  code: typeof error?.code === "string" ? error.code : undefined })); throw error; }
finally { await prisma.$disconnect(); }
