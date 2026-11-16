import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { seedServiceBookingFixture } from "./service-booking-fixtures.js";
import { PaymentIntentEntity } from "../src/modules/payment/domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";

test("T29 HTTP", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const runtime = await createServiceTestRuntime({ local: true });
  let raw: PrismaClient | undefined;
  try {
    raw = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const prisma = raw, now = new Date(); await seedServiceBookingFixture(prisma, now);
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
    let publicHistory: { merchantId: string; sessionId: string; token: string; origin: string } | undefined;
    const date = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const cart: CheckoutSession["cart"] = { currency: "BRL", total: 50, source: "checkout", items: [{ sku: "booking-short",
      product_id: "booking-short", variantId: "booking-short-variant", name: "Synthetic service", productType: "service",
      fulfillmentStrategy: "scheduled_service", price: 50, quantity: 1, fulfillmentSchedule: { slotId: "synthetic-slot",
        professionalId: "booking-professional", professionalVersion: 1, policyVersion: 1, date,
        startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z", timeZone: "UTC", durationMinutes: 20 } }] };
    const checkout = async (sessionId: string) => prisma.checkoutSession.create({ data: { merchantId: "booking-services",
      sessionId, globalUserId: "synthetic-buyer", conversationId: sessionId, cart: JSON.parse(JSON.stringify(cart)),
      createdAt: now, updatedAt: now, customer: { fullName: "Synthetic buyer", email: "synthetic@example.test", phone: "+5521999990000" } } });
    const paymentRequest = async (sessionId: string, key: string) => {
      const response = await fetch(runtime.apiOrigin + "/payment/intents", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ merchant_id: "booking-services", session_id: sessionId,
          idempotency_key: key, method: "pix" }) });
      return { status: response.status, body: await response.json() };
    };
    const intentFor = (sessionId: string, key: string) => {
      const intent = PaymentIntentEntity.create({ merchantId: "booking-services", sessionId, idempotencyKey: key,
        amountCents: 5000, currency: "BRL", method: "pix", amountBreakdown: { version: 1, currency: "BRL",
          cartFingerprint: paymentCartFingerprint({ cart }), itemsSubtotalCents: 5000, discountCents: 0, shippingCents: 0,
          platformFeeCents: 0, totalCents: 5000 } });
      intent.prepareCreation({ merchantId: "booking-services", sessionId, intentId: intent.id, provider: "asaas", amountCents: 5000,
        currency: "BRL", method: "pix", asaasCustomerId: "synthetic-customer", providerIdempotencyKey: key });
      return intent;
    };
    await t.test("at-attendance request cannot reach provider or persist a payment journal", async () => {
      await checkout("http-service-local");
      const result = await paymentRequest("http-service-local", "http-service-local");
      assert.equal(result.status, 409, JSON.stringify(result)); assert.match(JSON.stringify(result.body), /pay_at_attendance_required/);
      assert.equal(await prisma.paymentIntent.count(), 0); assert.equal(await prisma.serviceAppointment.count(), 0);
    });
    await t.test("stale policy blocks a new online attempt with no partial payment", async () => {
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { paymentMode: "online", version: 2 } });
      await checkout("http-service-stale");
      const result = await paymentRequest("http-service-stale", "http-service-stale");
      assert.equal(result.status, 409, JSON.stringify(result)); assert.match(JSON.stringify(result.body), /policy_changed/);
      assert.equal(await prisma.paymentIntent.count(), 0);
    });
    await t.test("ready journal resume rechecks current policy before its first dispatch", async () => {
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { paymentMode: "online", version: 1 } });
      await checkout("http-service-ready");
      const intent = intentFor("http-service-ready", "http-service-ready");
      await new PrismaPaymentRepository(prisma).saveIntent({ intent });
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { version: 2 } });
      const result = await paymentRequest("http-service-ready", "http-service-ready");
      assert.equal(result.status, 409, JSON.stringify(result)); assert.match(JSON.stringify(result.body), /policy_changed/);
      const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      const creation = JSON.parse(JSON.stringify(stored.creation));
      assert.equal(creation.state, "ready"); assert.equal(creation.firstAttemptAt, undefined); assert.equal(stored.providerPaymentId, null);
    });
    await t.test("persisted approved history remains readable when new admissions close", async () => {
      // Synthetic settled journal, no provider transaction or real payment.
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { version: 1 } });
      await checkout("http-service-approved");
      const intent = intentFor("http-service-approved", "http-service-approved");
      await new PrismaPaymentRepository(prisma).saveIntent({ intent });
      await prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "approved", approvedAmountCents: 5000,
        providerPaymentId: "synthetic-approved-provider", statusHistory: [{ status: "pending", occurredAt: now.toISOString() },
          { status: "approved", occurredAt: now.toISOString() }] } });
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { admissionsEnabled: false, version: 2 } });
      const result = await paymentRequest("http-service-approved", "http-service-approved");
      assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.body.status, "approved"); assert.equal(result.body.id, intent.id);
      assert.equal(await prisma.paymentIntent.count({ where: { sessionId: "http-service-approved" } }), 1);
      assert.equal(await prisma.inventoryMovement.count(), 0); assert.equal(await prisma.serviceAppointment.count(), 0);
    });
await t.test("the actual embed payment boundary preserves local policy and capability scope", async () => {
  const auth = await register("public-payment-boundary"), merchantId = auth.merchant_id;
  const policy = await request("/merchants/me/service-business-policy", { expectedVersion: 0, holdEnabled: false,
    paymentMode: "at_attendance", admissionsEnabled: true }, auth.access_token, "PUT");
  assert.equal(policy.status, 200, JSON.stringify(policy));
  const variant = await offer(auth, "PUBLIC-PAYMENT-BOUNDARY", true);
  const path = "/merchants/" + merchantId + "/service-professionals";
  const professional = await request(path, { publicName: "Synthetic public-payment professional", timeZone: "UTC",
    isPublished: true, productIds: [variant.productId] }, auth.access_token);
  assert.equal(professional.status, 201, JSON.stringify(professional));
  const recurring = await request(path + "/" + professional.body.id + "/availability", {
    expectedVersion: professional.body.version, timeZone: "UTC",
    rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 660 })),
  }, auth.access_token, "PUT");
  assert.equal(recurring.status, 200, JSON.stringify(recurring));
  const current = await prisma.serviceProfessional.findUniqueOrThrow({ where: { id: professional.body.id } });
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const cart = { currency: "BRL", total: 50, items: [{ sku: variant.sku, product_id: variant.productId,
    variantId: variant.id, name: "Untrusted presentation", quantity: 1, price: 50, productType: "service",
    fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: { slotId: "untrusted-id", date,
      professionalId: current.id, professionalVersion: current.version, policyVersion: policy.body.version,
      startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z", timeZone: "UTC", durationMinutes: 20 } }] };
  const origin = "https://public-payment-boundary.example.test";
  const issued = await request("/embed-sessions", { allowed_origin: origin,
    scopes: ["checkout:start", "checkout:track", "payment:intents:create", "payment:intents:read"] }, auth.access_token);
  assert.equal(issued.status, 201, JSON.stringify(issued));
  const token = issued.body.embed_session_token;
  const started = await embedRequest(token, origin, "/embed/start", { cart });
  assert.equal(started.status, 201, JSON.stringify(started));
  const sessionId = started.body.session_id;
  const payment = { session_id: sessionId, idempotency_key: "public-local-refusal", method: "pix" };
  const missingContact = await embedRequest(token, origin, "/embed/payment/intents", payment);
  assert.equal(missingContact.status, 400, JSON.stringify(missingContact));
  assert.match(JSON.stringify(missingContact.body), /customer_registration_required/);
  const customer = await embedRequest(token, origin, "/embed/customer/update", { session_id: sessionId,
    customer: { fullName: "Synthetic public buyer", email: "synthetic@public-payment.example.test", phone: "+5521999990000" } });
  assert.equal(customer.status, 201, JSON.stringify(customer));
  const before = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  const local = await embedRequest(token, origin, "/embed/payment/intents", payment);
  assert.equal(local.status, 409, JSON.stringify(local));assert.match(JSON.stringify(local.body), /pay_at_attendance_required/);
  assert.equal((await embedRequest(token, "https://wrong-origin.example.test", "/embed/payment/intents", payment)).status, 403);
  assert.equal((await embedRequest(token, origin, "/embed/payment/intents", { ...payment, session_id: "foreign-checkout" })).status, 401);
  const online = await request("/merchants/me/service-business-policy", { expectedVersion: policy.body.version,
    holdEnabled: false, paymentMode: "online", admissionsEnabled: true }, auth.access_token, "PUT");
  assert.equal(online.status, 200, JSON.stringify(online));
  const stale = await embedRequest(token, origin, "/embed/payment/intents", { ...payment, idempotency_key: "public-stale-refusal" });
  assert.equal(stale.status, 409, JSON.stringify(stale));assert.match(JSON.stringify(stale.body), /policy_changed/);
  assert.deepEqual(await prisma.checkoutSession.findUnique({ where: { id: before.id } }), before);
  assert.equal(await prisma.paymentIntent.count({ where: { merchantId } }), 0);
  assert.equal(await prisma.serviceAppointment.count({ where: { merchantId } }), 0);
  assert.equal(await prisma.inventoryMovement.count({ where: { merchantId } }), 0);
  publicHistory = { merchantId, sessionId, token, origin };
  assert.equal(runtime.evidence().repositoryOverrides, false);assert.equal(runtime.evidence().authOverrides, false);
  assert.equal(runtime.evidence().providerCalls, 0);
});

    await t.test("the real scoped embed status preserves synthetic approved history after admissions close", async () => {
      assert.ok(publicHistory); const history = publicHistory;
      const before = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: history.merchantId, sessionId: history.sessionId } } });
      // Explicit synthetic settled evidence, never a real provider transaction.
      const payment = await prisma.paymentIntent.create({ data: { id: "synthetic-public-payment-history", merchantId: history.merchantId,
        sessionId: history.sessionId, idempotencyKey: "synthetic-public-payment-history", amountCents: 5000, approvedAmountCents: 5000,
        currency: "BRL", method: "pix", status: "approved", providerPaymentId: "synthetic-public-payment-provider" } });
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: history.merchantId }, data: { admissionsEnabled: false, version: { increment: 1 } } });
      const path = "/embed/payment/intents/" + payment.id + "/status?session_id=" + encodeURIComponent(history.sessionId);
      const result = await embedRequest(history.token, history.origin, path, undefined, "GET");
      assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.intent_id, payment.id);
      assert.equal(result.body.status, "approved"); assert.equal(result.body.amount_cents, 5000); assert.equal(result.body.approved_amount_cents, 5000);
      assert.equal(result.body.currency, "BRL"); assert.equal(result.body.provider_payment_id, payment.providerPaymentId);
      assert.deepEqual(await prisma.checkoutSession.findUnique({ where: { id: before.id } }), before);
      assert.deepEqual(await prisma.paymentIntent.findUnique({ where: { id: payment.id } }), payment);
      assert.equal((await embedRequest(history.token, "https://wrong-origin.example.test", path, undefined, "GET")).status, 403);
      assert.equal((await embedRequest(history.token, history.origin, "/embed/payment/intents/" + payment.id + "/status?session_id=foreign-checkout", undefined, "GET")).status, 401);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId: history.merchantId } }), 0);
      assert.equal(await prisma.inventoryMovement.count({ where: { merchantId: history.merchantId } }), 0);
    });
    assert.equal(runtime.evidence().providerCalls, 0);
  } finally { try { if (raw) await raw.$disconnect(); } finally { await runtime.close(); } }
  assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
});
