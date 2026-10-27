import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const args = process.argv.slice(2), [url, runId] = args, probe = args[2] === "--probe-missing-cross-sell-table";
assert.equal(args.length, probe ? 3 : 2);
const parsedUrl = assertNativePrismaUrl(url);
assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_cross_sell_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const merchantId = "synthetic-merchant", target = "other-variant", host = "synthetic-variant", promotionId = "synthetic-cross-sell";
let active = "owned synthetic identity", passed = 0, waitingTransactions = 0;
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const review = error => typeof error?.getStatus === "function" && error.getStatus() === 422
  && error.getResponse()?.code === "cross_sell_quote_review_required";
const row = async scope => (await prisma.$queryRaw`SELECT * FROM storefront_carts WHERE merchant_id=${scope.merchantId} AND session_id=${scope.cartId}`)[0];
const changes = async scope => (await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM synthetic_cross_sell_changes WHERE cart_id=${scope.cartId}`)[0].count;
const request = { variantId: target, promotionId, quantity: 1 };
const reset = async (rules = []) => {
  await prisma.$executeRaw`UPDATE products SET metadata='{}'::jsonb WHERE merchant_id=${merchantId} AND id IN ('synthetic-product','other-product')`;
  await prisma.$executeRaw`DELETE FROM cross_sell_promotions`;
  await prisma.$executeRaw`DELETE FROM product_promotions`;
  await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=10000,cost_in_cents=2000,currency='BRL' WHERE variant_id IN (${host},${target})`;
  await prisma.$executeRaw`INSERT INTO product_prices(id,variant_id,base_price_in_cents,cost_in_cents)
    VALUES ('other-price',${target},10000,2000) ON CONFLICT(variant_id) DO UPDATE SET base_price_in_cents=10000,cost_in_cents=2000,currency='BRL'`;
  await prisma.$executeRaw`UPDATE product_stock SET quantity=1000,reserved=0 WHERE variant_id IN (${host},${target})`;
  await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=20,minimum_margin_percent=10,autonomous_engine_enabled=TRUE WHERE merchant_id=${merchantId}`;
  await prisma.$executeRaw`UPDATE checkout_settings SET advanced_rules=${JSON.stringify(rules)}::jsonb WHERE merchant_id=${merchantId}`;
  await prisma.$executeRaw`INSERT INTO cross_sell_promotions(id,merchant_id,name,trigger,recommended_skus,discount_percent,max_discount_percent,status,starts_at,ends_at,updated_at)
    VALUES (${promotionId},${merchantId},'Synthetic local benefit','{"sku_in_cart":["synthetic-sku"]}'::jsonb,ARRAY['other-current-sku'],10,10,'active','2000-01-01','2100-01-01','2026-10-18')`;
};
const provision = async (cartId, suppliedItems) => {
  const scope = { merchantId, cartId };
  const items = suppliedItems ?? [{ variantId: host, productId: "synthetic-product", sku: "synthetic-sku", name: "Synthetic catalog name",
    categoryId: "synthetic-category", quantity: 1, unitPriceCents: 10000 }];
  const total = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  await prisma.$executeRaw`INSERT INTO storefront_carts(id,merchant_id,session_id,items,total,updated_at,expires_at)
    VALUES (${cartId},${merchantId},${cartId},${JSON.stringify(items)}::jsonb,${total},'2020-01-01','2100-01-01')`;
  return scope;
};
const breakAuthority = async kind => {
  if (kind === "cost") await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=NULL WHERE variant_id=${target}`;
  else if (kind === "cap") await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=0 WHERE merchant_id=${merchantId}`;
  else if (kind === "window") await prisma.$executeRaw`UPDATE cross_sell_promotions SET ends_at='2000-01-01' WHERE id=${promotionId}`;
  else if (kind === "version") await prisma.$executeRaw`UPDATE cross_sell_promotions SET updated_at=updated_at+INTERVAL '1 second' WHERE id=${promotionId}`;
  else if (kind === "trigger") await prisma.$executeRaw`UPDATE cross_sell_promotions SET trigger='{"sku_in_cart":["not-in-cart"]}'::jsonb WHERE id=${promotionId}`;
  else if (kind === "base") await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=10001 WHERE variant_id=${target}`;
  else assert.fail("unknown_synthetic_authority_case");
};

try {
  await prisma.$connect();
  const rows = await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`;
  assert.deepEqual(rows, [{ database: "storefront_synthetic", run_id: runId }]);
  await check("real Prisma requires the mapped cross-sell table before loading the adapter", async () => {
    await prisma.crossSellPromotion.findMany({ select: { id: true }, take: 1 });
  });
  assert.equal(probe, false, "missing_cross_sell_probe_unexpectedly_succeeded");
  const { PrismaStorefrontCrossSellCartAdapter } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.ts");
  const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
  const adapter = new PrismaStorefrontCrossSellCartAdapter(prisma), carts = new PrismaStorefrontCartRepository(prisma);

  await check("quote simulates post-add pricing with no cart write or TTL renewal", async () => {
    await reset(); const scope = await provision("native-quote-only"), before = await row(scope);
    const quote = await adapter.quote(scope, request);
    assert.equal(quote.maximumUnitPriceCents, 9000); assert.equal(quote.quote.promotionDiscountCents, 1000);
    assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
  });
  await check("previously valid quote cannot accept after a synthetic checkout binding appears", async () => {
    await reset(); const scope = await provision("native-bound-after-quote"), quote = await adapter.quote(scope, request);
    // Fixture-only binding, no reservation/issuer/payment claim. Real quote was
    // computed first; acceptance must refuse before any cart write or TTL.
    const checkout = "synthetic-bound-after-quote";
    const binding = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId,
      cartId: scope.cartId, checkoutSessionId: checkout, buyerId: "synthetic-buyer", reservationBuyerId: null,
      couponId: "synthetic-coupon", redemptionId: "synthetic-redemption", discountCents: 100, basisHash: "ab".repeat(32), state: "active" };
    await prisma.$executeRaw`INSERT INTO checkout_sessions(merchant_id,session_id,global_user_id,cart)
      VALUES (${merchantId},${checkout},'synthetic-buyer',${JSON.stringify({ cart_ref: scope.cartId, _storefrontCouponBinding: binding })}::jsonb)`;
    const before = await row(scope);
    await assert.rejects(adapter.accept(scope, { expectedQuote: quote }), { message: "storefront_cart_checkout_bound" });
    assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
  });
  await check("accept persists base and bounded intent plus automatic D while read projects authorized P without save", async () => {
    await reset([{ id: "synthetic-auto", name: "Synthetic rule", enabled: true, priority: 1,
      conditions: [{ field: "cart_total", operator: "gte", value: 0 }], action: { type: "offer_discount", params: { percent: 10 } } }]);
    const scope = await provision("native-accept"), quote = await adapter.quote(scope, request);
    assert.deepEqual(await adapter.accept(scope, { expectedQuote: quote }), { version: 1, status: "accepted", ...scope });
    const stored = await row(scope), line = stored.items.find(item => item.variantId === target);
    assert.equal(stored.total, 20000); assert.equal(line.unitPriceCents, 10000);
    assert.deepEqual(line.crossSellIntent, { version: 1, promotionId, promotionUpdatedAt: quote.promotionUpdatedAt,
      acceptedQuantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 });
    const automatic = quote.quote.subtotalCents - quote.quote.merchandiseTotalCents;
    assert.ok(automatic > 0); assert.equal(stored.discount, automatic); assert.equal(await changes(scope), 1);
    const projected = await adapter.project(scope);
    assert.equal(projected.items.find(item => item.variantId === target).unitPriceCents, 9000);
    assert.equal(projected.total, 19000); assert.equal(projected.discount, automatic);
    assert.deepEqual(projected.discountBudget, { version: 1, originalSubtotalCents: 20000, promotionDiscountCents: 1000 });
    assert.deepEqual(await row(scope), stored); assert.equal(await changes(scope), 1);
  });
  await check("twenty genuinely concurrent same-quote accepts commit one commercial change and refuse nineteen", async () => {
    await reset(); const scope = await provision("native-concurrent"), quote = await adapter.quote(scope, request);
    let ready, rejectReady, release;
    const acquired = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; }), released = new Promise(resolve => { release = resolve; });
    const key = JSON.stringify(["storefront-cart", merchantId, scope.cartId]);
    const holder = prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; ready(); await released; }, { timeout: 30000 });
    holder.catch(rejectReady);
    await acquired;
    const pending = Promise.allSettled(Array.from({ length: 20 }, () => adapter.accept(scope, { expectedQuote: quote })));
    try {
      const end = Date.now() + 9000;
      do {
        const [activity] = await prisma.$queryRaw`SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
          WHERE application_name=${parsedUrl.searchParams.get("application_name")} AND wait_event_type='Lock'`;
        waitingTransactions = Math.max(waitingTransactions, activity.waiting);
        if (waitingTransactions === 20) break;
        await pause(20);
      } while (Date.now() < end);
    } finally { release(); await holder; }
    const results = await pending;
    assert.equal(waitingTransactions, 20); assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected" && review(result.reason)).length, 19);
    const stored = await row(scope); assert.equal(stored.items.filter(item => item.variantId === target).length, 1);
    assert.equal(stored.items.find(item => item.variantId === target).quantity, 1); assert.equal(await changes(scope), 1);
  });
  for (const kind of ["cost", "cap", "window", "version", "trigger", "base"]) {
    await check(kind === "cost" ? "optional missing cost does not change the agreed capped acceptance"
      : `stale ${kind} authority rejects acceptance without changing cart or TTL`, async () => {
      await reset(); const scope = await provision(`native-accept-deny-${kind}`), quote = await adapter.quote(scope, request);
      await breakAuthority(kind); const before = await row(scope);
      if (kind === "cost") {
        await adapter.accept(scope, { expectedQuote: quote });
        assert.equal((await row(scope)).items.find(item => item.variantId === target).crossSellIntent.maximumUnitPriceCents, 9000);
        assert.equal(await changes(scope), 1);
      } else {
        await assert.rejects(adapter.accept(scope, { expectedQuote: quote }), review);
        assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
      }
    });
    await check(kind === "cost" ? "optional missing cost keeps projected accepted price without TTL/write"
      : `persisted ${kind} authority rejects projected read without base fallback or TTL write`, async () => {
      await reset(); const scope = await provision(`native-read-deny-${kind}`), quote = await adapter.quote(scope, request);
      await adapter.accept(scope, { expectedQuote: quote }); await breakAuthority(kind); const before = await row(scope);
      if (kind === "cost") assert.equal((await adapter.project(scope)).items.find(item => item.variantId === target).unitPriceCents, 9000);
      else await assert.rejects(adapter.project(scope), review);
      assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 1);
    });
  }
  const waitForBlockedAuthority = async () => {
    const deadline = Date.now() + 8000;
    do {
      const [activity] = await prisma.$queryRaw`SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
        WHERE application_name=${parsedUrl.searchParams.get("application_name")} AND wait_event_type='Lock'`;
      if (activity.waiting >= 1) return;
      await pause(20);
    } while (Date.now() < deadline);
    assert.fail("authority_row_wait_not_observed");
  };
  const editAuthority = async (tx, kind) => {
    if (kind === "cap") await tx.$executeRaw`UPDATE merchant_rules SET max_discount_percent=0 WHERE merchant_id=${merchantId}`;
    else if (kind === "price") await tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=10001 WHERE variant_id=${target}`;
    else if (kind === "stock") await tx.$executeRaw`UPDATE product_stock SET quantity=0 WHERE variant_id=${target}`;
    else if (kind === "version") await tx.$executeRaw`UPDATE cross_sell_promotions SET updated_at=updated_at+INTERVAL '1 second' WHERE id=${promotionId}`;
    else if (kind === "delete-price") await tx.$executeRaw`DELETE FROM product_prices WHERE variant_id=${target}`;
    else if (kind === "delete-promotion") await tx.$executeRaw`DELETE FROM cross_sell_promotions WHERE id=${promotionId}`;
    else assert.fail("unsupported_owned_authority_edit");
  };
  for (const kind of ["cap", "price", "stock", "version", "delete-price", "delete-promotion"]) {
    await check(`admin ${kind} UPDATE/DELETE first blocks acceptance then rereads committed authority without cart writes`, async () => {
      await reset(); const scope = await provision(`native-admin-first-${kind}`), quote = await adapter.quote(scope, request), before = await row(scope);
      let acquired, rejectAcquired, release;
      const ready = new Promise((resolve, reject) => { acquired = resolve; rejectAcquired = reject; });
      const gate = new Promise(resolve => { release = resolve; });
      const editor = prisma.$transaction(async tx => { await editAuthority(tx, kind); acquired(); await gate; }, { timeout: 30000 });
      editor.catch(rejectAcquired); await ready;
      const pending = Promise.allSettled([adapter.accept(scope, { expectedQuote: quote })]);
      try { await waitForBlockedAuthority(); } finally { release(); await editor; }
      const [result] = await pending;
      assert.equal(result.status, "rejected"); assert.ok(review(result.reason));
      assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
    });
  }
  // Pause the real adapter immediately before its cart UPDATE, after every
  // authority reader and row lock. No alternate quote/money implementation.
  const pausedAdapter = (onReady, wait, failAfterWrite = false) => new PrismaStorefrontCrossSellCartAdapter(new Proxy(prisma, {
    get(client, member) {
      if (member === "$transaction") return (work, options) => client.$transaction(tx => work(new Proxy(tx, {
        get(transaction, model) {
          if (model === "storefrontCart") return new Proxy(transaction.storefrontCart, { get(delegate, operation) {
            if (operation === "update") return async args => {
              onReady(); await wait;
              const result = await delegate.update(args);
              if (failAfterWrite) throw new Error("synthetic_cross_sell_after_write_rollback");
              return result;
            };
            const value = Reflect.get(delegate, operation); return typeof value === "function" ? value.bind(delegate) : value;
          } });
          const value = Reflect.get(transaction, model); return typeof value === "function" ? value.bind(transaction) : value;
        },
      })), options);
      const value = Reflect.get(client, member); return typeof value === "function" ? value.bind(client) : value;
    },
  }));
  for (const kind of ["cap", "price", "version"]) for (const rollback of [false, true]) {
    await check(`acceptance locks ${kind} authority before admin writer; ${rollback ? "rollback releases every row without partial grant" : "commit preserves the displayed maximum"}`, async () => {
      await reset(); const scope = await provision(`native-accept-first-${kind}-${rollback}`), quote = await adapter.quote(scope, request), before = await row(scope);
      let acquired, release;
      const ready = new Promise(resolve => { acquired = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const current = pausedAdapter(acquired, gate, rollback);
      const acceptance = Promise.allSettled([current.accept(scope, { expectedQuote: quote })]);
      await ready;
      const editor = prisma.$transaction(tx => editAuthority(tx, kind), { timeout: 30000 });
      const edited = Promise.allSettled([editor]);
      try { await waitForBlockedAuthority(); } finally { release(); }
      const [result] = await acceptance; const [edit] = await edited;
      assert.equal(edit.status, "fulfilled");
      if (rollback) {
        assert.equal(result.status, "rejected");
        assert.match(result.reason.message, /synthetic_cross_sell_after_write_rollback/);
        assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
      } else {
        assert.equal(result.status, "fulfilled");
        const stored = await row(scope), line = stored.items.find(item => item.variantId === target);
        assert.equal(line.crossSellIntent.maximumUnitPriceCents, quote.maximumUnitPriceCents);
        assert.equal(line.unitPriceCents, 10000); assert.equal(await changes(scope), 1);
        await assert.rejects(adapter.project(scope), review);
        assert.deepEqual(await row(scope), stored, "later refusal cannot silently reprice to full base or refresh TTL");
      }
    });
  }
  await check("ordinary merge, excess quantity and removing its required trigger roll back complete cart and TTL", async () => {
    await reset(); const scope = await provision("native-plain-and-quantity"), quote = await adapter.quote(scope, request);
    await adapter.accept(scope, { expectedQuote: quote }); const before = await row(scope);
    const plain = { ...before.items.find(item => item.variantId === target) }; delete plain.crossSellIntent;
    for (const mutate of [() => carts.addItem(merchantId, scope.cartId, plain),
      () => carts.updateItemQuantity(merchantId, scope.cartId, target, 2), () => carts.removeItem(merchantId, scope.cartId, host)]) {
      await assert.rejects(mutate(), review); assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 1);
    }
  });
  await check("explicit removal repairs expired accepted target instead of blocking repair or silently repricing", async () => {
    await reset(); const scope = await provision("native-expired-repair"), quote = await adapter.quote(scope, request);
    await adapter.accept(scope, { expectedQuote: quote }); await breakAuthority("window"); const before = await row(scope);
    await assert.rejects(carts.getOrCreate(merchantId, scope.cartId), review); assert.deepEqual(await row(scope), before);
    await carts.removeItem(merchantId, scope.cartId, target);
    const repaired = await row(scope); assert.equal(repaired.items.length, 1); assert.equal(repaired.items[0].variantId, host);
    assert.equal(repaired.total, 10000); assert.equal(repaired.discount, 0); assert.equal(await changes(scope), 2);
  });
  const option = (itemId, priceModifierInCents) => ({ groupId: "extras", groupName: "Extras", itemId, itemName: itemId, priceModifierInCents });
  const metadata = (items, required = false) => ({ optionGroups: [{ id: "extras", name: "Extras", selectionType: "multiple", required,
    items: items.map(item => ({ id: item.itemId, name: item.itemName, priceModifierInCents: item.priceModifierInCents })) }] });
  const configureOptions = async () => {
    await prisma.$executeRaw`UPDATE products SET metadata=${JSON.stringify(metadata([option("size", 500), option("color", 1000)]))}::jsonb WHERE id='synthetic-product' AND merchant_id=${merchantId}`;
    await prisma.$executeRaw`UPDATE products SET metadata=${JSON.stringify(metadata([option("target-size", 1500)], true))}::jsonb WHERE id='other-product' AND merchant_id=${merchantId}`;
  };
  const optionRequest = { ...request, selectedOptionItemIds: ["target-size"] };
  const optionLines = () => [{ variantId: host, productId: "synthetic-product", sku: "synthetic-sku", name: "Synthetic catalog name", categoryId: "synthetic-category",
    quantity: 1, unitPriceCents: 10500, selectedOptions: [option("size", 500)] },
  { variantId: host, productId: "synthetic-product", sku: "synthetic-sku", name: "Synthetic catalog name", categoryId: "synthetic-category",
    quantity: 2, unitPriceCents: 11000, selectedOptions: [option("color", 1000)] }];
  const changeTargetMetadata = tx => tx.$executeRaw`UPDATE products SET metadata=${JSON.stringify(metadata([option("target-size", 1501)], true))}::jsonb WHERE id='other-product' AND merchant_id=${merchantId}`;
  await check("canonical full option base and distinct same-variant lines survive real quote accept and read without cost", async () => {
    await reset(); await configureOptions();
    await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=NULL WHERE variant_id IN (${host},${target})`;
    const scope = await provision("native-option-roundtrip", optionLines()), before = await row(scope);
    const quote = await adapter.quote(scope, optionRequest);
    assert.equal(quote.originalUnitPriceCents, 11500); assert.equal(quote.maximumUnitPriceCents, 10350);
    assert.equal(quote.quote.originalSubtotalCents, 44000); assert.equal(quote.quote.subtotalCents, 42850);
    assert.deepEqual(quote.quote.items.slice(0, 2).map(item => item.selectedOptionItemIds), [["size"], ["color"]]);
    assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
    await adapter.accept(scope, { expectedQuote: quote });
    const stored = await row(scope), accepted = stored.items.find(item => item.variantId === target);
    assert.equal(accepted.unitPriceCents, 11500); assert.deepEqual(accepted.selectedOptions, [option("target-size", 1500)]);
    assert.deepEqual(accepted.crossSellIntent.selectedOptionItemIds, ["target-size"]); assert.equal(stored.total, 44000);
    const projected = await adapter.project(scope); assert.equal(projected.total, 42850); assert.equal(projected.items[2].unitPriceCents, 10350);
    assert.deepEqual(await row(scope), stored); assert.equal(await changes(scope), 1);
    assert.deepEqual((await adapter.projectForCheckout(scope)).cart, projected);
  });
  await check("required unknown or duplicate requested options never guess a selection or write the cart", async () => {
    await reset(); await configureOptions(); const scope = await provision("native-options-refused"), before = await row(scope);
    for (const selection of [request, { ...request, selectedOptionItemIds: ["foreign"] }, { ...request, selectedOptionItemIds: ["target-size", "target-size"] }])
      await assert.rejects(adapter.quote(scope, selection));
    assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
  });
  await check("admin metadata UPDATE first blocks option acceptance then rechecks changed canonical modifier and rolls back", async () => {
    await reset(); await configureOptions(); const scope = await provision("native-options-admin-first", optionLines());
    const quote = await adapter.quote(scope, optionRequest), before = await row(scope);
    let acquired, rejected, release;
    const ready = new Promise((resolve, reject) => { acquired = resolve; rejected = reject; }), gate = new Promise(resolve => { release = resolve; });
    const editor = prisma.$transaction(async tx => { await changeTargetMetadata(tx); acquired(); await gate; }, { timeout: 30000 });
    editor.catch(rejected); await ready;
    const acceptance = Promise.allSettled([adapter.accept(scope, { expectedQuote: quote })]);
    try { await waitForBlockedAuthority(); } finally { release(); await editor; }
    const [result] = await acceptance; assert.equal(result.status, "rejected"); assert.ok(review(result.reason));
    assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
  });
  for (const rollback of [false, true]) await check(`option acceptance first holds metadata authority; ${rollback ? "rollback releases with no grant" : "commit pins full original and displayed maximum"}`, async () => {
    await reset(); await configureOptions(); const scope = await provision(`native-options-accept-first-${rollback}`, optionLines());
    const quote = await adapter.quote(scope, optionRequest), before = await row(scope);
    let acquired, release;
    const ready = new Promise(resolve => { acquired = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const acceptance = Promise.allSettled([pausedAdapter(acquired, gate, rollback).accept(scope, { expectedQuote: quote })]);
    await ready;
    const editor = Promise.allSettled([prisma.$transaction(tx => changeTargetMetadata(tx), { timeout: 30000 })]);
    try { await waitForBlockedAuthority(); } finally { release(); }
    const [result] = await acceptance; const [edit] = await editor; assert.equal(edit.status, "fulfilled");
    if (rollback) {
      assert.equal(result.status, "rejected"); assert.match(result.reason.message, /synthetic_cross_sell_after_write_rollback/);
      assert.deepEqual(await row(scope), before); assert.equal(await changes(scope), 0);
    } else {
      assert.equal(result.status, "fulfilled"); const stored = await row(scope), line = stored.items[2];
      assert.equal(line.unitPriceCents, 11500); assert.equal(line.crossSellIntent.maximumUnitPriceCents, 10350);
      await assert.rejects(adapter.project(scope), review); assert.deepEqual(await row(scope), stored); assert.equal(await changes(scope), 1);
    }
  });
  console.log(JSON.stringify({ status: "passed", checks: passed, maxConcurrentWaitingTransactions: waitingTransactions,
    prismaClientCount: 1, poolLimit: 24, realProviderCalls: 0, publicEndpointProof: false, externalExactlyOnceProof: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", check: active, checksPassed: passed,
    maxConcurrentWaitingTransactions: waitingTransactions,
    error: typeof error?.code === "string" ? error.code : error?.constructor?.name ?? "Error",
    location: typeof error?.stack === "string" ? error.stack.split("\n").find(line => line.includes("storefront-cross-sell-quote.native-worker.mjs:"))?.trim() : undefined }));
  throw new Error("native_cross_sell_quote_assertion_failed");
} finally { await prisma.$disconnect(); }
