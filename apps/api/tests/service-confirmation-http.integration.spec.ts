import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { createOwnedBookingContinuation } from "./service-owned-booking-continuation-http.fixture.js";

test("T30 HTTP", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const runtime = await createServiceTestRuntime({ local: true, buyerBooking: true, serviceReleaseFixture: "matching" });
  let raw: PrismaClient | undefined;
  try {
    raw = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const prisma = raw;
    const ownedBooking = await createOwnedBookingContinuation(runtime, prisma);
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

    const prepare = async (suffix: string, holdEnabled = false, paymentMode: "online" | "at_attendance" = "at_attendance",
      customer?: { fullName: string; phone?: string; email?: string }) => {
      const auth = await register(suffix), merchantId = auth.merchant_id;
      const policy = await request("/merchants/me/service-business-policy", { expectedVersion: 0, holdEnabled,
        ...(holdEnabled ? { holdMinutes: 7 } : {}), paymentMode, admissionsEnabled: true }, auth.access_token, "PUT");
      assert.equal(policy.status, 200, JSON.stringify(policy));
      const variant = await offer(auth, "CONFIRM-" + suffix, true), path = "/merchants/" + merchantId + "/service-professionals";
      const professional = await request(path, { publicName: "Synthetic confirmation " + suffix, timeZone: "America/Sao_Paulo",
        isPublished: true, productIds: [variant.productId] }, auth.access_token);
      assert.equal(professional.status, 201, JSON.stringify(professional));
      const grade = await request(path + "/" + professional.body.id + "/availability", { expectedVersion: professional.body.version,
        timeZone: "America/Sao_Paulo", rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 420, endMinute: 540 })) }, auth.access_token, "PUT");
      assert.equal(grade.status, 200, JSON.stringify(grade));
      const current = await prisma.serviceProfessional.findUniqueOrThrow({ where: { id: professional.body.id } });
      const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), origin = "https://confirmation.example.test";
      const booking = await ownedBooking({ merchantId, origin, productId: variant.productId, variantId: variant.id,
        professionalId: current.id, date, scopes: ["checkout:start", "checkout:track", "appointments:confirm"],
        buyer: { email: customer?.email ?? suffix + "@confirmation-buyer.example.test",
          displayName: customer?.fullName ?? "Synthetic appointment buyer", ...(customer?.phone ? { phone: customer.phone } : {}) } });
      const token = booking.issued;
      assert.equal(token.status, 201, JSON.stringify(token));
      const cart = { currency: "BRL", total: 50, items: [{ sku: variant.sku, product_id: variant.productId, variantId: variant.id,
        name: "Synthetic presentation", price: 50, quantity: 1, productType: "service", fulfillmentStrategy: "scheduled_service",
        fulfillmentSchedule: { slotId: "display-only", professionalId: current.id, professionalVersion: current.version,
          policyVersion: policy.body.version, date, startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z",
          timeZone: "UTC", durationMinutes: 20 } }] };
      const started = await embedRequest(token.body.embed_session_token, origin, "/embed/start", { cart, buyer_access_token: booking.buyerToken, ...(customer ? { customer } : {}) });
      assert.equal(started.status, 201, JSON.stringify(started));
      assert.match(started.body.service_checkout.cart_fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(started.body.service_checkout.requires_hold, holdEnabled);
      const command = { session_id: started.body.session_id, command_id: "confirm-" + suffix,
        cart_fingerprint: started.body.service_checkout.cart_fingerprint };
      return { auth, merchantId, policy, professional: current, variant, date, origin, token: token.body.embed_session_token, buyerEmail: booking.account.email, started, command };
    };
    const submit = (context: Awaited<ReturnType<typeof prepare>>, body: unknown = context.command, token = context.token, origin = context.origin) =>
      embedRequest(token, origin, "/embed/service-appointments/confirm", body);
    const unchanged = async (merchantId: string) => ({ appointments: await prisma.serviceAppointment.count({ where: { merchantId } }),
      payments: await prisma.appointmentPayment.count({ where: { merchantId } }),
      audit: await prisma.appointmentAudit.count({ where: { merchantId } }),
      events: await prisma.outboxMessage.count({ where: { merchantId, producer: "service-booking" } }),
      provider: await prisma.paymentIntent.count({ where: { merchantId } }), inventory: await prisma.inventoryMovement.count({ where: { merchantId } }) });
    await t.test("actual issuer requires origin and explicit capability; track-only and legacy tokens never finalize", async () => {
      const context = await prepare("scope-confirmation");
      const noOrigin = await request("/embed-sessions", { scopes: ["appointments:confirm"] }, context.auth.access_token);
      assert.equal(noOrigin.status, 400, JSON.stringify(noOrigin));
      assert.match(JSON.stringify(noOrigin.body), /allowed_origin_required_for_transactional_scopes/);
      const before = await unchanged(context.merchantId);
      for (const scopes of [["checkout:start", "checkout:track"], undefined]) {
        const token = await request("/embed-sessions", { allowed_origin: context.origin, ...(scopes ? { scopes } : {}) }, context.auth.access_token);
        assert.equal(token.status, 201, JSON.stringify(token));
        const denied = await submit(context, context.command, token.body.embed_session_token);
        assert.equal(denied.status, 403, JSON.stringify(denied)); assert.match(JSON.stringify(denied.body), /embed_scope_not_granted/);
      }
      const badOrigin = await submit(context, context.command, context.token, "https://foreign.example.test");
      assert.equal(badOrigin.status, 403, JSON.stringify(badOrigin));
      assert.match(JSON.stringify(badOrigin.body), /embed_origin_not_allowed/);
      const foreignSession = await submit(context, { ...context.command, session_id: "foreign-checkout" });
      assert.equal(foreignSession.status, 401, JSON.stringify(foreignSession));
      const identityInjection = await submit(context, { ...context.command, origin: "manual", global_user_id: "foreign-buyer" });
      assert.equal(identityInjection.status, 400, JSON.stringify(identityInjection));
      assert.deepEqual(await unchanged(context.merchantId), before);
    });
    for (const holdEnabled of [false, true]) await t.test("real local confirmation records capacity and pending balance with hold=" + holdEnabled, async () => {
      const missingContext = await prepare("local-confirmation-missing-" + holdEnabled, holdEnabled);
      // Resilience fixture: the authenticated account is valid, but this owned checkout lost its persisted contact.
      // Delete only stored email/phone; preserve account, identity, cart, origin proof, signed capability and real lease.
      const missingCheckout = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
        merchantId: missingContext.merchantId, sessionId: missingContext.command.session_id } } });
      const validAccount = await prisma.buyerAccount.findUniqueOrThrow({ where: { globalUserId: missingCheckout.globalUserId } });
      assert.equal(validAccount.displayName, "Synthetic appointment buyer"); assert.equal(validAccount.email, missingContext.buyerEmail);
      const missingHoldPath = "/embed/service-slot-hold?session_id=" + encodeURIComponent(missingContext.command.session_id);
      const heldBeforeMissingContact = await embedRequest(missingContext.token, missingContext.origin, missingHoldPath, undefined, "GET");
      assert.equal(heldBeforeMissingContact.status, 200, JSON.stringify(heldBeforeMissingContact));
      const missingContact = JSON.parse(JSON.stringify(missingCheckout.customer)) as Record<string, unknown>;
      assert.equal(missingContact.fullName, validAccount.displayName); assert.equal(missingContact.email, validAccount.email);
      delete missingContact.email; delete missingContact.phone;
      const incompleteCheckout = await prisma.checkoutSession.update({ where: { id: missingCheckout.id },
        data: { customer: JSON.parse(JSON.stringify(missingContact)) } });
      assert.deepEqual(incompleteCheckout, { ...missingCheckout, customer: missingContact, version: missingCheckout.version + 1, updatedAt: incompleteCheckout.updatedAt });
      const missing = await submit(missingContext);
      assert.equal(missing.status, 400, JSON.stringify(missing)); assert.match(JSON.stringify(missing.body), /service_appointment_invalid_customer/);
      assert.deepEqual(await unchanged(missingContext.merchantId), { appointments: 0, payments: 0, audit: 0, events: 0, provider: 0, inventory: 0 });
      assert.deepEqual(await prisma.checkoutSession.findUnique({ where: { id: missingCheckout.id } }), incompleteCheckout);
      assert.deepEqual(await prisma.buyerAccount.findUnique({ where: { globalUserId: validAccount.globalUserId } }), validAccount);
      const heldAfterMissingContact = await embedRequest(missingContext.token, missingContext.origin, missingHoldPath, undefined, "GET");
      assert.equal(heldAfterMissingContact.status, 200, JSON.stringify(heldAfterMissingContact));
      assert.deepEqual(heldAfterMissingContact.body, heldBeforeMissingContact.body);
      const context = await prepare("local-confirmation-" + holdEnabled, holdEnabled, "at_attendance", {
        fullName: "Synthetic appointment buyer", ...(holdEnabled ? { email: "buyer@confirmation.example.test" } : { phone: "+5521999990000" }) });
      const registered = context.started; assert.equal(registered.status, 201, JSON.stringify(registered));
      const result = await submit(context); assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.body.replayed, false);
      assert.equal(result.body.appointments.length, 1); const appointment = result.body.appointments[0];
      assert.equal(appointment.professionalId, context.professional.id); assert.equal(appointment.productId, context.variant.productId);
      assert.equal(appointment.variantId, context.variant.id); assert.equal(appointment.startsAt, context.date + "T10:00:00.000Z");
      assert.equal(appointment.endsAt, context.date + "T10:20:00.000Z"); assert.equal(appointment.timeZone, "America/Sao_Paulo");
      assert.equal(appointment.durationMinutes, 20); assert.equal(appointment.priceInCents, 5000); assert.equal(appointment.currency, "BRL");
      assert.equal(appointment.operationalStatus, "scheduled"); assert.equal(appointment.payments.length, 1);
      const payment = appointment.payments[0]; assert.equal(payment.mode, "at_attendance"); assert.equal(payment.status, "pending");
      assert.equal(payment.amountCents, 5000); assert.equal(payment.receivedAt, null);
      assert.deepEqual(Object.keys(payment).sort(), ["id", "mode", "status", "amountCents", "currency", "receivedAt", "requiresRegularization"].sort());
      for (const key of ["customerSnapshot", "buyerGlobalUserId", "actorId", "requestFingerprint", "policySnapshot"])
        assert.equal(Object.hasOwn(appointment, key), false);
      assert.deepEqual(await unchanged(context.merchantId), { appointments: 1, payments: 1, audit: 1, events: 1, provider: 0, inventory: 0 });
      const before = await prisma.serviceAppointment.findUniqueOrThrow({ where: { id: appointment.id } });
      assert.deepEqual(before.customerSnapshot, { name: "Synthetic appointment buyer",
        email: context.buyerEmail, ...(!holdEnabled ? { phone: "+5521999990000" } : {}) });
      // Synthetic later operator state; no PSP approval or actual receipt is claimed.
      const receivedAt = new Date(); await prisma.appointmentPayment.update({ where: { id: payment.id },
        data: { status: "approved", receivedAt, version: { increment: 1 } } });
      const closed = await request("/merchants/me/service-business-policy", { expectedVersion: context.policy.body.version,
        holdEnabled, ...(holdEnabled ? { holdMinutes: 7 } : {}), paymentMode: "at_attendance", admissionsEnabled: false }, context.auth.access_token, "PUT");
      assert.equal(closed.status, 200, JSON.stringify(closed));
      const replay = await submit(context); assert.equal(replay.status, 201, JSON.stringify(replay)); assert.equal(replay.body.replayed, true);
      assert.equal(replay.body.appointments[0].id, appointment.id); assert.equal(replay.body.appointments[0].payments[0].status, "approved");
      assert.equal(replay.body.appointments[0].payments[0].receivedAt, receivedAt.toISOString());
      assert.deepEqual(await prisma.serviceAppointment.findUnique({ where: { id: before.id } }), before);
      const changedSummary = await submit(context, { ...context.command, cart_fingerprint: "0".repeat(64) });
      assert.equal(changedSummary.status, 409, JSON.stringify(changedSummary));
      assert.match(JSON.stringify(changedSummary.body), /service_appointment_idempotency_conflict/);
      const state = await embedRequest(context.token, context.origin, "/embed/service-slot-hold?session_id=" + encodeURIComponent(context.command.session_id), undefined, "GET");
      assert.equal(state.status, 200, JSON.stringify(state)); assert.deepEqual(state.body, { requires_hold: false, service_slot_hold: null });
      assert.deepEqual(await unchanged(context.merchantId), { appointments: 1, payments: 1, audit: 1, events: 1, provider: 0, inventory: 0 });
    });
    for (const holdEnabled of [false, true]) await t.test("verified profile is reused without a customer body with hold=" + holdEnabled, async () => {
      const suffix = "profile-reuse-" + holdEnabled, expectedName = "Synthetic appointment buyer";
      const expectedEmail = suffix + "@confirmation-buyer.example.test";
      // No customer argument: prepare sends the real /embed/start body without a customer member.
      const context = await prepare(suffix, holdEnabled);
      const checkout = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
        merchantId: context.merchantId, sessionId: context.command.session_id } } });
      const buyer = await prisma.buyerAccount.findUniqueOrThrow({ where: { globalUserId: checkout.globalUserId } });
      assert.equal(buyer.displayName, expectedName); assert.equal(buyer.email, expectedEmail);
      const inherited = JSON.parse(JSON.stringify(checkout.customer));
      assert.equal(inherited.fullName, expectedName); assert.equal(inherited.email, expectedEmail);
      assert.equal(inherited.email_verified, true); assert.equal(inherited.phone ?? undefined, undefined);
      const result = await submit(context); assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.body.replayed, false); assert.equal(result.body.appointments.length, 1);
      const appointment = await prisma.serviceAppointment.findUniqueOrThrow({ where: { id: result.body.appointments[0].id }, include: { payments: true } });
      assert.equal(appointment.buyerGlobalUserId, buyer.globalUserId); assert.equal(appointment.origin, "storefront");
      assert.deepEqual(appointment.customerSnapshot, { name: expectedName, email: expectedEmail });
      assert.equal(appointment.operationalStatus, "scheduled"); assert.equal(appointment.durationMinutes, 20);
      assert.equal(appointment.startsAt.toISOString(), context.date + "T10:00:00.000Z");
      assert.equal(appointment.endsAt.toISOString(), context.date + "T10:20:00.000Z"); assert.equal(appointment.timeZone, "America/Sao_Paulo");
      assert.equal(appointment.priceInCents, 5000); assert.equal(appointment.currency, "BRL"); assert.equal(appointment.payments.length, 1);
      const payment = appointment.payments[0]; assert.equal(payment.mode, "at_attendance"); assert.equal(payment.status, "pending");
      assert.equal(payment.amountCents, 5000); assert.equal(payment.currency, "BRL");
      assert.equal(payment.receivedAt, null); assert.equal(payment.requiresRegularization, false);
      assert.equal(result.body.appointments[0].payments[0].status, "pending");
      for (const key of ["customerSnapshot", "buyerGlobalUserId", "actorId", "requestFingerprint", "policySnapshot"])
        assert.equal(Object.hasOwn(result.body.appointments[0], key), false);
      assert.deepEqual(await unchanged(context.merchantId), { appointments: 1, payments: 1, audit: 1, events: 1, provider: 0, inventory: 0 });
    });
    await t.test("concurrent actual HTTP retries return one booking and one local balance", async () => {
      const context = await prepare("concurrent-confirmation", false, "at_attendance", {
        fullName: "Synthetic appointment buyer", phone: "+5521999990000" }); assert.equal(context.started.status, 201);
      const results = await Promise.all([submit(context), submit(context)]);
      for (const result of results) assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(results.filter(result => result.body.replayed === false).length, 1);
      assert.equal(results.filter(result => result.body.replayed === true).length, 1);
      assert.equal(results[0].body.appointments[0].id, results[1].body.appointments[0].id);
      assert.deepEqual(await unchanged(context.merchantId), { appointments: 1, payments: 1, audit: 1, events: 1, provider: 0, inventory: 0 });
    });
    await t.test("another merchant capability cannot confirm the first merchant session", async () => {
      const owner = await prepare("foreign-owner"), foreign = await prepare("foreign-actor");
      const beforeOwner = await unchanged(owner.merchantId), beforeForeign = await unchanged(foreign.merchantId);
      const denied = await submit(owner, owner.command, foreign.token);
      assert.equal(denied.status, 401, JSON.stringify(denied)); assert.match(JSON.stringify(denied.body), /embed_checkout_session_binding_mismatch/);
      assert.deepEqual(await unchanged(owner.merchantId), beforeOwner); assert.deepEqual(await unchanged(foreign.merchantId), beforeForeign);
    });
    await t.test("online policy and a stale quotation cannot become a local confirmation", async () => {
      const context = await prepare("online-confirmation", false, "online", {
        fullName: "Synthetic appointment buyer", email: "buyer@confirmation.example.test" }); assert.equal(context.started.status, 201);
      const online = await submit(context); assert.equal(online.status, 409, JSON.stringify(online));
      assert.match(JSON.stringify(online.body), /service_online_payment_required/);
      const edited = await request("/merchants/me/service-business-policy", { expectedVersion: context.policy.body.version,
        holdEnabled: false, paymentMode: "at_attendance", admissionsEnabled: true }, context.auth.access_token, "PUT");
      assert.equal(edited.status, 200, JSON.stringify(edited));
      const stale = await submit(context); assert.equal(stale.status, 409, JSON.stringify(stale)); assert.match(JSON.stringify(stale.body), /service_policy_changed/);
      assert.deepEqual(await unchanged(context.merchantId), { appointments: 0, payments: 0, audit: 0, events: 0, provider: 0, inventory: 0 });
    });
    assert.equal(runtime.evidence().repositoryOverrides, false); assert.equal(runtime.evidence().authOverrides, false);
    assert.equal(runtime.evidence().providerCalls, 0);
  } finally {
    const errors: unknown[] = [];
    try { if (raw) await raw.$disconnect(); } catch (error) { errors.push(error); }
    try { await runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_confirmation_http_cleanup_failed");
  }
  assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
});
