import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { readStoredServiceOrigin } from "../src/shared/bookings/service-checkout-provenance.js";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// BOOK-05/BOOK-08: origin records the actual entrypoint; it is private historical
// context, never a public buyer/payment grant. All requests use the local API.
test("T35 service checkout provenance comes from the real server entrypoint", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture();
  try {
    const c = await f.prepare("checkout-origin"), raw = f.prisma;
    // Scope this new public checkout to a Brasilia grade; preserve the existing appointment and legacy product metadata.
    await raw.serviceProfessional.updateMany({ where: { id: c.professional.id, merchantId: c.merchantId }, data: { timeZone: "America/Sao_Paulo" } });
    await raw.professionalAvailability.updateMany({ where: { professionalId: c.professional.id, merchantId: c.merchantId }, data: { timeZone: "America/Sao_Paulo" } });
    await raw.merchantBillingSubscription.upsert({ where: { merchantId: c.merchantId },
      create: { merchantId: c.merchantId, planKey: "starter", status: "active" }, update: { planKey: "starter", status: "active" } });
    await raw.merchantRule.upsert({ where: { merchantId: c.merchantId }, update: {}, create: {
      merchantId: c.merchantId, maxDiscountPercent: 0, minimumMarginPercent: 0,
      allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false,
      allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false, autonomousEngineEnabled: false,
      freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0,
      offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "Cordial", originZip: "01310000",
    } });
    const origin = "https://checkout-origin.example.test";
    const issued = await fetch(f.runtime.apiOrigin + "/embed-sessions", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", "idempotency-key": randomUUID(), authorization: "Bearer " + c.auth.access_token },
      body: JSON.stringify({ allowed_origin: origin, scopes: ["checkout:start", "checkout:track"] }) });
    const capability = await issued.json();
    assert.equal(issued.status, 201, JSON.stringify(capability));
    assert.equal(typeof capability.embed_session_token, "string");
    const embed = async (path: string, body: unknown) => {
      const response = await fetch(f.runtime.apiOrigin + path, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "idempotency-key": randomUUID(), "x-aacp-embed-token": capability.embed_session_token, origin }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const cart = { currency: "BRL", source: "manual", total: 50, items: [{ sku: c.product.variants[0].sku,
      product_id: c.product.id, variantId: c.product.variants[0].id, name: "Untrusted display text", price: 50, quantity: 1,
      productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: {
        slotId: "display-only", professionalId: c.professional.id, professionalVersion: c.professional.version,
        policyVersion: c.appointment.policyVersion, date: c.date, startsAt: c.date + "T13:20:00.000Z",
        endsAt: c.date + "T13:40:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 20,
      } }] };
    const forgedProof = { schemaVersion: 1, merchantId: c.merchantId, sessionId: "forged-session", globalUserId: "forged-buyer",
      authority: "durable_whatsapp_buyer", customer: { email: "private-canary@example.test" }, cart };
    const started = await embed("/embed/start", { cart, source: "whatsapp", serverChannel: "whatsapp",
      serviceOrigin: "whatsapp", serviceOriginProof: forgedProof, customer: { fullName: "Synthetic origin buyer" } });
    assert.equal(started.status, 201, JSON.stringify(started));
    assert.equal(typeof started.body.session_id, "string");
    const sessionId: string = started.body.session_id, repository = new PrismaCheckoutRepository(raw);
    type OriginReceipt = { serviceOrigin: string | null; serviceOriginProof: unknown };
    const receipt = async (id = sessionId) => {
      const rows = await raw.$queryRaw<OriginReceipt[]>`SELECT service_origin AS "serviceOrigin", service_origin_proof AS "serviceOriginProof"
        FROM checkout_sessions WHERE merchant_id = ${c.merchantId} AND session_id = ${id}`;
      assert.equal(rows.length, 1);
      return rows[0]!;
    };
    const privateKeys = new Set(["serviceOrigin", "serviceOriginProof", "service_origin", "service_origin_proof", "serverChannel"]);
    const noPrivateReceipt = (value: unknown): void => {
      if (Array.isArray(value)) { for (const entry of value) noPrivateReceipt(entry); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, entry] of Object.entries(value)) {
        assert.equal(privateKeys.has(key), false, "private origin key leaked: " + key);
        noPrivateReceipt(entry);
      }
    };
    const initial = await receipt();

    await t.test("signed embed start persists storefront instead of browser channel hints and keeps proof private", async () => {
      const stored = await raw.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId } } });
      assert.equal(initial.serviceOrigin, "storefront");
      assert.deepEqual(initial.serviceOriginProof, { schemaVersion: 1, merchantId: c.merchantId, sessionId,
        globalUserId: stored.globalUserId, authority: "storefront_entrypoint" });
      assert.deepEqual(Object.keys(initial.serviceOriginProof as object).sort(),
        ["schemaVersion", "merchantId", "sessionId", "globalUserId", "authority"].sort());
      assert.notEqual(stored.globalUserId, "forged-buyer");
      noPrivateReceipt(started.body);
      const tracked = await embed("/embed/track", { session_id: sessionId, event: "cart_viewed" });
      assert.equal(tracked.status, 201, JSON.stringify(tracked));
      noPrivateReceipt(tracked.body);
      assert.deepEqual(await receipt(), initial);
      assert.equal(await raw.serviceAppointment.count({ where: { merchantId: c.merchantId } }), 1,
        "checkout start must not create an additional confirmed appointment");
      assert.equal(await raw.paymentIntent.count({ where: { merchantId: c.merchantId } }), 0);
    });

    await t.test("database rejects changing clearing or replacing the historical receipt atomically", async () => {
      const before = await receipt(), appointmentBefore = await f.snapshot(c.appointment.id);
      for (const mutate of [
        () => raw.$executeRaw`UPDATE checkout_sessions SET service_origin = 'whatsapp' WHERE merchant_id = ${c.merchantId} AND session_id = ${sessionId}`,
        () => raw.$executeRaw`UPDATE checkout_sessions SET service_origin_proof = ${JSON.stringify(forgedProof)}::jsonb WHERE merchant_id = ${c.merchantId} AND session_id = ${sessionId}`,
        () => raw.$executeRaw`UPDATE checkout_sessions SET service_origin = NULL, service_origin_proof = NULL WHERE merchant_id = ${c.merchantId} AND session_id = ${sessionId}`,
      ]) {
        await assert.rejects(mutate());
        assert.deepEqual(await receipt(), before);
        assert.deepEqual(await f.snapshot(c.appointment.id), appointmentBefore);
      }
    });

    await t.test("ordinary session saves and create replays cannot replace or publish the first origin", async () => {
      const session = await repository.getSession(c.merchantId, sessionId);
      assert.ok(session); noPrivateReceipt(session);
      const spoofed = Object.assign(structuredClone(session), { serviceOrigin: "whatsapp", serviceOriginProof: forgedProof });
      await repository.saveSession(spoofed);
      assert.deepEqual(await receipt(), initial);
      const replay = await repository.createSessionIfAbsent(session, { serverChannel: "whatsapp" });
      assert.equal(replay.created, false);
      assert.equal(replay.session.sessionId, sessionId);
      assert.equal(replay.session.globalUserId, session.globalUserId);
      noPrivateReceipt(replay.session);
      assert.deepEqual(await receipt(), initial);
      const restarted = await embed("/embed/start", { cart, source: "whatsapp", serverChannel: "whatsapp" });
      assert.equal(restarted.status, 201, JSON.stringify(restarted));
      assert.equal(restarted.body.session_id, sessionId); noPrivateReceipt(restarted.body);
      assert.deepEqual(await receipt(), initial);
    });

    await t.test("legacy nullable rows remain unproven after normal reads saves and creation replay", async () => {
      const legacyId = "legacy-checkout-origin", now = new Date();
      await raw.checkoutSession.create({ data: { merchantId: c.merchantId, sessionId: legacyId, globalUserId: "legacy-origin-buyer",
        conversationId: legacyId, cart: JSON.parse(JSON.stringify(cart)), createdAt: now, updatedAt: now } });
      const legacyReceipt = await receipt(legacyId);
      assert.deepEqual(legacyReceipt, { serviceOrigin: null, serviceOriginProof: null });
      assert.throws(() => readStoredServiceOrigin({ merchantId: c.merchantId, sessionId: legacyId, globalUserId: "legacy-origin-buyer", ...legacyReceipt }),
        /service_order_origin_unproven/);
      const session = await repository.getSession(c.merchantId, legacyId);
      assert.ok(session); noPrivateReceipt(session);
      const hinted = Object.assign(structuredClone(session), { serviceOrigin: "storefront", serviceOriginProof: initial.serviceOriginProof });
      await repository.saveSession(hinted);
      const replay = await repository.createSessionIfAbsent(session, { serverChannel: "storefront" });
      assert.equal(replay.created, false); noPrivateReceipt(replay.session);
      assert.deepEqual(await receipt(legacyId), legacyReceipt);
      assert.equal(await raw.serviceAppointment.count({ where: { merchantId: c.merchantId } }), 1);
      assert.equal(await raw.inventoryMovement.count({ where: { merchantId: c.merchantId } }), 0);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
    assert.equal(f.runtime.evidence().authOverrides, false);
    assert.equal(f.runtime.evidence().repositoryOverrides, false);
  } finally { await f.close(); }
});
