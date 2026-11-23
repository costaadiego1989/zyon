import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createProfessionalHttpFixture } from "./service-professional-http-fixture.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { getProfessionalAvailability } from "../src/modules/catalog/application/get-professional-availability.js";
import { admitServiceAppointment, type ServiceAppointmentAdmissionInput } from "../src/shared/bookings/service-appointment-admission.service.js";
import { reserveProfessionalOrderUnit } from "../src/shared/bookings/service-order-appointment.js";
import { serviceCheckoutProvenance } from "../src/shared/bookings/service-checkout-provenance.js";
import { professionalSlotId } from "../src/shared/bookings/service-checkout-selection.js";
import { noAppointmentLease } from "../src/shared/bookings/appointment-lease-proof.js";
import { prepareManualServicePaymentWithin } from "../src/shared/bookings/manual-service-payment-continuation.js";
import { Redis } from "ioredis";
import { RedisServiceSlots, originalSlotLeaseProof } from "../src/shared/bookings/redis-service-slots.js";
import { readProfessionalCheckout } from "../src/shared/bookings/read-professional-checkout.js";
import { professionalHoldRequests } from "../src/shared/bookings/service-checkout-selection.js";

const BR = "America/Sao_Paulo", now = new Date("2029-01-01T00:00:00Z");

test("T112 native fixed booking dates and immutable paid history", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createProfessionalHttpFixture();
  let redis: Redis | undefined;
  try {
    const merchantId = f.owner.merchant_id, current = await f.prisma.serviceBusinessPolicy.findUnique({ where: { merchantId } });
    const policy = await f.request("/merchants/me/service-business-policy", { expectedVersion: current?.version ?? 0,
      paymentMode: "online", holdEnabled: false, admissionsEnabled: true }, f.owner, "PUT"); assert.equal(policy.status, 200, JSON.stringify(policy));
    const product = await f.prisma.product.create({ data: { merchantId, name: "Synthetic historical-zone consultation", type: "service", isActive: true,
      metadata: { serviceSchedule: { timeZone: BR, durationMinutes: 30, slots: [] } }, variants: { create: { sku: randomUUID(), isActive: true,
        price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
    // Persisted historical facts are seeded explicitly. They do not pass through
    // the new-record writers, and no body flag grants their authority.
    const professional = await f.prisma.serviceProfessional.create({ data: { merchantId, publicName: "Historical UTC professional",
      timeZone: "UTC", isActive: true, isPublished: true } });
    await f.prisma.professionalService.create({ data: { merchantId, professionalId: professional.id, productId: product.id } });
    await f.prisma.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ merchantId,
      professionalId: professional.id, weekday, startMinute: 0, endMinute: 120, timeZone: "UTC" })) });
    const scope = { merchantId, professionalId: professional.id, productId: product.id, variantId: product.variants[0].id };
    const selectionScope = { professionalId: scope.professionalId, productId: scope.productId, variantId: scope.variantId };
    const history = async () => ({ professional: await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: professional.id } }),
      rows: await f.prisma.professionalAvailability.findMany({ where: { professionalId: professional.id }, orderBy: { weekday: "asc" } }) });
    const beforeHistory = await history();
    await t.test("canonical SQL and authenticated calendar HTTP agree at the Brasilia date boundary", async () => {
      const input = { ...scope, fromDate: "2030-01-02", toDate: "2030-01-02", now };
      const direct = await f.prisma.$transaction(tx => getProfessionalAvailability(tx, input));
      const query = new URLSearchParams({ productId: scope.productId, variantId: scope.variantId, professionalId: scope.professionalId, date: input.fromDate });
      const http = await f.request(`/merchants/${merchantId}/service-availability/slots?${query}`, undefined, f.owner, "GET");
      assert.equal(http.status, 200, JSON.stringify(http)); assert.equal(http.body.timeZone, BR); assert.deepEqual(http.body.slots, direct.slots);
      assert.deepEqual(direct.slots.map(s => [s.date, s.startTime, s.startsAt]), [
        ["2030-01-02", "21:00", "2030-01-03T00:00:00.000Z"], ["2030-01-02", "21:30", "2030-01-03T00:30:00.000Z"],
        ["2030-01-02", "22:00", "2030-01-03T01:00:00.000Z"], ["2030-01-02", "22:30", "2030-01-03T01:30:00.000Z"],
      ]); assert.deepEqual(await history(), beforeHistory);
    });
    await t.test("new manual bookings use the returned Brasilia date and snapshot on a historical professional", async () => {
      const command = { commandId: randomUUID(), productId: scope.productId, variantId: scope.variantId, professionalId: scope.professionalId,
        expectedProfessionalVersion: professional.version, expectedPolicyVersion: policy.body.version,
        startsAt: "2030-01-04T01:00:00.000Z", customer: { kind: "contact", name: "Synthetic new manual buyer", email: "new-manual@example.test" } };
      const result = await f.request(`/merchants/${merchantId}/service-appointments/manual`, command, f.owner);
      assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.body.appointment.timeZone, BR);
      assert.equal(result.body.appointment.startsAt, command.startsAt); assert.equal(result.body.appointment.operationalStatus, "pending");
      const replay = await f.request(`/merchants/${merchantId}/service-appointments/manual`, command, f.owner);
      assert.equal(replay.status, 201); assert.equal(replay.body.appointment.id, result.body.appointment.id); assert.equal(replay.body.replayed, true);
      assert.deepEqual(await history(), beforeHistory);
    });
    const paid = async (suffix: string) => {
      const sessionId = "historical-zone-" + suffix, globalUserId = "historical-buyer-" + suffix, unitId = "unit-" + suffix;
      const selected = { ...selectionScope, professionalVersion: professional.version, policyVersion: policy.body.version,
        date: "2030-01-06", startsAt: "2030-01-06T01:00:00.000Z", endsAt: "2030-01-06T01:30:00.000Z", timeZone: "UTC",
        durationMinutes: 30, priceInCents: 5000, currency: "BRL", slotId: "" };
      selected.slotId = professionalSlotId(merchantId, selected);
      const identity = { merchantId, sessionId, globalUserId };
      await f.prisma.checkoutSession.create({ data: { ...identity, ...serviceCheckoutProvenance(identity, { serverChannel: "storefront" }),
        conversationId: sessionId, customer: { fullName: "Synthetic paid buyer", email: "paid-zone@example.test" },
        cart: { currency: "BRL", total: 50, items: [] }, createdAt: now, updatedAt: now } });
      const providerPaymentId = "local-captured-" + suffix;
      const intent = await f.prisma.paymentIntent.create({ data: { id: randomUUID(), merchantId, sessionId, idempotencyKey: randomUUID(), amountCents: 5000,
        approvedAmountCents: 5000, currency: "BRL", method: "pix", status: "approved", providerPaymentId } });
      const order = await f.prisma.completedOrder.create({ data: { id: randomUUID(), merchantId, sessionId, externalOrderId: providerPaymentId,
        currency: "BRL", orderTotal: 50, status: "approved", completedAt: now,
        lineItemsJson: [{ lineId: unitId, snapshotVersion: 2, sku: product.variants[0].sku, productType: "service", fulfillmentStrategy: "scheduled_service",
          quantity: 1, variantId: scope.variantId, unitPriceCents: 5000, schedule: selected }] } });
      return { selected, order, intent, globalUserId, unitId };
    };
    await t.test("accepted immutable UTC paid units retain their date zone identity and money, then replay without another appointment", async () => {
      const seed = await paid("accepted"), beforeOrder = await f.prisma.completedOrder.findUniqueOrThrow({ where: { id: seed.order.id } });
      const run = () => f.prisma.$transaction(tx => reserveProfessionalOrderUnit(tx, merchantId, seed.order.id, seed.unitId));
      const first = await run(), replay = await run(); assert.equal(first.appointment.timeZone, "UTC");
      assert.equal(first.appointment.startsAt.toISOString(), seed.selected.startsAt); assert.equal(first.appointment.priceInCents, 5000);
      assert.equal(replay.appointment.id, first.appointment.id); assert.equal(replay.replayed, true);
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: seed.order.id, orderUnitId: seed.unitId } }), 1);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { appointmentId: first.appointment.id } }), 1);
      assert.equal(await f.prisma.paymentIntent.count({ where: { sessionId: seed.order.sessionId } }), 1);
      assert.deepEqual(await f.prisma.completedOrder.findUniqueOrThrow({ where: { id: seed.order.id } }), beforeOrder);
      assert.deepEqual(await history(), beforeHistory);
    });
    await t.test("a proven historical pending manual payment retains SAME ID and original admission while its paid unit is promoted", async () => {
      const suffix = randomUUID(), sessionId = "pending-zone-" + suffix, unitId = "pending-unit-" + suffix;
      const selected = { ...selectionScope, professionalVersion: professional.version, policyVersion: policy.body.version,
        date: "2030-01-10", startsAt: "2030-01-10T01:00:00.000Z", endsAt: "2030-01-10T01:30:00.000Z", timeZone: "UTC",
        durationMinutes: 30, priceInCents: 5000, currency: "BRL", slotId: "" };
      selected.slotId = professionalSlotId(merchantId, selected);
      // These explicit SQL rows represent pre-change history. The real private
      // preparation writer below must establish the financial continuation.
      const appointment = await f.prisma.serviceAppointment.create({ data: { ...scope, startsAt: new Date(selected.startsAt), endsAt: new Date(selected.endsAt),
        timeZone: selected.timeZone, durationMinutes: 30, priceInCents: 5000, currency: "BRL", policyVersion: policy.body.version,
        policySnapshot: { paymentMode: "online", holdEnabled: false, holdMinutes: null }, origin: "manual", operationalStatus: "pending",
        customerSnapshot: { name: "Synthetic historical pending buyer", email: "pending-zone@example.test" },
        idempotencyKey: "historical-manual-" + suffix, requestFingerprint: createHash("sha256").update("historical-admission-" + suffix).digest("hex") } });
      const admission = await f.prisma.appointmentAudit.create({ data: { merchantId, appointmentId: appointment.id,
        commandId: appointment.idempotencyKey, version: 1, action: "manual_create", actorId: f.owner.user_id, origin: "manual", occurredAt: now,
        after: { admissionFingerprint: appointment.requestFingerprint, privateLease: noAppointmentLease({ resourceId: "professional:" + professional.id,
          slotId: selected.slotId, startsAt: selected.startsAt, endsAt: selected.endsAt }, "hold_off") } } });
      const identity = { merchantId, sessionId, globalUserId: "historical-independent-payer-" + suffix };
      await f.prisma.checkoutSession.create({ data: { ...identity, ...serviceCheckoutProvenance(identity, { serverChannel: "storefront" }),
        conversationId: sessionId, customer: { fullName: "Synthetic independent payer", email: "payer-zone@example.test" },
        cart: { currency: "BRL", total: 50, items: [{ sku: product.variants[0].sku, name: "Historical pending payment", product_id: product.id,
          variantId: scope.variantId, quantity: 1, price: 50, productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: selected }] },
        createdAt: now, updatedAt: now } });
      const intent = await f.prisma.paymentIntent.create({ data: { id: randomUUID(), merchantId, sessionId, idempotencyKey: randomUUID(), amountCents: 5000, currency: "BRL",
        method: "pix", status: "pending", creation: { state: "ready", input: { merchantId, sessionId, amountCents: 5000, currency: "BRL", method: "pix", providerIdempotencyKey: suffix } } } });
      const actor = { merchantId, userId: f.owner.user_id, role: "owner" }, command = { appointmentId: appointment.id, expectedVersion: 1,
        paymentIntentId: intent.id, unitId, commandId: "prepare-pending-" + suffix };
      const prepare = () => f.prisma.$transaction(tx => prepareManualServicePaymentWithin(tx, actor, command, { clock: () => now }));
      const linked = await prepare(); assert.equal((await prepare()).payment.id, linked.payment.id);
      const providerPaymentId = "local-pending-approved-" + suffix;
      await f.prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "approved", approvedAmountCents: 5000, providerPaymentId } });
      const order = await f.prisma.completedOrder.create({ data: { id: randomUUID(), merchantId, sessionId, externalOrderId: providerPaymentId, currency: "BRL",
        orderTotal: 50, status: "approved", completedAt: now, lineItemsJson: [{ lineId: unitId, snapshotVersion: 2, sku: product.variants[0].sku,
          productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1, variantId: scope.variantId, unitPriceCents: 5000, schedule: selected }] } });
      const promote = () => f.prisma.$transaction(tx => reserveProfessionalOrderUnit(tx, merchantId, order.id, unitId));
      const result = await promote(); assert.equal(result.appointment.id, appointment.id); assert.equal(result.appointment.operationalStatus, "scheduled");
      assert.equal(result.appointment.timeZone, "UTC"); assert.equal(result.appointment.requestFingerprint, appointment.requestFingerprint);
      assert.equal(result.appointment.startsAt.toISOString(), selected.startsAt); assert.deepEqual(result.appointment.customerSnapshot, appointment.customerSnapshot);
      assert.equal((await promote()).appointment.id, appointment.id); assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 1);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { appointmentId: appointment.id } }), 1);
      assert.deepEqual(await f.prisma.appointmentAudit.findUniqueOrThrow({ where: { id: admission.id } }), admission);
      assert.deepEqual(await history(), beforeHistory);
    });
    await t.test("public historical flags cannot reinterpret a new appointment date or authorize an old frozen selector", async () => {
      const command: ServiceAppointmentAdmissionInput = { ...scope, professionalVersion: professional.version, policyVersion: policy.body.version,
        date: "2030-01-08", startsAt: "2030-01-08T01:00:00.000Z", endsAt: "2030-01-08T01:30:00.000Z", priceInCents: 5000, currency: "BRL",
        customer: { name: "Synthetic forged caller", email: "forged-zone@example.test" }, origin: "storefront", actorId: "synthetic-caller",
        idempotencyKey: randomUUID(), confirmation: { kind: "pending" } };
      for (const extra of [{ legacy: true }, { timeZone: "UTC" }, { preservedTimeZone: "UTC", createdAt: "2000-01-01T00:00:00Z" }]) {
        await assert.rejects(f.prisma.$transaction(tx => admitServiceAppointment(tx, { ...command, ...extra }, { clock: () => now })), /service_slot_unavailable/);
        assert.equal(await f.prisma.serviceAppointment.count({ where: { idempotencyKey: command.idempotencyKey } }), 0);
        assert.equal(await f.prisma.appointmentAudit.count({ where: { commandId: command.idempotencyKey } }), 0);
        assert.equal(await f.prisma.outboxMessage.count({ where: { causationId: command.idempotencyKey } }), 0);
      }
      assert.deepEqual(await history(), beforeHistory);
    });
    await t.test("an exact persisted historical held selection is read without renewing, while old captured ABA and expiry are refused", async () => {
      redis = new Redis(f.runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
      await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), f.runtime.redis.runId);
      const store = new RedisServiceSlots(redis), sessionId = "held-zone-" + randomUUID();
      const changed = await f.request("/merchants/me/service-business-policy", { expectedVersion: policy.body.version,
        paymentMode: "online", holdEnabled: true, holdMinutes: 7, admissionsEnabled: true }, f.owner, "PUT"); assert.equal(changed.status, 200);
      const selected = { ...selectionScope, professionalVersion: professional.version, policyVersion: changed.body.version,
        date: "2030-01-12", startsAt: "2030-01-12T01:00:00.000Z", endsAt: "2030-01-12T01:30:00.000Z", timeZone: "UTC",
        durationMinutes: 30, priceInCents: 5000, currency: "BRL", slotId: "" }; selected.slotId = professionalSlotId(merchantId, selected);
      const cart = { currency: "BRL", total: 50, items: [{ sku: product.variants[0].sku, product_id: product.id, variantId: scope.variantId,
        name: "Historical held selection", price: 50, quantity: 1, productType: "service" as const, fulfillmentStrategy: "scheduled_service" as const, fulfillmentSchedule: selected }] };
      const persisted = await f.prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: "held-buyer", conversationId: sessionId,
        cart, customer: { fullName: "Synthetic held buyer", email: "held-zone@example.test" }, createdAt: now, updatedAt: now } });
      const original = originalSlotLeaseProof(await store.acquire(merchantId, sessionId, professionalHoldRequests([selected]), 420_000)); assert.ok(original);
      const held = () => f.prisma.$transaction(tx => readProfessionalCheckout(tx, { merchantId, sessionId, cart }, () => new Date(), { store: () => store }));
      const read = await held(); assert.deepEqual(read.selections, [selected]);
      const afterRead = await store.assertActive(merchantId, sessionId, professionalHoldRequests([selected]));
      assert.equal(afterRead.generation, original.generation); assert.equal(afterRead.expiresAt, original.expiresAt);
      assert.deepEqual(await f.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } }), persisted);
      await store.release(merchantId, sessionId);
      await assert.rejects(held(), /checkout_service_hold_expired/);
      const replacement = originalSlotLeaseProof(await store.acquire(merchantId, sessionId, professionalHoldRequests([selected]), 420_000)); assert.ok(replacement);
      assert.notEqual(replacement.generation, original.generation);
      const input: ServiceAppointmentAdmissionInput = { ...scope, professionalVersion: professional.version, policyVersion: changed.body.version,
        date: selected.date, startsAt: selected.startsAt, endsAt: selected.endsAt, priceInCents: 5000, currency: "BRL",
        customer: { name: "Synthetic held buyer", email: "held-zone@example.test" }, origin: "storefront", actorId: "held-buyer",
        idempotencyKey: "old-generation-" + sessionId, confirmation: { kind: "pending" } };
      await assert.rejects(f.prisma.$transaction(tx => admitServiceAppointment(tx, input, { leaseOwner: { ownerId: sessionId, store: () => store },
        leaseSelections: [selected], acquiredLeaseProof: original, capturedLeaseStore: () => store })), /service_manual_original_hold_required/);
      assert.equal(await f.prisma.serviceAppointment.count({ where: { idempotencyKey: input.idempotencyKey } }), 0);
      assert.equal(await f.prisma.appointmentAudit.count({ where: { commandId: input.idempotencyKey } }), 0);
      assert.equal(await f.prisma.paymentIntent.count({ where: { sessionId } }), 0);
      await store.release(merchantId, sessionId); assert.deepEqual(await history(), beforeHistory);
    });
  } finally { try { if (redis) await redis.quit(); } finally { await f.close(); } }
});
