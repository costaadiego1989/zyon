import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { readProfessionalCheckout } from "../src/shared/bookings/read-professional-checkout.js";
import { serviceActivationReadinessWithin } from "../src/shared/bookings/service-activation-readiness.js";
import { toCheckoutSession } from "../src/modules/checkout/domain/services/checkout-session-projection.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { confirmServiceAppointment } from "../src/modules/checkout/application/confirm-service-appointment.use-case.js";
import { composeServiceReleaseArtifactSource, measureServiceReleaseRuntime } from "../src/shared/bookings/service-release-artifact.js";
import { PasswordHasher } from "../src/modules/auth/domain/services/password-hasher.service.js";
import { fileURLToPath } from "node:url";

// The direct command companion deliberately has the same verifier with MISSING
// data. It must continue only exact original SQL/Redis terms, never a boolean
// bypass. The actual HTTP worker has its own private datasource/process.
composeServiceReleaseArtifactSource(Object.freeze({ readManifest: () => undefined,
  measureRuntime: () => measureServiceReleaseRuntime(fileURLToPath(new URL("../", import.meta.url)), "e".repeat(40)) }));

async function fixture(variant: "matching" | "missing", buyerBooking = false) {
  const runtime = await createServiceTestRuntime({ local: true, serviceReleaseFixture: variant, ...(buyerBooking ? { buyerBooking: true } : {}) });
  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } }); const db = prisma;
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runtime.db.runId }]);
    assert.equal(runtime.evidence().localServiceReleaseFixture.kind, "synthetic_verifier_precondition");
    assert.equal(runtime.evidence().localServiceReleaseFixture.variant, variant); assert.equal(runtime.evidence().localServiceReleaseFixture.releaseProof, "not_proven");
    const request = async (path: string, body?: unknown, token?: string, method = "POST", headers: Record<string, string> = {}) => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() };
    };
    const merchant = async (suffix: string, mode: "products" | "services" = "services") => {
      const result = await request("/auth/register", { merchant_name: "Synthetic " + suffix, email: suffix + "@activation.example.test",
        password: "SyntheticMerchant123!", business_mode: mode }); assert.equal(result.status, 201); const auth = result.body;
      await db.merchant.update({ where: { id: auth.merchant_id }, data: { plan: "STORE_ONLY" } });
      await db.merchantBillingSubscription.upsert({ where: { merchantId: auth.merchant_id }, create: { merchantId: auth.merchant_id, planKey: "growth", status: "active" }, update: { planKey: "growth", status: "active" } });
      return auth;
    };
    const configure = (auth: any, expectedVersion: number, admissionsEnabled: boolean, holdEnabled = false) => request("/merchants/me/service-business-policy",
      { expectedVersion, admissionsEnabled, holdEnabled, ...(holdEnabled ? { holdMinutes: 4 } : {}), paymentMode: "at_attendance" }, auth.access_token, "PUT");
    const offer = async (auth: any, suffix: string) => {
      const merchantId = auth.merchant_id, product = await db.product.create({ data: { merchantId, name: "Consulta " + suffix, type: "service", isActive: true,
        metadata: { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } }, variants: { create: { sku: "ACT-" + suffix, isActive: true,
          price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
      const professional = await db.serviceProfessional.create({ data: { merchantId, publicName: "Profissional " + suffix, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true } });
      await db.professionalService.create({ data: { merchantId, professionalId: professional.id, productId: product.id } });
      await db.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ merchantId, professionalId: professional.id,
        weekday, startMinute: 600, endMinute: 720, timeZone: "America/Sao_Paulo" })) });
      return { product, professional, date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) };
    };
    const close = async () => { try { await db.$disconnect(); } finally { await runtime.close(); }
      assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 }); };
    return { runtime, db, request, merchant, configure, offer, close };
  } catch (error) { try { await prisma?.$disconnect(); } finally { await runtime.close(); } throw error; }
}

test("REG-04", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  await t.test("missing immutable evidence blocks activation but permits a versioned safe disable with no financial changes", async () => {
    const f = await fixture("missing");
    try {
      const auth = await f.merchant("missing"), initial = await f.configure(auth, 0, false); assert.equal(initial.status, 200);
      const before = await f.db.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: auth.merchant_id } });
      const refused = await f.configure(auth, 1, true); assert.equal(refused.status, 409); assert.equal(refused.body.code, "service_activation_not_ready");
      assert.equal(refused.body.blockers, undefined);
      assert.deepEqual(await f.db.$transaction(tx => serviceActivationReadinessWithin(tx, auth.merchant_id)),
        { ready: false, blockers: ["release_manifest_missing"], policyVersion: 1 });
      assert.deepEqual(await f.db.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: auth.merchant_id } }), before);
      for (const patch of [{ ready: true }, { writersMigrated: true }, { releaseProofs: [] }, { merchantId: "foreign" }]) {
        const result = await f.request("/merchants/me/service-business-policy", { expectedVersion: 1, admissionsEnabled: true, holdEnabled: false, paymentMode: "at_attendance", ...patch }, auth.access_token, "PUT");
        assert.ok([400, 403].includes(result.status));
      }
      const disabled = await f.configure(auth, 1, false); assert.equal(disabled.status, 200); assert.equal(disabled.body.version, 2);
      const profile = await f.request("/merchants/me", undefined, auth.access_token, "GET"); assert.equal(profile.body.capabilities.serviceBooking, false);
      assert.equal(profile.body.capabilities.serviceAdministration, true); assert.equal(profile.body.capabilities.reconcileExisting, true);
      assert.equal(await f.db.serviceAppointment.count(), 0); assert.equal(await f.db.paymentIntent.count(), 0); assert.equal(await f.db.inventoryMovement.count(), 0);
      const products = await f.merchant("products", "products"); assert.equal((await f.configure(products, 0, true)).status, 403);
      assert.equal((await f.request("/merchants/me", undefined, products.access_token, "GET")).body.capabilities.products, true);
      assert.equal(f.runtime.evidence().providerCalls, 0);
    } finally { await f.close(); }
  });
  await t.test("matching verifier precondition uses actual migration ledger, and disable preserves attendance, receipts and history", async () => {
    const f = await fixture("matching");
    try {
      const auth = await f.merchant("existing"), c = await f.offer(auth, "existing"); assert.equal((await f.configure(auth, 0, true)).status, 200);
      const migration = await f.db.$queryRaw<Array<{ checksum: string }>>`SELECT checksum FROM _prisma_migrations WHERE migration_name='20261114000000_service_business_capability'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL`; assert.equal(migration.length, 1); assert.match(migration[0]!.checksum, /^[a-f0-9]{64}$/);
      const path = "/merchants/" + auth.merchant_id + "/service-appointments";
      const command = { commandId: "activation-manual", productId: c.product.id, variantId: c.product.variants[0]!.id, professionalId: c.professional.id,
        expectedProfessionalVersion: c.professional.version, expectedPolicyVersion: 1, startsAt: c.date + "T13:00:00.000Z", customer: { kind: "contact", name: "Cliente Sintético", email: "manual-client@activation.example.test" } };
      const created = await f.request(path + "/manual", command, auth.access_token); assert.equal(created.status, 201); const appointment = created.body.appointment;
      const payment = await f.db.appointmentPayment.findFirstOrThrow({ where: { appointmentId: appointment.id } }); assert.equal(payment.status, "pending");
      assert.equal((await f.configure(auth, 1, false)).status, 200);
      assert.equal((await f.request(path + "/manual", { ...command, commandId: "refused-new", startsAt: c.date + "T13:30:00.000Z", expectedPolicyVersion: 2 }, auth.access_token)).status, 409);
      assert.equal(await f.db.serviceAppointment.count({ where: { merchantId: auth.merchant_id } }), 1);
      const start = await f.request(path + "/" + appointment.id + "/transitions", { commandId: "after-disable-start", expectedVersion: 1, action: "start_service" }, auth.access_token);
      assert.equal(start.status, 201); assert.equal(start.body.appointment.operationalStatus, "in_service");
      const receipt = await f.request(path + "/" + appointment.id + "/attendance-receipts", { commandId: "after-disable-paid", paymentId: payment.id,
        expectedPaymentVersion: payment.version, amountCents: 5000, currency: "BRL", paymentMethod: "pix" }, auth.access_token); assert.equal(receipt.status, 201);
      const complete = await f.request(path + "/" + appointment.id + "/transitions", { commandId: "after-disable-complete", expectedVersion: 2, action: "complete_service" }, auth.access_token);
      assert.equal(complete.status, 201); assert.equal(complete.body.appointment.operationalStatus, "completed");
      const detail = await f.request(path + "/" + appointment.id, undefined, auth.access_token, "GET"); assert.equal(detail.status, 200);
      assert.equal(detail.body.operationalStatus, "completed"); assert.equal(detail.body.payments[0].status, "approved");
      assert.equal(await f.db.attendanceReceipt.count({ where: { appointmentPaymentId: payment.id } }), 1);
      assert.equal(await f.db.paymentIntent.count(), 0); assert.equal(await f.db.completedOrder.count(), 0); assert.equal(await f.db.inventoryMovement.count(), 0);
      assert.equal(f.runtime.evidence().providerCalls, 0);
    } finally { await f.close(); }
  });
  await t.test("an exact original held checkout without AP continues through missing release evidence; an uncommitted hold-off draft does not", async () => {
    const f = await fixture("matching", true); let redis: Redis | undefined;
    try {
      redis = new Redis(f.runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 5000, commandTimeout: 5000, enableOfflineQueue: false });
      await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), f.runtime.redis.runId); const store = new RedisServiceSlots(redis);
      const auth = await f.merchant("held-continuation"), c = await f.offer(auth, "held-continuation"); assert.equal((await f.configure(auth, 0, true, true)).status, 200);
      const password = "SyntheticBuyer123!", account = await f.db.buyerAccount.create({ data: { email: "held@activation.example.test", displayName: "Cliente Sintético",
        passwordHash: await new PasswordHasher().hash(password), phone: "5511999999444" } });
      const login = await f.request("/buyer/login", { email: account.email, password }); assert.equal(login.status, 201);
      const origin = "https://activation-owned.example.test";
      const prepare = async () => {
        const conversation = await f.request("/storefront/conversations", { merchant_id: auth.merchant_id, buyer_access_token: login.body.accessToken }, undefined, "POST", { origin }); assert.equal(conversation.status, 201);
        const issued = await f.runtime.buyerBooking.issue({ merchantId: auth.merchant_id, body: { cart_ref: conversation.body.conversation_id,
          conversation_token: conversation.body.conversation_token, allowed_origin: origin, scopes: ["checkout:start", "checkout:track", "appointments:confirm"], ttl_seconds: 900 } }); assert.equal(issued.status, 201);
        const headers = { origin, "x-aacp-embed-token": issued.body.embed_session_token, "x-buyer-access-token": login.body.accessToken };
        const query = new URLSearchParams({ productId: c.product.id, variantId: c.product.variants[0]!.id, professionalId: c.professional.id, date: c.date });
        const slots = await f.request("/embed/service-booking/slots?" + query, undefined, undefined, "GET", headers); assert.equal(slots.status, 200); assert.ok(slots.body.selections.length);
        const selected = await f.request("/embed/service-booking/select", { selection: slots.body.selections[0] }, undefined, "POST", headers); assert.equal(selected.status, 201);
        const result = await f.request("/embed/service-booking/prepare", { selection: selected.body.selection, parent_cart_fingerprint: selected.body.parent_cart_fingerprint }, undefined, "POST", headers);
        assert.equal(result.status, 201); return f.db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: auth.merchant_id, sessionId: result.body.session_id } } });
      };
      const row = await prepare(), session = toCheckoutSession(row); assert.equal(await f.db.serviceAppointment.count(), 0); assert.equal(await f.db.paymentIntent.count(), 0);
      assert.ok(await store.get(auth.merchant_id, row.sessionId));
      await f.db.$transaction(tx => readProfessionalCheckout(tx, session, () => new Date(), { store: () => store }));
      const command = { commandId: "accepted-held-after-release-unavailable", cartFingerprint: paymentCartFingerprint(session) };
      const result = await f.db.$transaction(tx => confirmServiceAppointment(tx, { merchantId: row.merchantId, sessionId: row.sessionId,
        globalUserId: row.globalUserId, origin: "storefront" }, command, { store: () => store })); assert.equal(result.appointments.length, 1);
      assert.equal(result.appointments[0]!.operationalStatus, "scheduled");
      assert.equal((await f.configure(auth, 1, true, false)).status, 200); const draft = await prepare(), before = await f.db.checkoutSession.findUniqueOrThrow({ where: { id: draft.id } });
      await assert.rejects(f.db.$transaction(tx => readProfessionalCheckout(tx, toCheckoutSession(draft), () => new Date(), { store: () => store })), (error: unknown) => {
        assert.ok(error instanceof ConflictException); assert.equal(error.getStatus(), 409);
        assert.deepEqual(error.getResponse(), { code: "service_activation_not_ready", blockers: ["release_manifest_missing"] }); return true;
      });
      assert.deepEqual(await f.db.checkoutSession.findUniqueOrThrow({ where: { id: draft.id } }), before);
      assert.equal(await f.db.serviceAppointment.count(), 1); assert.equal(await f.db.paymentIntent.count(), 0); assert.equal(f.runtime.evidence().providerCalls, 0);
    } finally { try { if (redis) await redis.quit(); } finally { await f.close(); } }
  });
});
