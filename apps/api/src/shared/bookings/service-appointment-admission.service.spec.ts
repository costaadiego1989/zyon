import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, ServiceAppointment } from "@prisma/client";
import { admitServiceAppointment, type ServiceAppointmentAdmissionInput } from "./service-appointment-admission.service.js";
import type { ServiceBusinessPolicyInput } from "../../modules/merchant/domain/service-business-policy.js";

const now = new Date("2030-01-01T09:00:00Z");
const selection: ServiceAppointmentAdmissionInput = {
  merchantId: "services", professionalId: "professional", productId: "consultation", variantId: "consultation-variant",
  date: "2030-01-02", startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T10:30:00.000Z",
  professionalVersion: 3, policyVersion: 2, priceInCents: 5000, currency: "BRL",
  customer: { name: "Synthetic buyer", phone: "+5521999990000" }, buyerGlobalUserId: "synthetic-buyer",
  origin: "whatsapp", actorId: "synthetic-buyer", idempotencyKey: "confirm-first", confirmation: { kind: "at_attendance" },
};

// Unit storage asserts the component's resulting records. Transactional
// concurrency, rollback and SQL constraints are covered by the native companion.
function fixture() {
  const appointments: ServiceAppointment[] = [], audits: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [];
  const merchant = { businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false };
  const policy: NonNullable<ServiceBusinessPolicyInput["policy"]> = { admissionsEnabled: true, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", version: 2, configuredAt: now };
  const price = { basePriceInCents: 5000, currency: "BRL" };
  let unavailable = false, unclassified = false;
  const tx = {
    $queryRaw: async () => [{ id: "services" }],
    merchant: { findUnique: async () => merchant },
    serviceBusinessPolicy: { findUnique: async () => policy },
    serviceReservation: { findFirst: async () => unclassified ? { id: "synthetic-unclassified-reservation" } : null },
    productVariant: { findFirst: async () => ({ id: selection.variantId, productId: selection.productId, price,
      product: { id: selection.productId, merchantId: selection.merchantId, type: "service", isActive: true, deletedAt: null } }) },
    serviceAppointment: {
      findUnique: async ({ where }: { where: { merchantId_idempotencyKey: { merchantId: string; idempotencyKey: string } } }) =>
        appointments.find(row => row.merchantId === where.merchantId_idempotencyKey.merchantId && row.idempotencyKey === where.merchantId_idempotencyKey.idempotencyKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, id: "appointment-" + (appointments.length + 1), version: 1 } as unknown as ServiceAppointment;
        appointments.push(record); return record;
      },
    },
    appointmentAudit: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; } },
    outboxMessage: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const readAvailability = async () => ({ status: unavailable ? "empty" as const : "ready" as const,
    professionalVersion: 3, policyVersion: 2, timeZone: "UTC", durationMinutes: 30, dates: [selection.date], asOf: now.toISOString(),
    slots: unavailable ? [] : [{ date: selection.date, startTime: "10:00", startsAt: selection.startsAt, endsAt: selection.endsAt, timeZone: "UTC", durationMinutes: 30 }],
  });
  return { tx, appointments, audits, events, merchant, policy, price, readAvailability,
    unavailable: () => { unavailable = true; }, unclassified: () => { unclassified = true; } };
}

function paidFixture() {
  const f = fixture(); f.policy.paymentMode = "online";
  const schedule = { professionalId: selection.professionalId, professionalVersion: selection.professionalVersion,
    policyVersion: selection.policyVersion, date: selection.date, startsAt: selection.startsAt, endsAt: selection.endsAt,
    timeZone: "UTC", durationMinutes: 30 };
  const order = { id: "synthetic-approved-order", status: "paid", sessionId: "synthetic-paid-session", externalOrderId: "synthetic-provider-id", orderTotal: 50, currency: "BRL",
    lineItemsJson: [{ lineId: "line_1", snapshotVersion: 2, productType: "service", quantity: 1, fulfillmentStrategy: "scheduled_service", variantId: selection.variantId, unitPriceCents: 5000, schedule }] };
  const payment = { status: "approved", approvedAmountCents: 5000, amountCents: 5000, currency: "BRL", providerPaymentId: order.externalOrderId };
  Object.assign(f.tx, { completedOrder: { findFirst: async () => order }, checkoutSession: { findUnique: async () => ({ globalUserId: selection.buyerGlobalUserId }) }, paymentIntent: { findFirst: async () => payment } });
  const input: ServiceAppointmentAdmissionInput = { ...selection, confirmation: { kind: "approved_order_unit", orderId: order.id, unitId: "line_1" } };
  return { ...f, order, payment, schedule, input };
}

test("T26", async t => {
  await t.test("matching approved order evidence preserves the canonical financial and appointment snapshot", async () => {
    const f = paidFixture(), result = await admitServiceAppointment(f.tx, f.input, { clock: () => now, readAvailability: f.readAvailability });
    assert.equal(result.appointment.operationalStatus, "scheduled"); assert.equal(result.appointment.orderId, f.order.id); assert.equal(result.appointment.orderUnitId, "line_1");
    assert.equal(result.appointment.currency, "BRL"); assert.equal(result.appointment.priceInCents, 5000); assert.equal(result.appointment.timeZone, "UTC"); assert.equal(result.appointment.durationMinutes, 30);
    assert.equal(f.audits.length, 1); assert.equal(f.events.length, 1);
  });
  for (const mismatch of ["currency", "timeZone", "durationMinutes"] as const) {
    await t.test("approved evidence with a different " + mismatch + " cannot back the canonical appointment", async () => {
      const f = paidFixture();
      if (mismatch === "currency") { f.order.currency = "USD"; f.payment.currency = "USD"; }
      if (mismatch === "timeZone") f.schedule.timeZone = "Pacific/Tahiti";
      if (mismatch === "durationMinutes") f.schedule.durationMinutes = 99;
      await assert.rejects(admitServiceAppointment(f.tx, f.input, { clock: () => now, readAvailability: f.readAvailability }),
        mismatch === "currency" ? /service_payment_evidence_invalid/ : /service_payment_unit_mismatch/);
      assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []);
    });
  }
  await t.test("a root Prisma client is refused before any admission writes", async () => {
    const f = fixture(), root = Object.assign(f.tx, { $transaction: async () => assert.fail("admission must not open a nested transaction") });
    await assert.rejects(admitServiceAppointment(root, selection, { clock: () => now, readAvailability: f.readAvailability }), /service_appointment_transaction_required/);
    assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []);
  });
  await t.test("the decision clock is captured after both locks and shared by capacity and durable effects", async () => {
    const f = fixture(), fresh = new Date("2030-01-01T09:01:00Z");
    let locks = 0, clockCalls = 0, current = now, capacityNow: Date | undefined;
    f.tx.$queryRaw = (async () => { if (++locks === 2) current = fresh; return [{ id: "services" }]; }) as typeof f.tx.$queryRaw;
    const context = { now, clock: () => { assert.equal(locks, 2); clockCalls++; return current; },
      readAvailability: async (_tx: Prisma.TransactionClient, input: { now: Date }) => { capacityNow = input.now; return f.readAvailability(); } };
    const result = await admitServiceAppointment(f.tx, selection, context);
    assert.equal(clockCalls, 2);
    assert.equal(capacityNow?.toISOString(), fresh.toISOString());
    assert.equal(result.appointment.confirmedAt?.toISOString(), fresh.toISOString());
    assert.equal((f.audits[0].occurredAt as Date).toISOString(), fresh.toISOString());
    assert.equal((f.events[0].occurredAt as Date).toISOString(), fresh.toISOString());
  });
  await t.test("crossing the selected start while acquiring locks leaves no appointment audit or event", async () => {
    const f = fixture(); let locks = 0, current = now;
    f.tx.$queryRaw = (async () => { if (++locks === 2) current = new Date(selection.startsAt); return [{ id: "services" }]; }) as typeof f.tx.$queryRaw;
    const context = { now, clock: () => current, readAvailability: f.readAvailability };
    await assert.rejects(admitServiceAppointment(f.tx, selection, context), /service_slot_unavailable/);
    assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []);
  });
  await t.test("invalid customer JSON cannot create appointment, audit or event records", async () => {
    for (const [field, value] of [["phone", { number: "synthetic" }], ["email", ["buyer@example.test"]],
      ["name", "x".repeat(201)], ["phone", "1"], ["email", "not-an-email"]] as const) {
      const f = fixture(), customer = { ...selection.customer };
      Reflect.set(customer, field, value);
      await assert.rejects(admitServiceAppointment(f.tx, { ...selection, customer }, { clock: () => now, readAvailability: f.readAvailability }), /service_appointment_invalid_customer/);
      assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []);
    }
  });
  await t.test("canonical customer fields are trimmed without guessing a country code", async () => {
    const f = fixture();
    const result = await admitServiceAppointment(f.tx, { ...selection, customer: { name: " Synthetic buyer ", email: " Buyer@Example.test " } }, { clock: () => now, readAvailability: f.readAvailability });
    assert.deepEqual(result.appointment.customerSnapshot, { name: "Synthetic buyer", email: "buyer@example.test" });
    assert.equal(JSON.stringify(f.events).includes("buyer@example.test"), false);
  });
  await t.test("snapshots canonical values and records one audited event without a paid claim", async () => {
    const f = fixture();
    const result = await admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability });
    assert.equal(result.replayed, false);
    assert.equal(result.appointment.operationalStatus, "scheduled");
    assert.equal(result.appointment.professionalId, "professional");
    assert.equal(result.appointment.productId, "consultation");
    assert.equal(result.appointment.variantId, "consultation-variant");
    assert.equal(result.appointment.priceInCents, 5000);
    assert.equal(result.appointment.currency, "BRL");
    assert.equal(result.appointment.durationMinutes, 30);
    assert.equal(result.appointment.timeZone, "UTC");
    assert.equal(result.appointment.policyVersion, 2);
    assert.deepEqual(result.appointment.policySnapshot, { holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance" });
    assert.deepEqual(result.appointment.customerSnapshot, selection.customer);
    assert.equal(result.appointment.confirmedAt?.toISOString(), now.toISOString());
    assert.equal(f.audits.length, 1);
    assert.equal(f.audits[0].appointmentId, result.appointment.id);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].eventType, "service.appointment.scheduled");
    assert.deepEqual(f.events[0].payload, { appointmentId: result.appointment.id, version: 1, operationalStatus: "scheduled" });
    assert.equal(JSON.stringify(f.events).includes(selection.customer.phone!), false);
  });
  await t.test("same command replays the original snapshot even after admission is disabled", async () => {
    const f = fixture();
    const first = await admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability });
    f.policy.admissionsEnabled = false;
    const again = await admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability });
    assert.equal(again.replayed, true);
    assert.deepEqual(again.appointment, first.appointment);
    assert.equal(f.appointments.length, 1); assert.equal(f.audits.length, 1); assert.equal(f.events.length, 1);
  });
  await t.test("unclassified legacy capacity blocks new admission without disabling an existing replay", async () => {
    const f = fixture(); f.unclassified();
    await assert.rejects(admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability }), /service_legacy_classification_required/);
    assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []);
    const g = fixture(), first = await admitServiceAppointment(g.tx, selection, { clock: () => now, readAvailability: g.readAvailability });
    g.unclassified();
    const replay = await admitServiceAppointment(g.tx, selection, { clock: () => now, readAvailability: g.readAvailability });
    assert.equal(replay.replayed, true); assert.deepEqual(replay.appointment, first.appointment);
    assert.equal(g.appointments.length, 1); assert.equal(g.audits.length, 1); assert.equal(g.events.length, 1);
  });
  await t.test("same key cannot select a different slot or customer", async () => {
    const f = fixture();
    await admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability });
    for (const changed of [{ ...selection, startsAt: "2030-01-02T10:15:00.000Z" },
      { ...selection, buyerGlobalUserId: "other-buyer" }]) {
      await assert.rejects(admitServiceAppointment(f.tx, changed, { clock: () => now, readAvailability: f.readAvailability }), /service_appointment_idempotency_conflict/);
    }
    assert.equal(f.appointments.length, 1); assert.equal(f.audits.length, 1); assert.equal(f.events.length, 1);
  });
  await t.test("products, unconfigured policy, changed policy and changed price leave no side effects", async () => {
    for (const change of ["products", "unconfigured", "policy", "price"] as const) {
      const f = fixture();
      if (change === "products") f.merchant.businessMode = "products";
      if (change === "unconfigured") f.policy.configuredAt = null;
      if (change === "policy") f.policy.version = 3;
      if (change === "price") f.price.basePriceInCents = 5500;
      await assert.rejects(admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability }));
      assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []);
    }
  });
  await t.test("unavailable or stale professional selection never confirms a different slot", async () => {
    const f = fixture(); f.unavailable();
    await assert.rejects(admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability }), /service_slot_unavailable/);
    const g = fixture();
    await assert.rejects(admitServiceAppointment(g.tx, { ...selection, professionalVersion: 2 }, { clock: () => now, readAvailability: g.readAvailability }), /service_selection_stale/);
    assert.deepEqual(f.appointments, []); assert.deepEqual(g.appointments, []);
    assert.deepEqual(f.events, []); assert.deepEqual(g.events, []);
  });
  await t.test("pending online attempt does not claim confirmed capacity or payment", async () => {
    const f = fixture(); f.policy.paymentMode = "online";
    const result = await admitServiceAppointment(f.tx, { ...selection, confirmation: { kind: "pending" } }, { clock: () => now, readAvailability: f.readAvailability });
    assert.equal(result.appointment.operationalStatus, "pending");
    assert.equal(result.appointment.confirmedAt, null);
    assert.equal(f.events[0].eventType, "service.appointment.pending");
    assert.deepEqual(f.events[0].payload, { appointmentId: result.appointment.id, version: 1, operationalStatus: "pending" });
    assert.deepEqual(f.audits[0].after, { operationalStatus: "pending", policyVersion: 2, priceInCents: 5000, currency: "BRL" });
  });
  await t.test("online policy cannot use a local-payment confirmation", async () => {
    const f = fixture(); f.policy.paymentMode = "online";
    await assert.rejects(admitServiceAppointment(f.tx, selection, { clock: () => now, readAvailability: f.readAvailability }), /service_payment_policy_conflict/);
    assert.deepEqual(f.appointments, []); assert.deepEqual(f.audits, []); assert.deepEqual(f.events, []);
  });
});
