import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const args = process.argv.slice(2), [url, runId, mode] = args;
assert.ok(args.length === 2 || args.length === 3 && ["--legacy-characterization", "--probe-missing-coupon-tables"].includes(mode), "explicit_coupon_worker_arguments_required");
const legacy = mode === "--legacy-characterization", probe = mode === "--probe-missing-coupon-tables";
const parsedUrl = assertNativePrismaUrl(url);
assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_coupon_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const merchantId = "synthetic-merchant", host = "synthetic-variant", target = "other-variant", promotionId = "synthetic-cross-sell", code = "NATIVE10";
const request = { variantId: target, promotionId, quantity: 1 };
let active = "owned synthetic identity", passed = 0, maxConcurrentWaitingTransactions = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const within = async (promise, timeoutMs, code) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
};
const row = async scope => (await prisma.$queryRaw`SELECT * FROM storefront_carts WHERE merchant_id=${scope.merchantId} AND session_id=${scope.cartId}`)[0];
const counts = async scope => {
  const [result] = await prisma.$queryRaw`SELECT
    (SELECT COUNT(*)::int FROM coupon_redemptions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.cartId} AND status!='cancelled') AS reservations,
    (SELECT COUNT(*)::int FROM outbox_messages WHERE merchant_id=${scope.merchantId} AND payload->>'session_id'=${scope.cartId}) AS events,
    (SELECT COUNT(*)::int FROM synthetic_cross_sell_changes WHERE cart_id=${scope.cartId}) AS changes`;
  return result;
};
const reset = async () => {
  await prisma.$executeRaw`DELETE FROM outbox_messages`;
  await prisma.$executeRaw`DELETE FROM coupons`;
  await prisma.$executeRaw`DELETE FROM storefront_carts`;
  await prisma.$executeRaw`DELETE FROM synthetic_cross_sell_changes`;
  await prisma.$executeRaw`DELETE FROM cross_sell_promotions`;
  await prisma.$executeRaw`DELETE FROM product_promotions`;
  await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=10000,cost_in_cents=2000,currency='BRL' WHERE variant_id IN (${host},${target})`;
  await prisma.$executeRaw`INSERT INTO merchant_rules(id,merchant_id,max_discount_percent,minimum_margin_percent,
    allow_free_shipping,allow_shipping_discount,allow_bonus_item,allow_stack_discount_and_free_shipping,coupon_box_enabled,
    autonomous_engine_enabled,free_shipping_min_cart_value,max_shipping_subsidy,max_partial_shipping_discount,
    offer_expiration_minutes,blocked_regions,brand_voice)
    VALUES ('synthetic-policy',${merchantId},20,10,TRUE,TRUE,FALSE,FALSE,TRUE,TRUE,250,45,20,15,ARRAY[]::TEXT[],'consultative')
    ON CONFLICT(merchant_id) DO UPDATE SET max_discount_percent=20,minimum_margin_percent=10,autonomous_engine_enabled=TRUE`;
  await prisma.$executeRaw`UPDATE checkout_settings SET advanced_rules='[]'::jsonb WHERE merchant_id=${merchantId}`;
  await prisma.$executeRaw`INSERT INTO cross_sell_promotions(id,merchant_id,name,trigger,recommended_skus,discount_percent,max_discount_percent,status,starts_at,ends_at,updated_at)
    VALUES (${promotionId},${merchantId},'Synthetic benefit','{"sku_in_cart":["synthetic-sku"]}'::jsonb,ARRAY['other-current-sku'],10,10,'active','2000-01-01','2100-01-01','2026-10-18')`;
  await prisma.$executeRaw`INSERT INTO coupons(id,merchant_id,code,discount_type,discount_value,starts_at,ends_at,updated_at)
    VALUES ('synthetic-coupon',${merchantId},${code},'percent',10,'2000-01-01','2100-01-01','2026-10-18')`;
};
const provision = async cartId => {
  const scope = { merchantId, cartId };
  const items = [{ variantId: host, productId: "synthetic-product", sku: "synthetic-sku", name: "Synthetic catalog name",
    categoryId: "synthetic-category", quantity: 1, unitPriceCents: 10000 }];
  await prisma.$executeRaw`INSERT INTO storefront_carts(id,merchant_id,session_id,items,total,updated_at,expires_at)
    VALUES (${cartId},${merchantId},${cartId},${JSON.stringify(items)}::jsonb,10000,'2020-01-01','2100-01-01')`;
  return scope;
};
const waitFor = async (query, expected, label) => {
  let observed = 0;
  const end = Date.now() + 9000;
  do {
    observed = await query();
    if (observed === expected) return observed;
    await pause(20);
  } while (Date.now() < end);
  assert.equal(observed, expected, label);
};
const hold = async (acquire) => {
  let ready, rejectReady, release;
  const acquired = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; });
  const released = new Promise(resolve => { release = resolve; });
  const done = prisma.$transaction(async tx => { await acquire(tx); ready(); await released; }, { timeout: 30000 });
  void done.catch(rejectReady);
  await within(acquired, 10000, "synthetic_native_lock_acquisition_timeout");
  return { release, done };
};
const advisoryGateWaiters = async key => (await prisma.$queryRaw`SELECT COUNT(DISTINCT l.pid)::int AS waiting
  FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${parsedUrl.searchParams.get("application_name")}
  AND l.locktype='advisory' AND NOT l.granted AND l.classid=0 AND l.objid=${key}::oid`)[0].waiting;
const cartWaiters = async () => (await prisma.$queryRaw`SELECT COUNT(DISTINCT l.pid)::int AS waiting
  FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${parsedUrl.searchParams.get("application_name")}
  AND l.locktype='advisory' AND NOT l.granted AND NOT (l.classid=0 AND l.objid IN (7393901,7393902))`)[0].waiting;
const review = error => typeof error?.getStatus === "function" && error.getStatus() === 422
  && error.getResponse()?.code === "cross_sell_quote_review_required";
const noPrivateFields = value => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/cost|margin|merchantRules|trustedBuyerGlobalUserId/i.test(key), "private_authority_must_not_leak");
    noPrivateFields(child);
  }
};

try {
  await prisma.$connect();
  assert.deepEqual(await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`, [{ database: "storefront_synthetic", run_id: runId }]);
  await check("real Prisma mapped coupon, redemption and outbox projections exist", async () => {
    await prisma.coupon.findMany({ take: 1 }); await prisma.couponRedemption.findMany({ take: 1 }); await prisma.outboxMessage.findMany({ take: 1 });
  });
  assert.equal(probe, false, "missing_coupon_probe_unexpectedly_succeeded");
  const { PrismaStorefrontCrossSellCartAdapter } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.ts");
  const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
  const { RulesEngineDiscountAdapter } = await import("../src/modules/coupons/infrastructure/adapters/rules-engine-discount.adapter.ts");
  const crossSell = new PrismaStorefrontCrossSellCartAdapter(prisma), carts = new PrismaStorefrontCartRepository(prisma), engine = new RulesEngineDiscountAdapter();

  if (legacy) {
    await check("legacy separate commits must not leave an active coupon reservation beside an accepted cross-sell", async () => {
      const { createCartHandlers } = await import("../src/modules/storefront/infrastructure/tool-handlers/cart.handlers.ts");
      const { ApplyCouponUseCase } = await import("../src/modules/coupons/application/use-cases/apply-coupon.use-case.ts");
      const { PrismaCouponRepository } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon.repository.ts");
      const { PrismaCouponTransactionRepository } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts");
      const { PrismaMerchantRepository } = await import("../src/modules/merchant/infrastructure/prisma-merchant.repository.ts");
      const { PrismaProductPromotionRepository } = await import("../src/modules/catalog/infrastructure/repositories/prisma-product-promotion.repository.ts");
      await reset(); const scope = await provision("native-legacy-separated"), quote = await crossSell.quote(scope, request);
      const realUseCase = new ApplyCouponUseCase(new PrismaCouponRepository(prisma), new PrismaCouponTransactionRepository(prisma), engine);
      let release, signalCommitted, rejectCommitted;
      const committed = new Promise((resolve, reject) => { signalCommitted = resolve; rejectCommitted = reject; });
      const resume = new Promise(resolve => { release = resolve; });
      const handlers = createCartHandlers({ prisma, cartRepo: carts, merchantRepo: new PrismaMerchantRepository(prisma),
        productPromotionRepo: new PrismaProductPromotionRepository(prisma),
        applyCouponUseCase: { execute: async input => { const result = await realUseCase.execute(input); signalCommitted(); await resume; return result; } } },
      { merchantId, sessionId: scope.cartId });
      const pending = handlers.applyCoupon({ couponCode: code });
      void pending.catch(rejectCommitted);
      let handlerError;
      try {
        await within(Promise.race([committed, pending.then(() => { throw new Error("legacy_handler_contract_replaced"); })]),
          10000, "legacy_coupon_commit_barrier_timeout");
        assert.deepEqual(await counts(scope), { reservations: 1, events: 1, changes: 0 });
        await crossSell.accept(scope, { expectedQuote: quote });
      } finally {
        release();
        try { await pending; } catch (error) { handlerError = error; }
      }
      assert.equal(handlerError?.code, "store_tool_outcome_unknown");
      const stored = await row(scope), evidence = await counts(scope);
      assert.equal(stored.coupon_code, null); assert.ok(stored.items.some(item => item.crossSellIntent !== undefined));
      console.log(JSON.stringify({ legacySeparateCommitObserved: true, outcomeUnknown: true,
        acceptedIntent: true, activeReservations: evidence.reservations, appliedEvents: evidence.events }));
      // Intentionally RED against the original runtime. Do not invert this
      // invariant to make the broken legacy choreography appear acceptable.
      assert.equal(evidence.reservations, 0, "legacy_separate_commit_left_orphan_reservation");
      assert.equal(evidence.events, 0, "legacy_separate_commit_left_orphan_applied_event");
    });
  } else {
    const { PrismaStorefrontCouponCartAdapter } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-coupon-cart.adapter.ts");
    const { PrismaCouponRepository } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon.repository.ts");
    const { PrismaCouponTransactionRepository } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts");
    const { PrismaProductPromotionRepository } = await import("../src/modules/catalog/infrastructure/repositories/prisma-product-promotion.repository.ts");
    const { readExistingPrismaMerchantRules } = await import("../src/modules/merchant/infrastructure/prisma-merchant.repository.ts");
    const dependencies = {
      couponsFor: tx => new PrismaCouponRepository(tx),
      transactionsFor: tx => new PrismaCouponTransactionRepository(tx, true),
      promotionsFor: tx => new PrismaProductPromotionRepository(tx),
      readExistingRules: readExistingPrismaMerchantRules,
    };
    const coupon = new PrismaStorefrontCouponCartAdapter(prisma, engine, dependencies);
    await check("atomic coupon application persists cart, reservation and event together", async () => {
      await reset(); const scope = await provision("native-coupon-success");
      const result = await coupon.apply(scope, { code });
      assert.equal(result.applied, true); assert.equal(result.couponCode, code);
      const stored = await row(scope);
      assert.equal(stored.coupon_code, code); assert.equal(stored.discount, 1000);
      assert.deepEqual(await counts(scope), { reservations: 1, events: 1, changes: 1 });
      noPrivateFields(result);
      const [redemption] = await prisma.couponRedemption.findMany({ where: { merchantId, sessionId: scope.cartId } });
      assert.equal(Number(redemption.discountApplied), result.discount);
      const after = await row(scope), duplicate = await coupon.apply(scope, { code });
      assert.equal(duplicate.applied, false); assert.equal(duplicate.reason, "CHECKOUT_COMMERCIAL_BENEFIT_ALREADY_APPLIED");
      assert.deepEqual(await row(scope), after); assert.deepEqual(await counts(scope), { reservations: 1, events: 1, changes: 1 });
    });
    await check("product promotion plus coupon respects one company cap with cent-exact public projection and base persistence", async () => {
      await reset(); const scope = await provision("native-product-and-coupon");
      await prisma.$executeRaw`UPDATE coupons SET discount_value=20 WHERE id='synthetic-coupon'`;
      await prisma.$executeRaw`INSERT INTO product_promotions(id,merchant_id,variant_id,discount_type,discount_value,is_active,starts_at,ends_at)
        VALUES ('synthetic-product-promo',${merchantId},${host},'percent',10,TRUE,'2000-01-01','2100-01-01')`;
      const result = await coupon.apply(scope, { code });
      assert.equal(result.applied, true); assert.equal(result.total, 90); assert.equal(result.discountCents, 1000); assert.equal(result.newTotal, 80);
      assert.equal(result.items[0].unitPrice, 90); assert.equal(result.items[0].originalPrice, 100);
      assert.equal(result.commercialNotices[0].code, "discount_limit_reached"); noPrivateFields(result);
      const stored = await row(scope); assert.equal(stored.items[0].unitPriceCents, 10000); assert.equal(stored.total, 10000); assert.equal(stored.discount, 1000);
      assert.deepEqual(await counts(scope), { reservations: 1, events: 1, changes: 1 });
    });
    await check("fractional coupon percent and company ceiling never round above the authorized cent budget", async () => {
      await reset(); const scope = await provision("native-cent-ceiling");
      await prisma.$executeRaw`UPDATE coupons SET discount_value=20.125 WHERE id='synthetic-coupon'`;
      await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=10001 WHERE variant_id=${host}`;
      const stored = await row(scope); stored.items[0].unitPriceCents = 10001;
      await prisma.$executeRaw`UPDATE storefront_carts SET items=${JSON.stringify(stored.items)}::jsonb,total=10001 WHERE session_id=${scope.cartId}`;
      const result = await coupon.apply(scope, { code });
      assert.equal(result.applied, true); assert.equal(result.discountCents, 2000); assert.equal(Math.round(result.newTotal * 100), 8001);
      const [redemption] = await prisma.couponRedemption.findMany({ where: { merchantId, sessionId: scope.cartId } });
      assert.equal(Number(redemption.discountApplied), 20); assert.equal((await row(scope)).discount, 2000); noPrivateFields(result);
    });
    for (const [cartId, marker] of [["native-outbox-failure", "synthetic_coupon_outbox_failure"],
      ["native-deferred-failure", "synthetic_coupon_deferred_failure"], ["update-error", "synthetic_cart_update_rejection"]]) {
      await check(`real ${marker} rolls back reservation, outbox, cart and TTL`, async () => {
        await reset(); const scope = await provision(cartId), before = await row(scope);
        await assert.rejects(coupon.apply(scope, { code }), error => typeof error?.message === "string" && error.message.includes(marker));
        assert.deepEqual(await row(scope), before); assert.deepEqual(await counts(scope), { reservations: 0, events: 0, changes: 0 });
      });
    }
    await check("real same-transaction cart snapshot conflict rolls back the preceding reservation and event", async () => {
      await reset(); const scope = await provision("native-cas-failure"), before = await row(scope);
      await assert.rejects(coupon.apply(scope, { code }), error => error?.code === "storefront_cart_snapshot_conflict");
      assert.deepEqual(await row(scope), before); assert.deepEqual(await counts(scope), { reservations: 0, events: 0, changes: 0 });
    });
    for (const first of ["coupon", "cross-sell"]) {
      await check(`${first} commits first while twenty real opponents await the same cart lock without stacking or orphaning`, async () => {
        await reset(); const scope = await provision(`native-${first}-first`), quote = await crossSell.quote(scope, request);
        const key = first === "coupon" ? 7393901 : 7393902;
        const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}::bigint)`);
        let leader, opponents;
        try {
          leader = Promise.allSettled([first === "coupon" ? coupon.apply(scope, { code }) : crossSell.accept(scope, { expectedQuote: quote })]);
          await waitFor(() => advisoryGateWaiters(key), 1, "leader_holds_cart_while_waiting_for_synthetic_gate");
          opponents = Promise.allSettled(Array.from({ length: 20 }, () => first === "coupon"
            ? crossSell.accept(scope, { expectedQuote: quote }) : coupon.apply(scope, { code })));
          maxConcurrentWaitingTransactions = Math.max(maxConcurrentWaitingTransactions,
            await waitFor(cartWaiters, 20, "twenty_opponents_must_wait_for_real_shared_cart_lock"));
        } finally { gate.release(); await gate.done; if (leader) await leader; if (opponents) await opponents; }
        const [winner] = await leader, results = await opponents;
        assert.equal(winner.status, "fulfilled");
        if (first === "coupon") {
          assert.equal(winner.value.applied, true);
          assert.equal(results.filter(result => result.status === "rejected" && review(result.reason)).length, 20);
          assert.deepEqual(await counts(scope), { reservations: 1, events: 1, changes: 1 });
          assert.equal((await row(scope)).items.length, 1);
        } else {
          assert.equal(winner.value.status, "accepted");
          assert.equal(results.filter(result => result.status === "fulfilled" && result.value.applied === false
            && result.value.reason === "commercial_benefit_review_required").length, 20);
          assert.deepEqual(await counts(scope), { reservations: 0, events: 0, changes: 1 });
          assert.equal((await row(scope)).items.length, 2);
        }
      });
    }
    for (const status of ["applied", "redeemed", "cancelled"]) {
      await check(`legacy ${status} reservation is checked even when the cart has no coupon marker`, async () => {
        await reset(); const scope = await provision(`native-legacy-${status}`), quote = await crossSell.quote(scope, request);
        await prisma.$executeRaw`INSERT INTO coupon_redemptions(id,coupon_id,merchant_id,session_id,discount_applied,source,status,updated_at)
          VALUES ('synthetic-legacy','synthetic-coupon',${merchantId},${scope.cartId},10,'manual',${status},'2020-01-01')`;
        const before = await row(scope);
        if (status === "cancelled") {
          await crossSell.accept(scope, { expectedQuote: quote }); assert.equal((await row(scope)).items.length, 2);
          assert.deepEqual(await counts(scope), { reservations: 0, events: 0, changes: 1 });
        } else {
          await assert.rejects(crossSell.accept(scope, { expectedQuote: quote }), review);
          await assert.rejects(crossSell.quote(scope, request), review);
          const result = await coupon.apply(scope, { code });
          assert.equal(result.applied, false); assert.equal(result.reason, "CHECKOUT_COMMERCIAL_BENEFIT_ALREADY_APPLIED");
          assert.deepEqual(await row(scope), before); assert.deepEqual(await counts(scope), { reservations: 1, events: 0, changes: 0 });
        }
      });
    }
    for (const change of ["pause", "restriction"]) {
      await check(`coupon descriptor ${change} committed before the coupon lock is read and refused rather than using a stale snapshot`, async () => {
        await reset(); const scope = await provision(`native-locked-${change}`), before = await row(scope);
        const gate = await hold(async tx => {
          await tx.$queryRaw`SELECT id FROM coupons WHERE id='synthetic-coupon' FOR UPDATE`;
          if (change === "pause") await tx.$executeRaw`UPDATE coupons SET status='paused' WHERE id='synthetic-coupon'`;
          else await tx.$executeRaw`UPDATE coupons SET blocked_skus=ARRAY['synthetic-sku'] WHERE id='synthetic-coupon'`;
        });
        const pending = Promise.allSettled([coupon.apply(scope, { code })]);
        try {
          await waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(DISTINCT l.pid)::int AS waiting FROM pg_locks l
            JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${parsedUrl.searchParams.get("application_name")}
            AND l.locktype='transactionid' AND NOT l.granted`)[0].waiting, 1, "real_coupon_row_lock_must_be_contended");
        } finally { gate.release(); await gate.done; await pending; }
        const [result] = await pending; assert.equal(result.status, "fulfilled"); assert.equal(result.value.applied, false);
        assert.equal(result.value.reason, change === "pause" ? "COUPON_INVALID" : "COUPON_SKU_BLOCKED");
        assert.deepEqual(await row(scope), before); assert.deepEqual(await counts(scope), { reservations: 0, events: 0, changes: 0 });
      });
    }
    for (const [kind, reason] of [["cost", "COUPON_DISCOUNT_REJECTED:product_cost_missing"], ["margin", "COUPON_DISCOUNT_REJECTED:minimum_margin_violation"],
      ["policy", "merchant_rules_unavailable"], ["cap", "discount_disabled_by_merchant"], ["currency", "commercial_benefit_review_required"],
      ["buyer", "COUPON_BUYER_IDENTITY_REQUIRED"], ["region-allow", "COUPON_BUYER_REGION_REQUIRED"], ["region-block", "COUPON_BUYER_REGION_REQUIRED"],
      ["expired", "COUPON_EXPIRED"], ["foreign-code", "COUPON_NOT_FOUND"], ["shipping", "COUPON_SHIPPING_NOT_CALCULATED"]]) {
      await check(`unavailable ${kind} authority refuses with a specific reason and no cart, TTL, reservation or event write`, async () => {
        await reset(); const scope = await provision(`native-denied-${kind}`), before = await row(scope);
        let inputCode = code;
        if (kind === "cost") await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=NULL WHERE variant_id=${host}`;
        else if (kind === "margin") await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=9500 WHERE variant_id=${host}`;
        else if (kind === "policy") await prisma.$executeRaw`DELETE FROM merchant_rules WHERE merchant_id=${merchantId}`;
        else if (kind === "cap") await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=0 WHERE merchant_id=${merchantId}`;
        else if (kind === "currency") await prisma.$executeRaw`UPDATE product_prices SET currency='USD' WHERE variant_id=${host}`;
        else if (kind === "buyer") await prisma.$executeRaw`UPDATE coupons SET max_per_buyer=1 WHERE id='synthetic-coupon'`;
        else if (kind === "region-allow") await prisma.$executeRaw`UPDATE coupons SET allowed_regions=ARRAY['SP'] WHERE id='synthetic-coupon'`;
        else if (kind === "region-block") await prisma.$executeRaw`UPDATE coupons SET blocked_regions=ARRAY['SP'] WHERE id='synthetic-coupon'`;
        else if (kind === "expired") await prisma.$executeRaw`UPDATE coupons SET ends_at='2000-01-01' WHERE id='synthetic-coupon'`;
        else if (kind === "shipping") await prisma.$executeRaw`UPDATE coupons SET discount_type='shipping_free' WHERE id='synthetic-coupon'`;
        else {
          inputCode = "FOREIGNONLY";
          await prisma.$executeRaw`INSERT INTO coupons(id,merchant_id,code,discount_type,discount_value,starts_at,updated_at)
            VALUES ('foreign-coupon','foreign-merchant',${inputCode},'percent',10,'2000-01-01','2020-01-01')`;
        }
        const result = await coupon.apply(scope, { code: inputCode });
        assert.equal(result.applied, false); assert.equal(result.reason, reason); noPrivateFields(result);
        assert.deepEqual(await row(scope), before); assert.deepEqual(await counts(scope), { reservations: 0, events: 0, changes: 0 });
      });
    }
    await check("trusted buyer identity is persisted and a real per-buyer reservation limit refuses another cart", async () => {
      await reset(); const first = await provision("native-trusted-buyer-first"), second = await provision("native-trusted-buyer-second");
      await prisma.$executeRaw`UPDATE coupons SET max_per_buyer=1 WHERE id='synthetic-coupon'`;
      assert.equal((await coupon.apply(first, { code, trustedBuyerGlobalUserId: "synthetic-buyer" })).applied, true);
      const before = await row(second), result = await coupon.apply(second, { code, trustedBuyerGlobalUserId: "synthetic-buyer" });
      assert.equal(result.applied, false); assert.equal(result.reason, "COUPON_PER_BUYER_LIMIT_REACHED");
      const [redemption] = await prisma.couponRedemption.findMany({ where: { merchantId, sessionId: first.cartId } });
      assert.equal(redemption.buyerGlobalUserId, "synthetic-buyer");
      assert.deepEqual(await row(second), before); assert.deepEqual(await counts(second), { reservations: 0, events: 0, changes: 0 });
    });
    await check("a failure after a real transaction commits remains uncertain with one persisted effect and no implicit retry", async () => {
      await reset(); const scope = await provision("native-commit-ack-lost"), failure = new Error("synthetic_commit_ack_lost");
      let transactions = 0;
      const acknowledgementLost = new Proxy(prisma, { get(target, property) {
        if (property === "$transaction") return async (...parameters) => { transactions++; await target.$transaction(...parameters); throw failure; };
        const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
      } });
      const uncertain = new PrismaStorefrontCouponCartAdapter(acknowledgementLost, engine, dependencies);
      await assert.rejects(uncertain.apply(scope, { code }), error => error === failure);
      assert.equal(transactions, 1); assert.equal((await row(scope)).coupon_code, code);
      assert.deepEqual(await counts(scope), { reservations: 1, events: 1, changes: 1 });
    });
  }
  console.log(JSON.stringify({ status: "passed", checks: passed, maxConcurrentWaitingTransactions,
    prismaClientCount: 1, poolLimit: 24, realProviderCalls: 0, publicEndpointProof: false, externalExactlyOnceProof: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", check: active, checksPassed: passed, maxConcurrentWaitingTransactions,
    error: typeof error?.code === "string" ? error.code : error?.constructor?.name ?? "Error",
    diagnostic: ["legacy_handler_contract_replaced", "legacy_coupon_commit_barrier_timeout"].includes(error?.message) ? error.message : undefined,
    location: typeof error?.stack === "string" ? error.stack.split("\n").find(line => line.includes("storefront-coupon-cross-sell.native-worker.mjs:"))?.trim() : undefined }));
  throw new Error("native_coupon_cross_sell_assertion_failed");
} finally { await prisma.$disconnect(); }
