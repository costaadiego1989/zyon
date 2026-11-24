import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { lockCheckoutSessionAnchor } from "../src/shared/persistence/checkout-session-lock.js";

/** Actual app/guards/issuer/SQL; fixture credentials never enter the test body.
 * Requires only the separately reviewed narrow private continuity validator. */
test("T45 guest login and service payment admission HTTP", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const runtime = await createServiceTestRuntime({ local: true, buyerBooking: true, serviceReleaseFixture: "matching" });
  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } }); const db = prisma;
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runtime.db.runId }]);
    const evidence = runtime.evidence(); assert.equal(evidence.canonicalAppModule, true); assert.equal(evidence.authOverrides, false); assert.equal(evidence.repositoryOverrides, false); assert.equal(evidence.providerCalls, 0);
    const request = async (path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json", "x-correlation-id": randomUUID(), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const origin = "https://guest-service.example.test", password = "SyntheticGuestBuyer123!";
    const { PasswordHasher } = await import("../dist/modules/auth/domain/services/password-hasher.service.js");
    const buyer = await db.buyerAccount.create({ data: { globalUserId: "buyer_" + randomUUID().replaceAll("-", ""), email: "guest@guest-service.example.test", displayName: "Synthetic buyer", passwordHash: await new PasswordHasher().hash(password) } });
    async function company(label: string) {
      const registered = await request("/auth/register", { merchant_name: "Synthetic " + label, email: label + "@guest-service.example.test", password, business_mode: "services" }); assert.equal(registered.status, 201, JSON.stringify(registered));
      const merchantId = registered.body.merchant_id as string;
      await db.merchant.update({ where: { id: merchantId }, data: { plan: "STORE_ONLY" } });
      await db.merchantBillingSubscription.upsert({ where: { merchantId }, create: { merchantId, planKey: "starter", status: "active" }, update: { planKey: "starter", status: "active" } });
      await db.merchantRule.create({ data: { merchantId, maxDiscountPercent: 0, minimumMarginPercent: 0, allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false, autonomousEngineEnabled: false, freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0, offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "Cordial", originZip: "01310000" } });
      const policy = await request("/merchants/me/service-business-policy", { expectedVersion: 0, holdEnabled: false, paymentMode: "at_attendance", admissionsEnabled: true }, { authorization: "Bearer " + registered.body.access_token }, "PUT"); assert.equal(policy.status, 200);
      const product = await db.product.create({ data: { merchantId, name: "Consulta " + label, type: "service", isActive: true, metadata: { serviceSchedule: { durationMinutes: 20, timeZone: "America/Sao_Paulo", slots: [] } }, variants: { create: { sku: "GUEST-" + label, isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
      const professional = await db.serviceProfessional.create({ data: { merchantId, publicName: "Profissional " + label, timeZone: "America/Sao_Paulo", isActive: true, isPublished: true } });
      await db.professionalService.create({ data: { merchantId, professionalId: professional.id, productId: product.id } });
      await db.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ merchantId, professionalId: professional.id, weekday, startMinute: 600, endMinute: 720, timeZone: "America/Sao_Paulo" })) });
      const conversation = await request("/storefront/conversations", { merchant_id: merchantId }, { origin }); assert.equal(conversation.status, 201);
      const cartRef = conversation.body.conversation_id as string;
      const body = { cart_ref: cartRef, conversation_token: conversation.body.conversation_token as string, allowed_origin: origin, scopes: ["checkout:start", "checkout:chat", "payment:intents:read"], ttl_seconds: 900 };
      const guest = await runtime.buyerBooking.issue({ merchantId, body }); assert.equal(guest.status, 201);
      const guestClaims = JSON.parse(Buffer.from(guest.body.embed_session_token.split(".")[0], "base64url").toString()); assert.equal(guestClaims.scopes.includes("appointments:confirm"), false);
      assert.equal(await db.storefrontCart.count({ where: { merchantId, sessionId: cartRef } }), 0, "first read needs no persisted parent");
      const login = await request("/buyer/login", { email: buyer.email, password }); assert.equal(login.status, 201); const buyerToken = login.body.accessToken as string;
      const continued = await runtime.buyerBooking.issue({ merchantId, body: { ...body, previous_embed_token: guest.body.embed_session_token, buyer_access_token: buyerToken } }); assert.equal(continued.status, 201, JSON.stringify(continued));
      const claims = JSON.parse(Buffer.from(continued.body.embed_session_token.split(".")[0], "base64url").toString()); assert.ok(claims.scopes.includes("appointments:confirm")); assert.equal(claims.nonce, guestClaims.nonce); assert.equal(claims.issuedAtUnix, guestClaims.issuedAtUnix);
      const sessionId = "chk_embed_" + createHash("sha256").update(JSON.stringify([merchantId, claims.nonce])).digest("hex");
      const headers = { origin, "x-aacp-embed-token": continued.body.embed_session_token as string, "x-buyer-access-token": buyerToken };
      const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const slots = await request("/embed/service-booking/slots?" + new URLSearchParams({ productId: product.id, variantId: product.variants[0]!.id, professionalId: professional.id, date }), undefined, headers, "GET"); assert.equal(slots.status, 200); assert.ok(slots.body.selections.length);
      const selected = await request("/embed/service-booking/select", { selection: slots.body.selections[0] }, headers); assert.equal(selected.status, 201);
      return { merchantId, cartRef, sessionId, headers, selected: { selection: selected.body.selection, parent_cart_fingerprint: selected.body.parent_cart_fingerprint } };
    }
    type Context = Awaited<ReturnType<typeof company>>;
    const snapshot = async (c: Context) => ({ appointments: await db.serviceAppointment.findMany({ where: { merchantId: c.merchantId } }), balances: await db.appointmentPayment.findMany({ where: { merchantId: c.merchantId } }), audits: await db.appointmentAudit.count({ where: { merchantId: c.merchantId } }), inventory: await db.inventoryMovement.count({ where: { merchantId: c.merchantId } }), checkout: await db.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.sessionId } } }), cart: await db.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.cartRef } } }) });
    const paymentData = (c: Context, status: string) => ({ id: randomUUID(), merchantId: c.merchantId, sessionId: c.sessionId, idempotencyKey: randomUUID(), amountCents: 5000, currency: "BRL", method: "pix", status, ...(status === "approved" ? { approvedAmountCents: 5000 } : {}) });
    await t.test("guest login selects, prepares, explicitly confirms local unpaid booking and replays safely", async () => {
      const c = await company("guest-main"); const prepared = await request("/embed/service-booking/prepare", c.selected, c.headers); assert.equal(prepared.status, 201); assert.equal(prepared.body.confirmed, false);
      const command = { session_id: prepared.body.session_id, command_id: randomUUID(), cart_fingerprint: prepared.body.cart_fingerprint };
      const confirmed = await request("/embed/service-appointments/confirm", command, c.headers); assert.equal(confirmed.status, 201, JSON.stringify(confirmed)); assert.equal(confirmed.body.appointments.length, 1); assert.equal(confirmed.body.appointments[0].operationalStatus, "scheduled"); assert.equal(confirmed.body.appointments[0].payments[0].status, "pending"); assert.equal(confirmed.body.appointments[0].payments[0].receivedAt, null);
      await db.paymentIntent.create({ data: paymentData(c, "pending") }); const before = await snapshot(c);
      const replay = await request("/embed/service-appointments/confirm", command, c.headers); assert.equal(replay.status, 201); assert.equal(replay.body.replayed, true); assert.deepEqual(await snapshot(c), before);
      assert.equal(await db.inventoryMovement.count({ where: { merchantId: c.merchantId } }), 0);
    });
    for (const status of ["pending", "approved"]) await t.test(status + " normal payment appearing after selection blocks prepare without any booking mutation", async () => {
      const c = await company("prepare-" + status); await db.paymentIntent.create({ data: paymentData(c, status) }); const before = await snapshot(c);
      const result = await request("/embed/service-booking/prepare", c.selected, c.headers); assert.equal(result.status, 409); assert.equal(result.body.code ?? result.body.message, "service_checkout_payment_in_progress"); assert.deepEqual(await snapshot(c), before);
    });
    for (const status of ["pending", "approved"]) await t.test(status + " payment wins canonical merchant/session locks while confirm waits: zero appointment or balance created", async () => {
      const c = await company("confirm-" + status); const prepared = await request("/embed/service-booking/prepare", c.selected, c.headers); assert.equal(prepared.status, 201);
      const before = await snapshot(c); let unblock!: () => void, acquired!: (pid: number) => void;
      const entered = new Promise<number>(resolve => { acquired = resolve; }); const gate = new Promise<void>(resolve => { unblock = resolve; });
      const held = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${c.merchantId} FOR UPDATE`; await lockCheckoutSessionAnchor(tx, c.merchantId, c.sessionId); const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; acquired(rows[0]!.pid); await gate; await tx.paymentIntent.create({ data: paymentData(c, status) }); }, { timeout: 15000 });
      let response: Awaited<ReturnType<typeof request>>;
      try {
        const pid = await entered; const pending = request("/embed/service-appointments/confirm", { session_id: c.sessionId, command_id: randomUUID(), cart_fingerprint: prepared.body.cart_fingerprint }, c.headers);
        let waiting = false; for (let attempt = 0; attempt < 100; attempt++) { const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`; if (rows[0]?.waiting) { waiting = true; break; } await new Promise(resolve => setTimeout(resolve, 20)); }
        assert.equal(waiting, true, "real confirm request must wait behind the canonical session lock"); unblock(); await held; response = await pending;
      } finally { unblock(); await held; }
      assert.equal(response.status, 409); assert.equal(response.body.code ?? response.body.message, "service_checkout_payment_in_progress"); assert.deepEqual(await snapshot(c), before); assert.equal(await db.paymentIntent.count({ where: { merchantId: c.merchantId } }), 1);
    });
    assert.equal(runtime.evidence().providerCalls, 0);
  } finally {
    const errors: unknown[] = [];
    try { await prisma?.$disconnect(); } catch (error) { errors.push(error); }
    try { await runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "service_guest_booking_owned_cleanup_failed");
    assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
  }
});
