import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// REG-01 / C60: a recommendation query may run the existing suggestion/outbox
// cycle; it must not turn that read into a cart command, renewal or payment.
test("C60 post-add HTTP preserves commercial persistence", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const runtime = await createServiceTestRuntime({ local: true });
  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const db = prisma;
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runtime.db.runId }]);
    assert.equal(runtime.evidence().canonicalAppModule, true);
    assert.equal(runtime.evidence().authOverrides, false);
    assert.equal(runtime.evidence().repositoryOverrides, false);
    const origin = "https://post-add-read.example.test";
    const request = async (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "x-correlation-id": randomUUID(), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const register = async () => {
      const response = await request("/auth/register", "POST", { merchant_name: "Synthetic post-add read",
        email: randomUUID() + "@post-add-read.example.test", password: "SyntheticCartMerchant123!", business_mode: "products" });
      assert.equal(response.status, 201, "real merchant registration required");
      return response.body.merchant_id as string;
    };
    const merchantId = await register(), foreignMerchantId = await register();
    const merchants = [merchantId, foreignMerchantId];
    const prefix = "post_add_" + runtime.db.runId.replaceAll("-", "");
    const productIds = Object.fromEntries(["base", "target", "out", "foreign"].map(key => [key, prefix + "_" + key]));
    const variantIds = Object.fromEntries(Object.entries(productIds).map(([key, id]) => [key, id + "_v"]));
    const prices = { base: 4000, target: 2000, out: 500, foreign: 500 };
    const rules = { maxDiscountPercent: 20, minimumMarginPercent: 10, allowFreeShipping: false, allowShippingDiscount: false,
      allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false, autonomousEngineEnabled: true,
      freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0, offerExpirationMinutes: 10,
      blockedRegions: [], brandVoice: "consultative", originZip: "01310000" };
    for (const id of merchants) {
      await db.merchant.update({ where: { id }, data: { plan: "STORE_ONLY", storeSettings: { registration_pending: false,
        plan_selection_pending: false, crossSell: { enabled: id === merchantId, touchpoints: { post_cart: true },
          strategies: ["complementary"], discount: { enabled: true, mode: "percent", percent: 10 },
          limits: { maxSuggestionsPerSession: 3, cooldownSeconds: 0 }, display: { mode: "interstitial" } } } } });
      await db.merchantBillingSubscription.upsert({ where: { merchantId: id }, create: { merchantId: id, planKey: "scale", status: "active" },
        update: { planKey: "scale", status: "active" } });
      await db.merchantRule.upsert({ where: { merchantId: id }, create: { merchantId: id, ...rules }, update: rules });
    }
    for (const key of Object.keys(prices) as Array<keyof typeof prices>) {
      await db.product.create({ data: { id: productIds[key], merchantId: key === "foreign" ? foreignMerchantId : merchantId,
        name: "Synthetic " + key, type: "physical", metadata: {}, isActive: true, variants: { create: { id: variantIds[key],
          sku: variantIds[key], isActive: true, price: { create: { basePriceInCents: prices[key], costInCents: 200, currency: "BRL" } },
          stock: { create: { quantity: key === "out" ? 0 : 20, reserved: 0 } } } } } });
    }
    const promotionId = prefix + "_promotion";
    await db.crossSellPromotion.create({ data: { id: promotionId, merchantId, name: "Synthetic current complement",
      trigger: { sku_in_cart: [variantIds.base] }, recommendedSkus: [variantIds.out, variantIds.foreign, variantIds.target],
      discountPercent: 10, maxDiscountPercent: 10, status: "active", startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000) } });
    async function conversation(id = merchantId) {
      const response = await request("/storefront/conversations", "POST", { merchant_id: id }, { origin });
      assert.equal(response.status, 201, "real conversation capability issuer required");
      assert.equal(response.body.merchant_id, id);
      return { merchantId: id, cartId: response.body.conversation_id as string, token: response.body.conversation_token as string };
    }
    type Conversation = Awaited<ReturnType<typeof conversation>>;
    async function seed(c: Conversation, expiresAt = new Date(Date.now() + 1_800_000)) {
      return db.storefrontCart.create({ data: { merchantId: c.merchantId, sessionId: c.cartId,
        items: [{ variantId: variantIds.base, productId: productIds.base, sku: variantIds.base, name: "Synthetic base", quantity: 1, unitPriceCents: prices.base }],
        total: prices.base, discount: 0, couponCode: null, freeShipping: false, updatedAt: new Date("2020-01-01T00:00:00.000Z"), expiresAt } });
    }
    const followup = (c: Conversation, variantId = variantIds.base, headers: Record<string, string> = { origin, authorization: "Bearer " + c.token }) =>
      request("/storefront/cart/" + encodeURIComponent(c.cartId) + "?" + new URLSearchParams({ merchantId: c.merchantId, post_add_variant_id: variantId }), "GET", undefined, headers);
    const scope = { merchantId: { in: merchants } };
    async function commercialSnapshot() {
      return {
        // Includes persisted items/prices/quantity, totals, coupon, TTL and updatedAt.
        carts: await db.storefrontCart.findMany({ where: scope, orderBy: { id: "asc" } }),
        stock: await db.productStock.findMany({ where: { variant: { product: scope } }, orderBy: { id: "asc" } }),
        reservations: await db.stockReservation.findMany({ where: { variant: { product: scope } }, orderBy: { id: "asc" } }),
        catalogPrices: await db.productPrice.findMany({ where: { variant: { product: scope } }, orderBy: { id: "asc" } }),
        coupons: await db.couponRedemption.findMany({ where: scope, orderBy: { id: "asc" } }),
        checkouts: await db.checkoutSession.findMany({ where: scope, orderBy: { id: "asc" } }),
        orders: await db.completedOrder.count({ where: scope }), payments: await db.paymentIntent.count({ where: scope }),
        receipts: await db.attendanceReceipt.count({ where: scope }), inventory: await db.inventoryMovement.count({ where: scope }),
        // Existing offer events are allowed; unrelated commercial events are not.
        commercialEvents: await db.outboxMessage.findMany({ where: { ...scope, NOT: { eventType: { startsWith: "cross-sell." } } },
          select: { eventId: true, eventType: true, payload: true }, orderBy: { eventId: "asc" } }),
      };
    }
    async function offerSnapshot(c: Conversation) {
      return {
        suggestions: await db.crossSellSuggestion.findMany({ where: { merchantId: c.merchantId, sessionId: c.cartId }, orderBy: { id: "asc" } }),
        events: await db.outboxMessage.findMany({ where: { merchantId: c.merchantId, eventType: "cross-sell.offer.suggested" },
          select: { eventId: true, eventType: true, payload: true }, orderBy: { eventId: "asc" } }),
      };
    }
    await t.test("active manual offer and exact repeat preserve cart TTL, prices, stock and financial state", async () => {
      const c = await conversation(); await seed(c);
      const before = await commercialSnapshot(), offersBefore = await offerSnapshot(c);
      assert.deepEqual(offersBefore, { suggestions: [], events: [] });
      const result = await followup(c);
      assert.equal(result.status, 200);
      assert.equal(result.body.cartId, c.cartId); assert.equal(result.body.total, prices.base / 100);
      assert.equal(result.body.itemCount, 1); assert.equal(result.body.discount, 0);
      assert.deepEqual(result.body.postCartSuggestions?.data.products.map((item: { id: string }) => item.id), [variantIds.target]);
      const suggestion = result.body.postCartSuggestions.data.products[0];
      assert.equal(suggestion.productId, productIds.target); assert.equal(suggestion.promoId, promotionId);
      assert.equal(suggestion.price, 18); assert.equal(suggestion.inStock, true);
      assert.deepEqual(await commercialSnapshot(), before);
      const offers = await offerSnapshot(c);
      assert.equal(offers.suggestions.length, 1); assert.equal(offers.suggestions[0]!.promoId, promotionId);
      assert.equal(offers.events.length, 1); assert.equal(offers.events[0]!.eventType, "cross-sell.offer.suggested");
      const again = await followup(c);
      assert.equal(again.status, 200); assert.deepEqual(again.body, result.body);
      assert.deepEqual(await commercialSnapshot(), before);
      assert.deepEqual(await offerSnapshot(c), offers, "existing pending-offer cycle remains authoritative");
    });
    await t.test("recommendations use current physical stock and quote without saving the cart", async () => {
      const c = await conversation(); await seed(c);
      await db.productStock.updateMany({ where: { variantId: variantIds.target }, data: { quantity: 0 } });
      let before = await commercialSnapshot();
      const empty = await followup(c); assert.equal(empty.status, 200); assert.equal(empty.body.postCartSuggestions, undefined);
      assert.deepEqual(await commercialSnapshot(), before);
      await db.productStock.updateMany({ where: { variantId: variantIds.target }, data: { quantity: 20 } });
      await db.productPrice.update({ where: { variantId: variantIds.target }, data: { basePriceInCents: 3000 } });
      before = await commercialSnapshot();
      const current = await followup(c); assert.equal(current.status, 200);
      assert.deepEqual(current.body.postCartSuggestions?.data.products.map((item: { id: string }) => item.id), [variantIds.target]);
      assert.equal(current.body.postCartSuggestions.data.products[0].price, 27);
      assert.deepEqual(await commercialSnapshot(), before);
    });
    await t.test("origin, merchant, session and member authority remain required without commercial writes", async () => {
      const c = await conversation(), another = await conversation(), foreign = await conversation(foreignMerchantId);
      await seed(c); await seed(another);
      const before = await commercialSnapshot();
      for (const [headers, expected] of [
        [{ origin }, 401],
        [{ origin: "https://foreign.example.test", authorization: "Bearer " + c.token }, 401],
        [{ origin, authorization: "Bearer " + another.token }, 403],
        [{ origin, authorization: "Bearer " + foreign.token }, 403],
      ] as Array<[Record<string, string>, number]>) assert.equal((await followup(c, variantIds.base, headers)).status, expected);
      assert.equal((await followup(c, variantIds.target)).status, 404);
      assert.equal((await followup(c, "..")).status, 400);
      assert.deepEqual(await commercialSnapshot(), before);
    });
    await t.test("missing and expired carts are never created, revived or renewed by follow-up", async () => {
      const missing = await conversation(), expired = await conversation();
      await seed(expired, new Date(Date.now() - 60_000));
      const before = await commercialSnapshot();
      assert.equal((await followup(missing)).status, 404);
      assert.equal((await followup(expired)).status, 422);
      assert.equal(await db.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: missing.cartId } } }), null);
      assert.deepEqual(await commercialSnapshot(), before);
    });
    assert.equal(runtime.evidence().providerCalls, 0);
    assert.equal(runtime.evidence().authOverrides, false);
    assert.equal(runtime.evidence().repositoryOverrides, false);
  } finally {
    const errors: unknown[] = [];
    try { await prisma?.$disconnect(); } catch (error) { errors.push(error); }
    try { await runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "post_add_read_owned_cleanup_failed");
    assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
  }
});
