import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { inspectNativePrismaClient, assertNativePrismaUrl } from "./native-prisma-admission-guards.mjs";

const [url, runId, mode] = process.argv.slice(2), legacyReleaseOnly = mode === "--legacy-release-only";
assert.deepEqual(process.argv.slice(4), legacyReleaseOnly ? ["--legacy-release-only"] : []);
const parsed = assertNativePrismaUrl(url); assert.match(runId, /^[a-f0-9-]{36}$/);
const applicationName = `aacp_write_native_${runId}`;
assert.equal(parsed.searchParams.get("application_name"), applicationName);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_combined_coupon_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [], transactionOptions: { timeout: 30_000, maxWait: 15_000 } });
const merchantId = "synthetic-merchant", host = "synthetic-variant", target = "other-variant", promotionId = "combined-cross-sell", couponId = "combined-coupon", code = "COMBINED10";
const buyerId = "synthetic-combined-buyer", gateKey = 7396201;
let active = "marker", passed = 0, realWaitersObserved = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const within = async (promise, millis, message) => { let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), millis); })]); }
  finally { clearTimeout(timer); }
};
const waitFor = async query => {
  const deadline = Date.now() + 10_000; let count = 0;
  do { count = await query(); if (count >= 1) { realWaitersObserved += count; return; } await pause(20); } while (Date.now() < deadline);
  assert.ok(count >= 1, "real_combined_coupon_lock_waiter_required");
};
const waitOnMerchant = () => waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM pg_stat_activity
  WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM merchants%'`)[0].n);
const waitOnCart = () => waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM pg_stat_activity
  WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%hashtextextended%'`)[0].n);
const waitOnGate = () => waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(DISTINCT locks.pid)::int AS n FROM pg_locks locks
  JOIN pg_stat_activity a ON a.pid=locks.pid WHERE a.application_name=${applicationName} AND locks.locktype='advisory'
    AND NOT locks.granted AND locks.classid=0 AND locks.objid=${gateKey}::oid`)[0].n);
const hold = async acquire => {
  let ready, rejectReady, release; const acquired = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; });
  const released = new Promise(resolve => { release = resolve; });
  const done = prisma.$transaction(async tx => { await acquire(tx); ready(); await released; }, { timeout: 30_000 });
  void done.catch(rejectReady); await within(acquired, 10_000, "combined_coupon_owned_gate_acquisition_timeout"); return { done, release };
};
const state = async scope => ({ cart: await prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: scope.cartId } } }),
  reservations: await prisma.couponRedemption.findMany({ where: { merchantId, sessionId: scope.cartId }, orderBy: { id: "asc" } }),
  outbox: await prisma.outboxMessage.findMany({ where: { merchantId, OR: [
    { payload: { path: ["session_id"], equals: scope.cartId } }, { payload: { path: ["cartId"], equals: scope.cartId } },
  ] }, orderBy: { eventId: "asc" } }),
  changes: (await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM synthetic_cross_sell_changes WHERE cart_id=${scope.cartId}`)[0].n });
const reset = async () => {
  await prisma.$executeRaw`DELETE FROM checkout_sessions`;
  await prisma.$executeRaw`DELETE FROM outbox_messages`;
  await prisma.$executeRaw`DELETE FROM coupon_redemptions`;
  await prisma.$executeRaw`DELETE FROM coupons`;
  await prisma.$executeRaw`DELETE FROM storefront_carts`;
  await prisma.$executeRaw`DELETE FROM synthetic_cross_sell_changes`;
  await prisma.$executeRaw`DELETE FROM cross_sell_promotions`;
  await prisma.$executeRaw`DELETE FROM product_promotions`;
  await prisma.$executeRaw`UPDATE products SET metadata='{}'::jsonb,is_active=TRUE,deleted_at=NULL WHERE id IN ('synthetic-product','other-product')`;
  await prisma.$executeRaw`UPDATE products SET metadata='{"optionGroups":[{"id":"size","name":"Size","required":true,"selectionType":"single","items":[{"id":"large","name":"Large","priceModifierInCents":500}]}]}'::jsonb WHERE id='other-product'`;
  await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=CASE WHEN variant_id=${host} THEN 10000 ELSE 4500 END,
    cost_in_cents=NULL,currency='BRL' WHERE variant_id IN (${host},${target})`;
  await prisma.$executeRaw`UPDATE product_stock SET quantity=10,reserved=0 WHERE variant_id IN (${host},${target})`;
  await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=20,minimum_margin_percent=99,autonomous_engine_enabled=TRUE WHERE merchant_id=${merchantId}`;
  await prisma.$executeRaw`UPDATE checkout_settings SET advanced_rules='[]'::jsonb WHERE merchant_id=${merchantId}`;
  await prisma.$executeRaw`INSERT INTO cross_sell_promotions(id,merchant_id,name,trigger,recommended_skus,discount_percent,max_discount_percent,status,starts_at,ends_at,updated_at)
    VALUES (${promotionId},${merchantId},'Synthetic accepted benefit','{"sku_in_cart":["synthetic-sku"]}'::jsonb,ARRAY['other-current-sku'],20,20,'active','2000-01-01','2100-01-01','2026-10-18')`;
  await prisma.$executeRaw`INSERT INTO coupons(id,merchant_id,code,discount_type,discount_value,starts_at,ends_at,updated_at)
    VALUES (${couponId},${merchantId},${code},'percent',10,'2000-01-01','2100-01-01','2026-10-18')`;
};

try {
  await prisma.$connect();
  assert.deepEqual(await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`, [{ database: "storefront_synthetic", run_id: runId }]);
  if (legacyReleaseOnly) {
    const { runLegacyCouponReleaseNativeCases } = await import("./storefront-legacy-coupon-release.native-cases.mjs");
    const result = await runLegacyCouponReleaseNativeCases({ prisma, runId });
    console.log(JSON.stringify({ status: "passed", ...result, realProviderCalls: 0, publicEndpointProof: false,
      replayIdempotencyProof: false, shippingD0Proof: false, fullJourneyProof: false }));
  } else {
  const { PrismaStorefrontCombinedCouponAdapter } = await import("../src/modules/coupons/infrastructure/repositories/prisma-storefront-combined-coupon.adapter.ts");
  const { PrismaStorefrontCrossSellCartAdapter } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.ts");
  const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
  const { lockStorefrontCart } = await import("../src/shared/persistence/storefront-cart-lock.ts");
  const { PrismaOutboxRepository } = await import("../src/shared/messaging/infrastructure/prisma-outbox.repository.ts");
  const combined = new PrismaStorefrontCombinedCouponAdapter(prisma), crossSell = new PrismaStorefrontCrossSellCartAdapter(prisma), carts = new PrismaStorefrontCartRepository(prisma);
  const provision = async (cartId, quantity = 1) => {
    const scope = { merchantId, cartId, trustedBuyerGlobalUserId: buyerId };
    const items = [{ variantId: host, productId: "synthetic-product", sku: "synthetic-sku", name: "Synthetic catalog name",
      categoryId: "synthetic-category", quantity: 1, unitPriceCents: 10000 }];
    await prisma.$executeRaw`INSERT INTO storefront_carts(id,merchant_id,session_id,items,total,updated_at,expires_at)
      VALUES (${cartId},${merchantId},${cartId},${JSON.stringify(items)}::jsonb,10000,'2020-01-01','2100-01-01')`;
    const cartScope = { merchantId, cartId }, quote = await crossSell.quote(cartScope, { variantId: target, promotionId, quantity, selectedOptionItemIds: ["large"] });
    await crossSell.accept(cartScope, { expectedQuote: quote });
    return scope;
  };
  const apply = (scope, adapter = combined) => adapter.apply(scope, { code });
  const releaseRequest = { operationId: "a5537938-7496-4ea4-94b4-ec872a418337", action: "remove_coupon", expectedCouponCode: code };

  await check("actual cross-sell acceptance then V1 coupon reserve/cart/outbox commit retain P+D and distinct D", async () => {
    await reset(); await prisma.$executeRaw`UPDATE product_stock SET quantity=1 WHERE variant_id=${target}`;
    const scope = await provision("combined-success"), before = await state(scope), result = await apply(scope);
    assert.equal(result.applied, true); assert.equal(result.discountCents, 1400); assert.equal(result.quote.promotionDiscountCents, 1000); assert.equal(result.quote.merchandiseTotalCents, 12600);
    const after = await state(scope); assert.equal(after.cart.total, 15000); assert.equal(after.cart.items[1].unitPriceCents, 5000);
    assert.equal(after.cart.items[1].crossSellIntent.maximumUnitPriceCents, 4000); assert.equal(after.cart.items[1].selectedOptions[0].itemId, "large");
    assert.equal(after.reservations.length, 1); assert.equal(Number(after.reservations[0].discountApplied), 14); assert.equal(after.reservations[0].sessionId, scope.cartId);
    assert.equal(after.outbox.length, 1); assert.equal(after.outbox[0].payload.discount_applied, 14); assert.equal(after.changes, before.changes + 1);
    const read = await combined.read(scope); assert.equal(read.quote.merchandiseTotalCents, 12600); assert.deepEqual(await state(scope), after);
    assert.equal((await apply(scope)).applied, false); assert.deepEqual(await state(scope), after);
  });
  await check("real quantity and paid options use one shared ceiling and whole-cent reservation", async () => {
    await reset(); const scope = await provision("combined-quantity", 3), result = await apply(scope);
    assert.equal(result.applied, true); assert.equal(result.quote.originalSubtotalCents, 25000); assert.equal(result.quote.promotionDiscountCents, 3000);
    assert.equal(result.discountCents, 2000); assert.equal(result.quote.merchandiseTotalCents, 20000); assert.equal(result.commercialNotices[0].code, "discount_limit_reached");
    assert.equal(Number((await state(scope)).reservations[0].discountApplied), 20);
  });
  await check("already attained company ceiling keeps accepted discount with notice and no fake D0 goods reserve", async () => {
    await reset(); const scope = await provision("combined-ceiling"); await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=6.6667 WHERE merchant_id=${merchantId}`;
    const before = await state(scope), result = await apply(scope); assert.equal(result.applied, false); assert.equal(result.commercialNotices[0].code, "discount_limit_reached");
    assert.deepEqual(await state(scope), before);
  });
  await check("unknown analytic cost/margin does not authorize or block actual SQL path", async () => {
    await reset(); const scope = await provision("combined-no-margin");
    await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=-1 WHERE variant_id=${target}`;
    await prisma.$executeRaw`UPDATE merchant_rules SET minimum_margin_percent='NaN'::numeric WHERE merchant_id=${merchantId}`;
    const result = await apply(scope); assert.equal(result.applied, true); assert.equal(result.discountCents, 1400);
  });
  for (const name of ["native-outbox-failure", "native-deferred-failure", "native-cas-failure", "update-error"]) await check("real SQL rollback preserves accepted cart/reserve/outbox/TTL: " + name, async () => {
    await reset(); const scope = await provision(name), before = await state(scope); await assert.rejects(apply(scope)); assert.deepEqual(await state(scope), before);
  });
  await check("lost acknowledgement after real commit is recovered read-only with one durable application", async () => {
    await reset(); const scope = await provision("combined-lost-ack"), fault = new Error("synthetic_combined_ack_lost"); let calls = 0;
    const uncertain = new PrismaStorefrontCombinedCouponAdapter(new Proxy(prisma, { get(targetClient, key) {
      if (key === "$transaction") return async (...args) => { const result = await targetClient.$transaction(...args); calls++; throw fault; };
      const member = Reflect.get(targetClient, key); return typeof member === "function" ? member.bind(targetClient) : member;
    } }));
    await assert.rejects(apply(scope, uncertain), error => error === fault); assert.equal(calls, 1);
    const committed = await state(scope); assert.equal(committed.reservations.length, 1); assert.equal(committed.outbox.length, 1);
    const recovered = await combined.read(scope); assert.equal(recovered.discountCents, 1400); assert.deepEqual(await state(scope), committed);
  });
  await check("two real competing callers cannot double reserve cart/coupon", async () => {
    await reset(); const scope = await provision("combined-concurrent"), result = await Promise.all([apply(scope), apply(scope)]);
    assert.equal(result.filter(x => x.applied).length, 1); const after = await state(scope); assert.equal(after.reservations.length, 1); assert.equal(after.outbox.length, 1);
  });
  for (const buyerQuota of [false, true]) await check("real shared quota admits one source across carts: " + (buyerQuota ? "buyer" : "global"), async () => {
    await reset(); const one = await provision("combined-quota-one"), two = await provision("combined-quota-two");
    if (buyerQuota) await prisma.$executeRaw`UPDATE coupons SET max_per_buyer=1 WHERE id=${couponId}`;
    else await prisma.$executeRaw`UPDATE coupons SET max_usages=1 WHERE id=${couponId}`;
    const results = await Promise.all([apply(one), apply(two)]); assert.equal(results.filter(x => x.applied).length, 1);
    assert.equal(await prisma.couponRedemption.count(), 1); assert.equal(await prisma.outboxMessage.count(), 1);
    assert.equal((await prisma.couponRedemption.findFirstOrThrow()).buyerGlobalUserId, buyerId);
  });
  for (const kind of ["source", "buyer", "amount", "coupon", "stock", "price"]) await check("canonical read rejects changed " + kind + " without repair", async () => {
    await reset(); const scope = await provision("combined-read-" + kind); assert.equal((await apply(scope)).applied, true);
    if (kind === "source") await prisma.$executeRaw`UPDATE coupon_redemptions SET session_id='other-cart'`;
    if (kind === "buyer") await prisma.$executeRaw`UPDATE coupon_redemptions SET buyer_global_user_id='other-buyer'`;
    if (kind === "amount") await prisma.$executeRaw`UPDATE coupon_redemptions SET discount_applied=13.99`;
    if (kind === "coupon") await prisma.$executeRaw`UPDATE coupons SET discount_value=1 WHERE id=${couponId}`;
    if (kind === "stock") await prisma.$executeRaw`UPDATE product_stock SET quantity=0 WHERE variant_id=${target}`;
    if (kind === "price") await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=4501 WHERE variant_id=${target}`;
    const before = await state(scope); await assert.rejects(combined.read(scope)); assert.deepEqual(await state(scope), before);
  });
  await check("default generic clear and final-line removal cannot orphan real reserve", async () => {
    await reset(); const scope = await provision("combined-generic-clear"); assert.equal((await apply(scope)).applied, true);
    const before = await state(scope); await assert.rejects(carts.clear(merchantId, scope.cartId)); assert.deepEqual(await state(scope), before);
    // Deliberately reduced legacy/corrupt source is NOT offered as a valid
    // quote. Even it must not be silently cleared while its reserve is alive.
    const reduced = before.cart.items.filter(line => line.variantId === target);
    await prisma.$executeRaw`UPDATE storefront_carts SET items=${JSON.stringify(reduced)}::jsonb,total=5000 WHERE merchant_id=${merchantId} AND session_id=${scope.cartId}`;
    const legacy = await state(scope); await assert.rejects(carts.removeItem(merchantId, scope.cartId, target, { optionItemIds: ["large"] }));
    assert.deepEqual(await state(scope), legacy);
  });
  await check("price writer first blocks real issuer and forces canonical reread after wait", async () => {
    await reset(); const scope = await provision("combined-price-first"), before = await state(scope);
    const writer = await hold(async tx => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=4501 WHERE variant_id=${target}`; });
    const pending = apply(scope); void pending.catch(() => {});
    try { await waitOnMerchant(); } finally { writer.release(); await writer.done; }
    assert.equal((await pending).applied, false); assert.deepEqual(await state(scope), before);
  });
  await check("issuer first holds merchant against price writer until reserve/cart/outbox commit", async () => {
    await reset(); const scope = await provision("combined-hold-price-second"), gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const pending = apply(scope); void pending.catch(() => {}); let writer;
    try {
      await waitOnGate(); writer = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
        await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=4501 WHERE variant_id=${target}`; }); void writer.catch(() => {});
      await waitOnMerchant();
    } finally { gate.release(); await gate.done; await Promise.allSettled([pending, ...(writer ? [writer] : [])]); }
    assert.equal((await pending).applied, true); await writer; const committed = await state(scope);
    assert.equal(committed.reservations.length, 1); assert.equal(committed.outbox.length, 1); await assert.rejects(combined.read(scope));
    assert.deepEqual(await state(scope), committed);
  });
  await check("clear source first blocks issuer, which cannot reserve empty cart after wait", async () => {
    await reset(); const scope = await provision("combined-clear-first");
    const clear = await hold(async tx => { await lockStorefrontCart(tx, merchantId, scope.cartId);
      await tx.$executeRaw`UPDATE storefront_carts SET items='[]'::jsonb,total=0,discount=0,coupon_code=NULL WHERE merchant_id=${merchantId} AND session_id=${scope.cartId}`; });
    const pending = apply(scope); void pending.catch(() => {});
    try { await waitOnCart(); } finally { clear.release(); await clear.done; }
    assert.equal((await pending).applied, false); const after = await state(scope); assert.equal(after.cart.items.length, 0); assert.equal(after.reservations.length, 0); assert.equal(after.outbox.length, 0);
  });
  await check("issuer first fences generic clear, which then refuses instead of leaving orphaned quota", async () => {
    await reset(); const scope = await provision("combined-hold-clear-second"), gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const pending = apply(scope); void pending.catch(() => {}); let clear;
    try { await waitOnGate(); clear = carts.clear(merchantId, scope.cartId); void clear.catch(() => {}); await waitOnCart(); }
    finally { gate.release(); await gate.done; await Promise.allSettled([pending, ...(clear ? [clear] : [])]); }
    assert.equal((await pending).applied, true); await assert.rejects(clear); const after = await state(scope);
    assert.equal(after.cart.items.length, 2); assert.equal(after.cart.discount, 1400); assert.equal(after.reservations.length, 1); assert.equal(after.outbox.length, 1);
  });
  await check("shipping D0 remains closed without full server quote provenance", async () => {
    await reset(); const scope = await provision("combined-shipping-deferred"); await prisma.$executeRaw`UPDATE coupons SET discount_type='shipping_free' WHERE id=${couponId}`;
    const before = await state(scope); assert.equal((await apply(scope)).applied, false); assert.deepEqual(await state(scope), before);
  });

  for (const action of ["remove_coupon", "clear", "remove_coupon_and_item"]) await check("real explicit lifecycle cancels exact reservation and commits source/technical receipt: " + action, async () => {
    await reset(); const scope = await provision("combined-release-" + action); assert.equal((await apply(scope)).applied, true);
    const request = { ...releaseRequest, action, ...(action === "remove_coupon_and_item" ? { variantId: target, selector: { optionItemIds: ["large"] } } : {}) };
    const result = await combined.mutate(scope, request), after = await state(scope);
    assert.equal(result.kind, "lifecycle_recorded"); assert.equal(after.cart.couponCode, null); assert.equal(after.cart.discount, 0);
    assert.equal(after.cart.items.length, action === "clear" ? 0 : action === "remove_coupon" ? 2 : 1);
    assert.equal(after.reservations.length, 1); assert.equal(after.reservations[0].status, "cancelled");
    assert.equal(Number(after.reservations[0].discountApplied), 14); assert.equal(after.reservations[0].orderId, null);
    assert.equal((await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } })).usagesCount, 0);
    assert.equal(after.outbox.length, 2);
    const receipt = after.outbox.find(event => event.eventType === "storefront.coupon.lifecycle-recorded");
    assert.equal(receipt.status, "recorded"); assert.equal(receipt.deliveredAt, null); assert.equal(receipt.publishedAt, null);
    assert.equal(receipt.producer, "storefront-coupon-lifecycle"); assert.equal(receipt.payload.discountCents, 1400);
    assert.equal(receipt.payload.redemptionId, after.reservations[0].id);
    if (action === "remove_coupon_and_item") {
      await carts.removeItem(merchantId, scope.cartId, host); assert.equal((await state(scope)).cart.items.length, 0);
      assert.equal((await state(scope)).reservations[0].status, "cancelled");
    }
  });
  await check("technical recorded receipt is excluded from actual generic outbox SQL claims", async () => {
    await reset(); const scope = await provision("combined-release-dispatcher"); await apply(scope); await combined.mutate(scope, releaseRequest);
    const before = (await state(scope)).outbox.find(event => event.status === "recorded");
    const claims = await new PrismaOutboxRepository(prisma).claimBatch(50);
    assert.equal(claims.some(claim => claim.envelope.event_id === before.eventId), false);
    assert.deepEqual(await prisma.outboxMessage.findUnique({ where: { eventId: before.eventId } }), before);
    assert.equal(before.attempts, 0);
  });
  await check("cancelled reservation releases global quota by state, without decrementing usage", async () => {
    await reset(); const one = await provision("combined-release-quota-one"), two = await provision("combined-release-quota-two");
    await prisma.$executeRaw`UPDATE coupons SET max_usages=1,max_per_buyer=1 WHERE id=${couponId}`;
    assert.equal((await apply(one)).applied, true); assert.equal((await apply(two)).applied, false);
    await combined.mutate(one, releaseRequest); assert.equal((await apply(two)).applied, true);
    assert.equal(await prisma.couponRedemption.count({ where: { status: "applied" } }), 1);
    assert.equal(await prisma.couponRedemption.count({ where: { status: "cancelled" } }), 1);
    assert.equal((await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } })).usagesCount, 0);
  });
  for (const stage of ["outbox", "cart", "deferred"]) await check("lifecycle real SQL rollback retains applied source/reservation/TTL at " + stage, async () => {
    await reset(); const scope = await provision("combined-release-" + stage + "-failure"); assert.equal((await apply(scope)).applied, true);
    const before = await state(scope); await assert.rejects(combined.mutate(scope, { ...releaseRequest, action: "clear" }));
    assert.deepEqual(await state(scope), before);
  });
  await check("lost lifecycle ACK returns historical receipt without clearing newly added real source", async () => {
    await reset(); const scope = await provision("combined-release-lost-ack"); await apply(scope);
    const fault = new Error("synthetic_release_ack_lost"); let calls = 0;
    const uncertain = new PrismaStorefrontCombinedCouponAdapter(new Proxy(prisma, { get(targetClient, key) {
      if (key === "$transaction") return async (...args) => { await targetClient.$transaction(...args); calls++; throw fault; };
      const value = Reflect.get(targetClient, key); return typeof value === "function" ? value.bind(targetClient) : value;
    } }));
    await assert.rejects(uncertain.mutate(scope, { ...releaseRequest, action: "clear" }), error => error === fault); assert.equal(calls, 1);
    await carts.addItem(merchantId, scope.cartId, { variantId: host, productId: "synthetic-product", sku: "synthetic-sku", name: "Synthetic catalog name", unitPriceCents: 10000 });
    const before = await state(scope), recovered = await combined.mutate(scope, { ...releaseRequest, action: "clear" });
    assert.equal(recovered.itemCount, 0); assert.equal(recovered.totalCents, 0); assert.deepEqual(await state(scope), before);
    await assert.rejects(combined.mutate(scope, releaseRequest)); assert.deepEqual(await state(scope), before);
  });
  for (const firstAction of ["remove_coupon", "clear"]) await check("real lifecycle row wait and duplicate operation commit exactly once: " + firstAction, async () => {
    await reset(); const scope = await provision("combined-release-hold-duplicate-" + firstAction); await apply(scope);
    const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const request = { ...releaseRequest, action: firstAction }, first = combined.mutate(scope, request); void first.catch(() => {}); let second;
    try { await waitOnGate(); second = combined.mutate(scope, request); void second.catch(() => {}); await waitOnMerchant(); }
    finally { gate.release(); await gate.done; await Promise.allSettled([first, ...(second ? [second] : [])]); }
    assert.deepEqual(await first, await second); const after = await state(scope);
    assert.equal(after.reservations[0].status, "cancelled"); assert.equal(after.outbox.length, 2);
  });
  for (const firstAction of ["remove_coupon", "clear"]) await check("opposite lifecycle operations serialize without repeating source mutation: " + firstAction, async () => {
    await reset(); const scope = await provision("combined-release-hold-opposite-" + firstAction); await apply(scope);
    const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const first = combined.mutate(scope, { ...releaseRequest, action: firstAction }); void first.catch(() => {}); let second;
    try {
      await waitOnGate(); second = combined.mutate(scope, { ...releaseRequest,
        operationId: "b5537938-7496-4ea4-94b4-ec872a418337", action: firstAction === "clear" ? "remove_coupon" : "clear" });
      void second.catch(() => {}); await waitOnMerchant();
    } finally { gate.release(); await gate.done; await Promise.allSettled([first, ...(second ? [second] : [])]); }
    assert.equal((await first).kind, "lifecycle_recorded"); await assert.rejects(second);
    const after = await state(scope); assert.equal(after.cart.items.length, firstAction === "clear" ? 0 : 2); assert.equal(after.outbox.length, 2);
  });
  await check("catalog writer first forces lifecycle to reread and preserve applied benefit", async () => {
    await reset(); const scope = await provision("combined-release-catalog-first"); await apply(scope); const before = await state(scope);
    const writer = await hold(async tx => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=4501 WHERE variant_id=${target}`; });
    const pending = combined.mutate(scope, releaseRequest); void pending.catch(() => {});
    try { await waitOnMerchant(); } finally { writer.release(); await writer.done; }
    await assert.rejects(pending); assert.deepEqual(await state(scope), before);
  });
  await check("lifecycle first holds source authority through receipt commit before catalog mutation", async () => {
    await reset(); const scope = await provision("combined-release-hold-catalog-second"); await apply(scope);
    const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const pending = combined.mutate(scope, releaseRequest); void pending.catch(() => {}); let writer;
    try {
      await waitOnGate(); writer = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
        await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=4501 WHERE variant_id=${target}`; });
      void writer.catch(() => {}); await waitOnMerchant();
    } finally { gate.release(); await gate.done; await Promise.allSettled([pending, ...(writer ? [writer] : [])]); }
    const result = await pending; await writer; const after = await state(scope);
    assert.equal(after.reservations[0].status, "cancelled"); assert.deepEqual(await combined.mutate(scope, releaseRequest), result);
    assert.deepEqual(await state(scope), after);
  });
  for (const kind of ["buyer", "amount", "redeemed", "corrupt-final-line"]) await check("real lifecycle rejects invalid exact source without reservation or receipt mutation: " + kind, async () => {
    await reset(); const scope = await provision("combined-release-invalid-" + kind); await apply(scope);
    if (kind === "buyer") await prisma.$executeRaw`UPDATE coupon_redemptions SET buyer_global_user_id='other-buyer'`;
    if (kind === "amount") await prisma.$executeRaw`UPDATE coupon_redemptions SET discount_applied=13`;
    if (kind === "redeemed") await prisma.$executeRaw`UPDATE coupon_redemptions SET status='redeemed',order_id='synthetic-order'`;
    if (kind === "corrupt-final-line") {
      const source = (await state(scope)).cart;
      await prisma.$executeRaw`UPDATE storefront_carts SET items=${JSON.stringify(source.items.filter(item => item.variantId === target))}::jsonb,total=5000 WHERE id=${scope.cartId}`;
    }
    const before = await state(scope); await assert.rejects(combined.mutate(scope, { ...releaseRequest, action: "clear" })); assert.deepEqual(await state(scope), before);
  });
  console.log(JSON.stringify({ status: "passed", checks: passed, realWaitersObserved, realProviderCalls: 0,
    prismaClientCount: 1, poolLimit: 24, publicEndpointProof: false, paymentAdmissionProof: false, shippingD0Proof: false, fullJourneyProof: false }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: "failed", check: active, checksPassed: passed, realWaitersObserved,
    error: typeof error?.code === "string" ? error.code : error?.constructor?.name ?? "Error",
    location: typeof error?.stack === "string" ? error.stack.split("\n").find(line => line.includes("storefront-combined-coupon.native-worker.mjs:"))?.trim() : undefined }));
  throw new Error("native_combined_coupon_assertion_failed");
} finally { await prisma.$disconnect(); }
