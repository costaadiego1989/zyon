import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { seedServiceBookingFixture } from "./service-booking-fixtures.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { snapshotOrderLines } from "../src/modules/operations/domain/order-fulfillment.js";
import { canonicalizeProfessionalServiceCart } from "../src/shared/bookings/service-checkout-cart.js";

test("T28", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const runtime = await createServiceTestRuntime({ local: true });
  let raw: PrismaClient | undefined;
  try {
    raw = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const prisma = raw, now = new Date(); await seedServiceBookingFixture(prisma, now);
    const date = (day: number) => new Date(now.getTime() + day * 86_400_000).toISOString().slice(0, 10);
    const cart = (day: number): CheckoutSession["cart"] => ({ currency: "BRL", total: 50, source: "checkout", items: [{
      sku: "booking-short", product_id: "booking-short", variantId: "booking-short-variant", name: "Untrusted display name",
      productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1, price: 50,
      fulfillmentSchedule: { slotId: "untrusted-display-id", professionalId: "booking-professional", professionalVersion: 1,
        policyVersion: 1, date: date(day), startsAt: date(day) + "T10:00:00.000Z", endsAt: date(day) + "T10:20:00.000Z", timeZone: "UTC", durationMinutes: 20 } }] });
    const start = async (sessionId: string, selected: CheckoutSession["cart"], merchantId = "booking-services") => {
      const response = await fetch(runtime.apiOrigin + "/checkout/start-checkout", { method: "POST", redirect: "error",
        signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchant_id: merchantId, session_id: sessionId, cart: selected }) });
      return { status: response.status, body: await response.json() };
    };
    const request = async (path: string, body: unknown, token?: string, method = "POST") => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "idempotency-key": randomUUID(),
          ...(token ? { authorization: "Bearer " + token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const seedRules = async (merchantId: string) => {
      await prisma.merchantRule.create({ data: { merchantId, maxDiscountPercent: 0, minimumMarginPercent: 0,
        allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
        couponBoxEnabled: false, autonomousEngineEnabled: false, freeShippingMinCartValue: 0, maxShippingSubsidy: 0,
        maxPartialShippingDiscount: 0, offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "Cordial", originZip: "01310000" } });
    };
    const register = async (suffix: string) => {
      const auth = await request("/auth/register", { merchant_name: "Synthetic " + suffix,
        email: suffix + "@checkout-boundary.example.test", password: "SyntheticPassword123!", business_mode: "services" });
      assert.equal(auth.status, 201, JSON.stringify(auth));
      // Existing catalogue entitlement is explicit; no professional tier is added.
      await prisma.merchant.update({ where: { id: auth.body.merchant_id }, data: { plan: "STORE_ONLY" } });
      await prisma.merchantBillingSubscription.upsert({ where: { merchantId: auth.body.merchant_id },
        create: { merchantId: auth.body.merchant_id, planKey: "starter", status: "active" },
        update: { planKey: "starter", status: "active" } });
      await seedRules(auth.body.merchant_id);
      return auth.body;
    };
    const offer = async (auth: any, sku: string, scheduled: boolean) => {
      const result = await request("/merchants/" + auth.merchant_id + "/products", {
        name: "Synthetic " + sku, type: "service",
        ...(scheduled ? { metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } } } : {}),
        variants: [{ sku, attributes: {}, basePriceInCents: 5000 }],
      }, auth.access_token);
      assert.equal(result.status, 201, JSON.stringify(result));
      return prisma.productVariant.findFirstOrThrow({ where: { sku, product: { merchantId: auth.merchant_id } },
        include: { product: true, price: true } });
    };
    const embedRequest = async (token: string, origin: string, path: string, body?: unknown, method = "POST") => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "x-aacp-embed-token": token, origin },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    let approvedHistory: { merchantId: string; sessionId: string; professionalId: string; productId: string;
      variantId: string; token: string; origin: string } | undefined;

    await t.test("an actual registered scheduled offer uses professional capacity and refuses a body bypass", async () => {
      const auth = await register("scheduled-boundary"), merchantId = auth.merchant_id;
      const policy = await request("/merchants/me/service-business-policy", { expectedVersion: 0, holdEnabled: false,
        paymentMode: "at_attendance", admissionsEnabled: true }, auth.access_token, "PUT");
      assert.equal(policy.status, 200, JSON.stringify(policy));
      const variant = await offer(auth, "ACTUAL-SCHEDULED-BOUNDARY", true);
      assert.deepEqual(variant.product.metadata, { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } });
      const path = "/merchants/" + merchantId + "/service-professionals";
      const created = await request(path, { publicName: "Synthetic actual checkout professional", timeZone: "UTC",
        publicProfile: { description: "Public synthetic profile" }, isPublished: true, productIds: [variant.productId] }, auth.access_token);
      assert.equal(created.status, 201, JSON.stringify(created));
      const recurring = await request(path + "/" + created.body.id + "/availability", {
        expectedVersion: created.body.version, timeZone: "UTC",
        rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720 })),
      }, auth.access_token, "PUT");
      assert.equal(recurring.status, 200, JSON.stringify(recurring));
      const professional = await prisma.serviceProfessional.findUniqueOrThrow({ where: { id: created.body.id } });
      const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const cart: CheckoutSession["cart"] = { currency: "BRL", total: 50, items: [{ sku: variant.sku,
        product_id: variant.productId, variantId: variant.id, productType: "service", fulfillmentStrategy: "scheduled_service",
        name: "Untrusted presentation", price: 50, quantity: 1, fulfillmentSchedule: { slotId: "untrusted-display-id", date,
          startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z", timeZone: "UTC", durationMinutes: 20,
          professionalId: professional.id, professionalVersion: professional.version, policyVersion: policy.body.version } }] };
      const result = await start("actual-scheduled-boundary", cart, merchantId);
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.body.service_checkout.payment_mode, "at_attendance");
      assert.equal(result.body.service_checkout.requires_hold, false);
      const selected = result.body.service_checkout.selections[0];
      assert.equal(selected.professionalId, professional.id); assert.equal(selected.professionalVersion, professional.version);
      assert.equal(selected.professionalName, professional.publicName); assert.equal(selected.productName, variant.product.name);
      assert.equal(selected.policyVersion, policy.body.version); assert.equal(selected.date, date);
      assert.equal(selected.startsAt, cart.items[0]!.fulfillmentSchedule!.startsAt);
      assert.equal(selected.endsAt, cart.items[0]!.fulfillmentSchedule!.endsAt);
      assert.equal(selected.timeZone, "UTC"); assert.equal(selected.durationMinutes, 20); assert.equal(selected.priceInCents, 5000);
      const saved = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: "actual-scheduled-boundary" } } });
      const persisted = JSON.parse(JSON.stringify(saved.cart));
      assert.equal(persisted.items[0].name, variant.product.name); assert.equal(persisted.items[0].price, 50);
      assert.equal(persisted.items[0].fulfillmentStrategy, "scheduled_service");
      assert.equal(persisted.items[0].fulfillmentSchedule.professionalId, professional.id);
      assert.match(persisted.items[0].fulfillmentSchedule.slotId, /^[a-f0-9]{64}$/);
      const source = await prisma.product.findUniqueOrThrow({ where: { id: variant.productId } });
      for (const strategy of ["service", "scheduled_service"] as const) {
        const missing = structuredClone(cart); delete missing.items[0]!.fulfillmentSchedule;
        missing.items[0]!.fulfillmentStrategy = strategy;
        const sessionId = "missing-professional-" + strategy, rejected = await start(sessionId, missing, merchantId);
        assert.ok([400, 409].includes(rejected.status), JSON.stringify(rejected));
        assert.match(JSON.stringify(rejected.body), /service_.*(?:selection|professional|schedule).*required/);
        assert.equal(await prisma.checkoutSession.count({ where: { merchantId, sessionId } }), 0);
      }
      assert.deepEqual(await prisma.product.findUnique({ where: { id: source.id } }), source);
      assert.equal(await prisma.paymentIntent.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.appointmentAudit.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.outboxMessage.count({ where: { merchantId, producer: "service-booking" } }), 0);
      const publicPolicy = await request("/merchants/me/service-business-policy", { expectedVersion: policy.body.version,
        holdEnabled: false, paymentMode: "online", admissionsEnabled: true }, auth.access_token, "PUT");
      assert.equal(publicPolicy.status, 200, JSON.stringify(publicPolicy));
      const embedCart = structuredClone(cart); embedCart.items[0]!.fulfillmentSchedule!.policyVersion = publicPolicy.body.version;
      const origin = "https://checkout-boundary.example.test";
      const issued = await request("/embed-sessions", { allowed_origin: origin, scopes: ["checkout:start"] }, auth.access_token);
      assert.equal(issued.status, 201, "real console issuer must create the scoped embed session");
      assert.equal(typeof issued.body.embed_session_token, "string");
      const token = issued.body.embed_session_token;
      // The real embed controller derives tenant and checkout identity from its
      // verified capability rather than the conflicting body merchant.
      const embedBody = { merchant_id: "booking-foreign", cart: embedCart };
      const started = await embedRequest(token, origin, "/embed/start", embedBody);
      assert.equal(started.status, 201, JSON.stringify(started));
      assert.equal(started.body.service_checkout.payment_mode, "online");
      assert.equal(started.body.service_checkout.policy_version, publicPolicy.body.version);
      assert.equal(started.body.service_checkout.requires_hold, false);
      assert.equal(started.body.service_checkout.selections[0].professionalName, professional.publicName);
      assert.equal(started.body.service_checkout.selections[0].productName, variant.product.name);
      assert.equal(started.body.service_checkout.selections[0].priceInCents, 5000);
      const embedded = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
        merchantId, sessionId: started.body.session_id } } });
      assert.equal(embedded.merchantId, merchantId); assert.equal(embedded.globalUserId, started.body.global_user_id);
      assert.equal(await prisma.checkoutSession.count({ where: { merchantId: "booking-foreign", sessionId: embedded.sessionId } }), 0);
      const resumed = await embedRequest(token, origin, "/embed/start", embedBody);
      assert.equal(resumed.status, 201, JSON.stringify(resumed));
      assert.equal(resumed.body.session_id, started.body.session_id); assert.deepEqual(resumed.body.service_checkout, started.body.service_checkout);
      assert.equal((await embedRequest(token, "https://wrong-origin.example.test", "/embed/start", embedBody)).status, 403);
      assert.equal((await embedRequest(token, origin, "/embed/start", { ...embedBody, session_id: "forged-checkout" })).status, 401);
      assert.equal(await prisma.checkoutSession.count({ where: { merchantId, sessionId: embedded.sessionId } }), 1);
      assert.equal(await prisma.paymentIntent.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId } }), 0);
      approvedHistory = { merchantId, sessionId: embedded.sessionId, professionalId: professional.id,
        productId: variant.productId, variantId: variant.id, token, origin };
    });

    await t.test("an actual unscheduled canonical service keeps the old checkout without a booking policy", async () => {
      const auth = await register("unscheduled-boundary"), merchantId = auth.merchant_id;
      const variant = await offer(auth, "ACTUAL-UNSCHEDULED-BOUNDARY", false);
      const cart: CheckoutSession["cart"] = { currency: "BRL", total: 0.02, items: [{ sku: variant.sku,
        product_id: variant.productId, variantId: variant.id, productType: "service", fulfillmentStrategy: "service",
        name: "Untrusted presentation", price: 0.01, quantity: 2 }] };
      const result = await start("actual-unscheduled-boundary", cart, merchantId);
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(Object.hasOwn(result.body, "service_checkout"), false);
      assert.equal(Object.hasOwn(result.body, "service_slot_hold"), false);
      const saved = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: "actual-unscheduled-boundary" } } });
      const persisted = JSON.parse(JSON.stringify(saved.cart));
      assert.equal(persisted.total, 100); assert.equal(persisted.items.length, 1);
      assert.equal(persisted.items[0].name, variant.product.name); assert.equal(persisted.items[0].quantity, 2);
      assert.equal(persisted.items[0].price, 50); assert.equal(persisted.items[0].fulfillmentStrategy, "service");
      assert.equal(persisted.items[0].fulfillmentSchedule, undefined);
      const resumed = await start("actual-unscheduled-boundary", cart, merchantId);
      assert.equal(resumed.status, 201, JSON.stringify(resumed));
      assert.deepEqual((await prisma.checkoutSession.findUniqueOrThrow({ where: { id: saved.id } })).cart, saved.cart);
      assert.equal(await prisma.serviceBusinessPolicy.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.serviceProfessional.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.paymentIntent.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId } }), 0);
    });
    await t.test("HTTP checkout exposes canonical professional and local policy without a lease", async () => {
      const result = await start("service-checkout-ready", cart(2));
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.body.service_checkout.payment_mode, "at_attendance");
      assert.equal(result.body.service_checkout.policy_version, 1); assert.equal(result.body.service_checkout.requires_hold, false);
      assert.equal(Object.hasOwn(result.body, "service_slot_hold"), false);
      const selected = result.body.service_checkout.selections[0];
      assert.equal(selected.professionalId, "booking-professional"); assert.equal(selected.priceInCents, 5000);
      assert.equal(selected.productName, "Synthetic booking-short"); assert.equal(selected.professionalName, "Synthetic professional");
      assert.equal(selected.durationMinutes, 20); assert.equal(selected.date, date(2));
      const stored = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: "booking-services", sessionId: "service-checkout-ready" } } });
      const persisted = JSON.parse(JSON.stringify(stored.cart));
      assert.equal(persisted.items[0].name, "Synthetic booking-short");
      assert.equal(persisted.items[0].fulfillmentSchedule.professionalVersion, 1);
      assert.equal(persisted.items[0].fulfillmentSchedule.policyVersion, 1);
      assert.match(persisted.items[0].fulfillmentSchedule.slotId, /^[a-f0-9]{64}$/);
      const resumed = await start("service-checkout-ready", cart(2));
      assert.equal(resumed.status, 201, JSON.stringify(resumed));
      assert.deepEqual(resumed.body.service_checkout, result.body.service_checkout);
      assert.equal(await prisma.checkoutSession.count({ where: { merchantId: "booking-services", sessionId: "service-checkout-ready" } }), 1);
      assert.equal(await prisma.paymentIntent.count(), 0); assert.equal(await prisma.serviceAppointment.count(), 0);
    });
    await t.test("HTTP stale, foreign and fabricated prices cannot create checkout side effects", async () => {
      const foreignProfessional = await prisma.serviceProfessional.create({ data: { id: "foreign-professional",
        merchantId: "booking-foreign", publicName: "Foreign tenant service canary", timeZone: "UTC", isPublished: true } });
      const foreignProduct = await prisma.product.create({ data: { id: "foreign-scheduled-product", merchantId: "booking-foreign",
        type: "service", name: "Foreign tenant offer canary", metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } },
        variants: { create: { id: "foreign-scheduled-variant", sku: "FOREIGN-SCHEDULED", price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
      for (const [field, value, code] of [["professionalVersion", 99, /selection_stale/], ["policyVersion", 99, /policy_changed/],
        ["professionalId", "foreign-professional", /not_found|unavailable/]] as const) {
        const selected = cart(3); Reflect.set(selected.items[0].fulfillmentSchedule!, field, value);
        const result = await start("invalid-" + field, selected);
        assert.ok([400, 404, 409].includes(result.status), JSON.stringify(result)); assert.match(JSON.stringify(result.body), code);
        assert.equal(await prisma.checkoutSession.count({ where: { merchantId: "booking-services", sessionId: "invalid-" + field } }), 0);
        assert.doesNotMatch(JSON.stringify(result.body), /Foreign tenant/);
      }
      for (const [key, overrides] of [["product", { product_id: foreignProduct.id }],
        ["variant", { variantId: foreignProduct.variants[0]!.id }],
        ["paired", { product_id: foreignProduct.id, variantId: foreignProduct.variants[0]!.id, sku: foreignProduct.variants[0]!.sku }]] as const) {
        const selected = cart(3); Object.assign(selected.items[0]!, overrides);
        const rejected = await start("invalid-foreign-" + key, selected);
        assert.equal(rejected.status, 409, JSON.stringify(rejected)); assert.match(JSON.stringify(rejected.body), /offer_changed/);
        assert.doesNotMatch(JSON.stringify(rejected.body), /Foreign tenant/);
        assert.equal(await prisma.checkoutSession.count({ where: { sessionId: "invalid-foreign-" + key } }), 0);
      }
      assert.deepEqual(await prisma.serviceProfessional.findUnique({ where: { id: foreignProfessional.id } }), foreignProfessional);
      assert.deepEqual(await prisma.product.findUnique({ where: { id: foreignProduct.id }, include: { variants: true } }), foreignProduct);
      const selected = cart(3); selected.items[0].price = 0.01;
      const result = await start("invalid-price", selected);
      assert.equal(result.status, 409, JSON.stringify(result)); assert.match(JSON.stringify(result.body), /offer_changed/);
      assert.equal(await prisma.checkoutSession.count({ where: { sessionId: "invalid-price" } }), 0);
    });
    await t.test("physical/digital/food checkout retains quantities, canonical prices and no service requirements", async () => {
      const merchantId = "booking-product-regression";
      await prisma.merchant.create({ data: { id: merchantId, name: "Synthetic existing product store", businessMode: "products", businessModeSelectedAt: now } });
      await seedRules(merchantId);
      for (const type of ["physical", "digital", "food"] as const) {
        await prisma.product.create({ data: { id: "regression-" + type, merchantId, name: "Synthetic " + type, type } });
        await prisma.productVariant.create({ data: { id: "regression-" + type + "-variant", productId: "regression-" + type, sku: "REGRESSION-" + type,
          price: { create: { basePriceInCents: 2500, currency: "BRL" } }, ...(type === "physical" ? { stock: { create: { quantity: 10 } } } : {}) } });
      }
      const input: CheckoutSession["cart"] = { currency: "BRL", total: 0.03, items: ["physical", "digital", "food"].map(type => ({
        sku: "REGRESSION-" + type, name: "Untrusted title", price: 0.01, quantity: 2 })) };
      const before = await prisma.productStock.findMany({ where: { variantId: "regression-physical-variant" } });
      const result = await start("product-regression", input, merchantId);
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(Object.hasOwn(result.body, "service_checkout"), false); assert.equal(Object.hasOwn(result.body, "service_slot_hold"), false);
      const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: "product-regression" } } });
      const stored = JSON.parse(JSON.stringify(row.cart));
      assert.equal(stored.total, 150); assert.equal(stored.currency, "BRL"); assert.equal(stored.items.length, 3);
      for (const item of stored.items) { assert.equal(item.quantity, 2); assert.equal(item.price, 25); assert.equal(item.fulfillmentSchedule, undefined); }
      const resumed = await start("product-regression", input, merchantId); assert.equal(resumed.status, 201, JSON.stringify(resumed));
      assert.deepEqual(await prisma.productStock.findMany({ where: { variantId: "regression-physical-variant" } }), before);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.serviceBusinessPolicy.count({ where: { merchantId } }), 0);
    });
    await t.test("quotation reads current canonical presentation and one clock after its merchant wait", async () => {
      const original = await prisma.product.findUniqueOrThrow({ where: { id: "booking-short" } });
      const beforeCheckouts = await prisma.checkoutSession.count({ where: { merchantId: "booking-services" } });
      const beforePayments = await prisma.paymentIntent.count({ where: { merchantId: "booking-services" } });
      let locked!: () => void, rejectLock!: (error: unknown) => void, release!: () => void, holderPid = 0, reads = 0;
      const ready = new Promise<void>((resolve, reject) => { locked = resolve; rejectLock = reject; });
      const allowCommit = new Promise<void>(resolve => { release = resolve; });
      const administration = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${"booking-services"} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        locked(); await allowCommit;
        await tx.product.update({ where: { id: original.id }, data: { name: "Synthetic current after merchant wait" } });
      });
      void administration.catch(rejectLock);
      let quotation: Promise<CheckoutSession["cart"]> | undefined, settled = false;
      try {
        await ready; assert.ok(Number.isInteger(holderPid) && holderPid > 0);
        quotation = prisma.$transaction(tx => canonicalizeProfessionalServiceCart(tx, "booking-services", cart(9), () => { reads++; return now; }));
        void quotation.then(() => { settled = true; }, () => { settled = true; });
        const deadline = Date.now() + 2000; let waiting = false;
        do { waiting = Number(await runtime.db.sql(`SELECT count(*) FROM pg_stat_activity
          WHERE ${holderPid}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'
          AND position('merchants' in query)>0 AND position('FOR UPDATE' in upper(query))>0;`)) > 0; }
        while (!waiting && Date.now() < deadline);
        assert.equal(waiting, true); assert.equal(settled, false); assert.equal(reads, 0);
      } finally { release(); await Promise.allSettled([administration, ...(quotation ? [quotation] : [])]); }
      await administration; assert.ok(quotation);
      const result = await quotation; assert.equal(reads, 1);
      assert.equal(result.items[0]!.name, "Synthetic current after merchant wait"); assert.equal(result.items[0]!.price, 50);
      assert.equal(result.items[0]!.fulfillmentSchedule!.professionalVersion, 1);
      assert.equal(result.items[0]!.fulfillmentSchedule!.policyVersion, 1);
      assert.equal(await prisma.checkoutSession.count({ where: { merchantId: "booking-services" } }), beforeCheckouts);
      assert.equal(await prisma.paymentIntent.count({ where: { merchantId: "booking-services" } }), beforePayments);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId: "booking-services" } }), 0);
      await prisma.product.update({ where: { id: original.id }, data: { name: original.name } });
    });
    await t.test("new persistence waits on the merchant fence and revalidates the actual mode", async () => {
      // The administrative fixture closes its offer and changes mode under the
      // same canonical lock. This tests the checkout boundary; T12 owns the
      // separate authorization/business-mode HTTP command proof.
      const raceMerchant = "booking-race-mode";
      await prisma.merchant.create({ data: { id: raceMerchant, name: "Synthetic mode race", businessMode: "services", businessModeSelectedAt: now } });
      await prisma.serviceBusinessPolicy.create({ data: { merchantId: raceMerchant, version: 1, admissionsEnabled: true,
        holdEnabled: false, paymentMode: "at_attendance", configuredAt: now } });
      await prisma.product.create({ data: { id: "race-service", merchantId: raceMerchant, name: "Synthetic race service", type: "service",
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } } } });
      await prisma.productVariant.create({ data: { id: "race-variant", productId: "race-service", sku: "RACE-SERVICE",
        price: { create: { basePriceInCents: 5000, currency: "BRL" } } } });
      await prisma.serviceProfessional.create({ data: { id: "race-professional", merchantId: raceMerchant, publicName: "Synthetic race professional",
        timeZone: "UTC", isActive: true, isPublished: true } });
      await prisma.professionalService.create({ data: { merchantId: raceMerchant, professionalId: "race-professional", productId: "race-service" } });
      await prisma.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({
        merchantId: raceMerchant, professionalId: "race-professional", weekday, startMinute: 600, endMinute: 720, timeZone: "UTC" })) });
      const raceCart = cart(4);
      Object.assign(raceCart.items[0], { product_id: "race-service", variantId: "race-variant", sku: "RACE-SERVICE" });
      Reflect.set(raceCart.items[0].fulfillmentSchedule!, "professionalId", "race-professional");
      const session: CheckoutSession = { merchantId: raceMerchant, sessionId: "racing-service-checkout", globalUserId: "synthetic-buyer",
        conversationId: "synthetic-racing-conversation", cart: raceCart, abandonmentScore: 0, triggerAgent: false, chatHistory: [],
        createdAt: now.toISOString(), updatedAt: now.toISOString() };
      let locked!: () => void, rejectLock!: (error: unknown) => void, release!: () => void, holderPid = 0;
      const hasLock = new Promise<void>((resolve, reject) => { locked = resolve; rejectLock = reject; });
      const releaseAdmin = new Promise<void>(resolve => { release = resolve; });
      const administration = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${raceMerchant} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        locked(); await releaseAdmin;
        await tx.product.updateMany({ where: { merchantId: raceMerchant }, data: { isActive: false } });
        await tx.merchant.update({ where: { id: raceMerchant }, data: { businessMode: "products" } });
      });
      void administration.catch(rejectLock);
      let creation: ReturnType<PrismaCheckoutRepository["createSessionIfAbsent"]> | undefined, settled = false;
      try {
        await hasLock; assert.ok(Number.isInteger(holderPid) && holderPid > 0);
        creation = new PrismaCheckoutRepository(prisma).createSessionIfAbsent(session);
        void creation.then(() => { settled = true; }, () => { settled = true; });
        const deadline = Date.now() + 2000; let waiting = false;
        do { waiting = Number(await runtime.db.sql(`SELECT count(*) FROM pg_stat_activity
          WHERE ${holderPid}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'
          AND position('merchants' in query)>0 AND position('FOR UPDATE' in upper(query))>0;`)) > 0; }
        while (!waiting && Date.now() < deadline);
        assert.equal(waiting, true, "writer must reach the merchant lock before persistence");
        assert.equal(settled, false);
      } finally { release(); await Promise.allSettled([administration, ...(creation ? [creation] : [])]); }
      await administration; assert.ok(creation);
      await assert.rejects(creation, /service_booking_products_mode/);
      assert.equal(await prisma.checkoutSession.count({ where: { sessionId: session.sessionId } }), 0);
      await prisma.merchant.update({ where: { id: session.merchantId }, data: { businessMode: "services" } });
      await prisma.product.updateMany({ where: { merchantId: session.merchantId }, data: { isActive: true } });
    });
    await t.test("the scoped public hold-state reader preserves approved historical snapshots after withdrawal", async () => {
      assert.ok(approvedHistory); const history = approvedHistory;
      const beforeSession = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
        merchantId: history.merchantId, sessionId: history.sessionId } } });
      const beforeInventory = await prisma.inventoryMovement.findMany({ where: { merchantId: history.merchantId }, orderBy: { id: "asc" } });
      const historicalCart = JSON.parse(JSON.stringify(beforeSession.cart)) as CheckoutSession["cart"];
      // Explicit synthetic settled facts, not a real provider transaction.
      const payment = await prisma.paymentIntent.create({ data: { id: "synthetic-history-approved-intent",
        merchantId: history.merchantId, sessionId: history.sessionId, idempotencyKey: "synthetic-history-approved",
        amountCents: 5000, approvedAmountCents: 5000, currency: "BRL", method: "pix", status: "approved",
        providerPaymentId: "synthetic-history-approved-provider" } });
      const order = await prisma.completedOrder.create({ data: { id: "synthetic-history-approved-order", merchantId: history.merchantId,
        sessionId: history.sessionId, externalOrderId: payment.providerPaymentId!, orderTotal: 50, currency: "BRL", completedAt: now,
        lineItemsJson: JSON.parse(JSON.stringify(snapshotOrderLines(historicalCart.items))) } });
      await prisma.productPrice.update({ where: { variantId: history.variantId }, data: { basePriceInCents: 9000 } });
      await prisma.product.update({ where: { id: history.productId }, data: { isActive: false,
        metadata: { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } } } });
      await prisma.serviceProfessional.update({ where: { id: history.professionalId }, data: {
        isActive: false, isPublished: false, timeZone: "America/Sao_Paulo", version: { increment: 1 } } });
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: history.merchantId }, data: { admissionsEnabled: false, version: { increment: 1 } } });
      const response = await embedRequest(history.token, history.origin,
        "/embed/service-slot-hold?session_id=" + encodeURIComponent(history.sessionId), undefined, "GET");
      assert.equal(response.status, 200, JSON.stringify(response));
      assert.deepEqual(response.body, { requires_hold: false, service_slot_hold: null });
      assert.deepEqual(await prisma.checkoutSession.findUnique({ where: { id: beforeSession.id } }), beforeSession);
      assert.deepEqual(await prisma.completedOrder.findUnique({ where: { id: order.id } }), order);
      assert.deepEqual(await prisma.paymentIntent.findUnique({ where: { id: payment.id } }), payment);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId: history.merchantId } }), 0);
      assert.equal(await prisma.paymentIntent.count({ where: { merchantId: history.merchantId } }), 1);
      assert.deepEqual(await prisma.inventoryMovement.findMany({ where: { merchantId: history.merchantId }, orderBy: { id: "asc" } }), beforeInventory);
    });
    assert.equal(runtime.evidence().repositoryOverrides, false); assert.equal(runtime.evidence().authOverrides, false);
    assert.equal(runtime.evidence().providerCalls, 0);
  } finally { try { if (raw) await raw.$disconnect(); } finally { await runtime.close(); } }
  assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
});
