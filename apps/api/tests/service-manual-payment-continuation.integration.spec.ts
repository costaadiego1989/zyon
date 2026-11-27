import assert from "node:assert/strict";
import { composeOwnedSourceServiceRelease } from "./service-release-source-process.fixture.js";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { CreateManualServiceAppointmentUseCase } from "../src/modules/operations/application/create-manual-service-appointment.use-case.js";
import { prepareManualServicePaymentWithin } from "../src/shared/bookings/manual-service-payment-continuation.js";
import { reserveProfessionalOrderUnit } from "../src/shared/bookings/service-order-appointment.js";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { parseAppointmentLease } from "../src/shared/bookings/appointment-lease-proof.js";
import { professionalSlotId } from "../src/shared/bookings/service-checkout-selection.js";
import { serviceCheckoutProvenance } from "../src/shared/bookings/service-checkout-provenance.js";

// Real local SQL/Redis journal/link evidence; public producer/dispatch wiring is41.
test("T35 trusted manual financial continuation preserves the pending appointment", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture({ serviceReleaseFixture: "matching" }); let redis: Redis | undefined;
  try {
    const releaseFixtureScope = composeOwnedSourceServiceRelease("matching"); t.after(() => releaseFixtureScope.close());
    redis = new Redis(f.runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), f.runtime.redis.runId);
    const store = new RedisServiceSlots(redis), actor = { merchantId: f.owner.merchant_id, userId: f.owner.user_id, role: "owner" };
    const prepare = async (suffix: string, held = false) => {
      const seed = await f.prepare("manual-finance-" + suffix, "online"); let appointment = seed.appointment, originalOwner: string | undefined;
      if (held) {
        const row = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: actor.merchantId } });
        const changed = await f.request("/merchants/me/service-business-policy", { expectedVersion: row.version, paymentMode: "online", holdEnabled: true, holdMinutes: 7, admissionsEnabled: true }, f.owner, "PUT"); assert.equal(changed.status, 200);
        const result = await new CreateManualServiceAppointmentUseCase(f.prisma).execute(actor, { ...seed.command, commandId: "held-" + suffix,
          expectedPolicyVersion: changed.body.version, startsAt: seed.date + "T10:20:00.000Z" }, { store: () => ({
          acquire: (m, owner, slots, ttl) => { originalOwner = owner; return store.acquire(m, owner, slots, ttl); },
          assertActive: store.assertActive.bind(store), get: store.get.bind(store), release: store.release.bind(store),
        }) }); appointment = result.appointment;
      }
      const before = await f.snapshot(appointment.id), a = before.appointment;
      const selected = { productId: a.productId, variantId: a.variantId, professionalId: a.professionalId, professionalVersion: seed.professional.version,
        policyVersion: a.policyVersion, date: seed.date, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), timeZone: a.timeZone,
        durationMinutes: a.durationMinutes, priceInCents: a.priceInCents, currency: a.currency, slotId: "" }; selected.slotId = professionalSlotId(actor.merchantId, selected);
      const sessionId = "manual-payment-session-" + suffix, intentId = "manual-payment-intent-" + suffix, unitId = "manual-payment-unit-" + suffix;
      const scope = { merchantId: actor.merchantId, sessionId, globalUserId: "independent-payer-" + suffix };
      const provenance = serviceCheckoutProvenance(scope, { serverChannel: "storefront" });
      await f.prisma.checkoutSession.create({ data: { ...scope, conversationId: sessionId, ...provenance, createdAt: new Date(), updatedAt: new Date(),
        customer: { fullName: "Independent synthetic payer", email: "payer@example.test" }, cart: { currency: a.currency, total: a.priceInCents / 100,
          items: [{ sku: seed.product.variants[0].sku, product_id: a.productId, variantId: a.variantId, name: "Synthetic appointment payment", quantity: 1,
            price: a.priceInCents / 100, productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: selected }] } } });
      const payment = await f.prisma.paymentIntent.create({ data: { id: intentId, merchantId: actor.merchantId, sessionId, idempotencyKey: intentId,
        amountCents: a.priceInCents, currency: a.currency, method: "pix", status: "pending", creation: { state: "ready", input: { merchantId: actor.merchantId,
          sessionId, amountCents: a.priceInCents, currency: a.currency, method: "pix", providerIdempotencyKey: intentId } } } });
      const command = { appointmentId: a.id, expectedVersion: a.version, paymentIntentId: payment.id, unitId, commandId: "link-" + suffix };
      const link = (principal = actor, input = command) => f.prisma.$transaction(tx => prepareManualServicePaymentWithin(tx, principal, input, { store: () => store }));
      const approve = async () => {
        const providerId = "synthetic-approved-" + suffix;
        await f.prisma.paymentIntent.update({ where: { id: payment.id }, data: { status: "approved", approvedAmountCents: payment.amountCents, providerPaymentId: providerId } });
        return f.prisma.completedOrder.create({ data: { id: randomUUID(), merchantId: actor.merchantId, sessionId, externalOrderId: providerId, currency: a.currency,
          orderTotal: a.priceInCents / 100, status: "approved", completedAt: new Date(), lineItemsJson: [{ lineId: unitId, snapshotVersion: 2,
            sku: seed.product.variants[0].sku, productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1, variantId: a.variantId,
            unitPriceCents: a.priceInCents, schedule: selected }] } });
      };
      return { ...seed, appointment: a, before, selected, payment, sessionId, unitId, command, manualCommand: seed.command, link, approve, originalOwner };
    };
    const promote = (c: any, order: any) => f.prisma.$transaction(tx => reserveProfessionalOrderUnit(tx, actor.merchantId, order.id, c.unitId, { store: () => store }));
    await t.test("ready intent link promotes SAME ID and retains manual origin fingerprint identity and immutable admission", async () => {
      const c = await prepare("same-id"), linked = await c.link(); assert.equal(linked.payment.status, "pending"); assert.equal(linked.payment.appointmentId, c.appointment.id);
      assert.equal((await f.snapshot(c.appointment.id)).appointment.operationalStatus, "pending"); const order = await c.approve(); await promote(c, order);
      const after = await f.snapshot(c.appointment.id); assert.equal(after.appointment.id, c.appointment.id); assert.equal(after.appointment.operationalStatus, "scheduled");
      assert.equal(after.appointment.version, 2); assert.equal(after.appointment.origin, "manual"); assert.equal(after.appointment.buyerGlobalUserId, c.before.appointment.buyerGlobalUserId);
      assert.deepEqual(after.appointment.customerSnapshot, c.before.appointment.customerSnapshot); assert.equal(after.appointment.requestFingerprint, c.before.appointment.requestFingerprint);
      assert.deepEqual(after.audits.find((a: any) => a.action === "manual_create"), c.before.audits[0]); assert.equal(after.balances[0].id, linked.payment.id);
      assert.equal(after.balances[0].status, "approved"); assert.equal(after.balances[0].amountCents, 5000);
      const projection = await f.prisma.serviceReservation.findUniqueOrThrow({ where: { orderId_unitId: { orderId: order.id, unitId: c.unitId } } });
      assert.equal(projection.appointmentId, c.appointment.id); assert.equal(projection.classificationPending, false);
      const manualReplay = await f.request(f.prefix() + "/manual", c.manualCommand);
      assert.equal(manualReplay.status, 201); assert.equal(manualReplay.body.appointment.id, c.appointment.id); assert.equal(manualReplay.body.replayed, true);
      assert.equal(await f.prisma.appointmentAudit.count({ where: { appointmentId: c.appointment.id, action: "manual_create" } }), 1);
    });
    await t.test("same prepare and approved retries never add another financial or appointment receipt", async () => {
      const c = await prepare("retry"), one = await c.link(), two = await c.link(); assert.equal(two.replayed, true); assert.equal(two.payment.id, one.payment.id);
      const sameFinancialReference = await c.link(actor, { ...c.command, commandId: "same-financial-reference" });
      assert.equal(sameFinancialReference.replayed, true); assert.equal(sameFinancialReference.payment.id, one.payment.id);
      const order = await c.approve(); await promote(c, order); const before = await f.snapshot(c.appointment.id); await promote(c, order);
      assert.deepEqual(await f.snapshot(c.appointment.id), before); assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 1);
    });
    await t.test("foreign role stale version or dispatched intent cannot manufacture a financial link", async () => {
      const c = await prepare("negative"), before = await f.snapshot(c.appointment.id);
      await assert.rejects(c.link({ ...actor, role: "staff" }), /service_operator_required/);
      await assert.rejects(c.link({ ...actor, merchantId: f.foreign.merchant_id }), /service_appointment_not_found/);
      await assert.rejects(c.link(actor, { ...c.command, expectedVersion: 2 }), /service_appointment_version_conflict/);
      await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data: { creation: { state: "in_flight", firstAttemptAt: new Date().toISOString(), input: {} } } });
      await assert.rejects(c.link(), /service_manual_payment_not_unsubmitted/); assert.deepEqual(await f.snapshot(c.appointment.id), before);
    });
    await t.test("unlinked equal coordinates never grant adoption of another pending manual appointment", async () => {
      const c = await prepare("no-guessed-adoption"), order = await c.approve(); await promote(c, order);
      const source = await f.snapshot(c.appointment.id), booked = await f.prisma.serviceAppointment.findUniqueOrThrow({ where: { merchantId_orderId_orderUnitId: {
        merchantId: actor.merchantId, orderId: order.id, orderUnitId: c.unitId } } });
      assert.notEqual(booked.id, c.appointment.id); assert.equal(source.appointment.operationalStatus, "pending"); assert.deepEqual(source, c.before);
      const ready = await f.prisma.paymentIntent.create({ data: { id: "occupied-ready-intent", merchantId: actor.merchantId,
        sessionId: c.sessionId, idempotencyKey: "occupied-ready", amountCents: 5000, currency: "BRL", method: "pix", status: "pending", creation: c.payment.creation as any } });
      await assert.rejects(c.link(actor, { ...c.command, commandId: "occupied-link", paymentIntentId: ready.id }), /service_slot_unavailable/);
      assert.deepEqual(await f.snapshot(c.appointment.id), c.before); assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: ready.id } }), 0);
    });
    await t.test("later pending reschedule invalidates old correlation without reviving or duplicating a booking", async () => {
      const c = await prepare("moved"), linked = await c.link();
      const destination = { professionalId: c.professional.id, expectedProfessionalVersion: c.professional.version, startsAt: c.date + "T10:20:00.000Z" };
      const quote = await f.request(f.prefix() + "/" + c.appointment.id + "/reschedule-quote", { expectedVersion: 1, destination }); assert.equal(quote.status, 201);
      const moved = await f.request(f.prefix() + "/" + c.appointment.id + "/reschedule", { expectedVersion: 1, destination, commandId: "move-before-paid",
        operatorRequestId: "human", policyHash: quote.body.quote.policyHash, acceptedQuoteHash: quote.body.quoteHash }); assert.equal(moved.status, 201);
      const before = await f.snapshot(c.appointment.id), order = await c.approve(); await assert.rejects(promote(c, order), /service_manual_payment_snapshot_changed/);
      assert.deepEqual(await f.snapshot(c.appointment.id), before); assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 0);
      assert.equal((await f.prisma.appointmentPayment.findUniqueOrThrow({ where: { id: linked.payment.id } })).status, "pending");
    });
    await t.test("held manual uses its captured operator generation and never a buyer session owner guess", async () => {
      const c = await prepare("held", true), linked = await c.link(), original = await f.prisma.appointmentAudit.findFirstOrThrow({ where: { appointmentId: c.appointment.id, action: "manual_create" } });
      const capture = parseAppointmentLease((original.after as any).privateLease); assert.ok(capture?.kind === "owned"); assert.ok(c.originalOwner);
      const raw = await redis!.get(store.checkoutKey(actor.merchantId, c.originalOwner)); const order = await c.approve(); await promote(c, order);
      assert.equal((await f.snapshot(c.appointment.id)).appointment.id, c.appointment.id); assert.equal(await redis!.get(store.checkoutKey(actor.merchantId, c.originalOwner)), raw);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { appointmentId: c.appointment.id, paymentIntentId: c.payment.id } }), 1);
      assert.equal((await f.prisma.appointmentPayment.findUniqueOrThrow({ where: { id: linked.payment.id } })).status, "approved");
    });
    await t.test("same owner and terms with a NEW generation cannot stand in for the original manual capture", async () => {
      const c = await prepare("held-aba", true); await c.link(); assert.ok(c.originalOwner); const held = await store.get(actor.merchantId, c.originalOwner); assert.ok(held);
      await store.release(actor.merchantId, c.originalOwner); await store.acquire(actor.merchantId, c.originalOwner, held.slots, 420_000);
      const newer = await redis!.get(store.checkoutKey(actor.merchantId, c.originalOwner)), before = await f.snapshot(c.appointment.id), order = await c.approve();
      await assert.rejects(promote(c, order), /service_manual_original_hold_required/); assert.deepEqual(await f.snapshot(c.appointment.id), before);
      assert.equal(await redis!.get(store.checkoutKey(actor.merchantId, c.originalOwner)), newer); assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 0);
    });
    await t.test("immutable correlation and a real promotion outbox fault preserve original and approved money on rollback", async () => {
      const c = await prepare("rollback"), linked = await c.link();
      for (const data of [{ after: {} }, { action: "admit" }, { version: 99 }])
        await assert.rejects(f.prisma.appointmentAudit.update({ where: { id: linked.receipt.id }, data }), /service_manual_payment_receipt_immutable/);
      const receiptData = { merchantId: actor.merchantId, appointmentId: c.appointment.id, version: c.appointment.version,
        action: "manual_payment_prepare", actorId: actor.userId, origin: "operator", after: linked.receipt.after as any };
      await assert.rejects(f.prisma.appointmentAudit.create({ data: { ...receiptData, commandId: "duplicate-financial-unit" } }));
      await assert.rejects(f.prisma.appointmentAudit.create({ data: { ...receiptData, commandId: "invalid-financial-unit",
        after: { privatePaymentContinuation: { ...(linked.receipt.after as any).privatePaymentContinuation, schemaVersion: 0 } } } }));
      assert.equal(await f.prisma.appointmentAudit.count({ where: { appointmentId: c.appointment.id, action: "manual_payment_prepare" } }), 1);
      const order = await c.approve(), before = await f.snapshot(c.appointment.id), money = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } });
      await f.runtime.db.sql("CREATE FUNCTION t35_reject_promotion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.scheduled' THEN RAISE EXCEPTION 'synthetic_t35_promotion_rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER t35_reject_promotion BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t35_reject_promotion();");
      try { await assert.rejects(promote(c, order), /synthetic_t35_promotion_rollback/); assert.deepEqual(await f.snapshot(c.appointment.id), before);
        assert.deepEqual(await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } }), money);
      } finally { await f.runtime.db.sql("DROP TRIGGER t35_reject_promotion ON outbox_messages; DROP FUNCTION t35_reject_promotion();"); }
    });
  } finally { redis?.disconnect(); await f.close(); }
});
