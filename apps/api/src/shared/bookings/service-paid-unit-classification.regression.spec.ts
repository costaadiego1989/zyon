import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { admitServiceAppointment, type ServiceAppointmentAdmissionInput } from "./service-appointment-admission.service.js";
import { professionalSlotId } from "./service-checkout-selection.js";

// Component persistence facts only. Availability and private continuation run
// their real canonical implementations; the unchanged T26 native owns SQL proof.
const now = new Date("2030-01-01T09:00:00.000Z");
function fixture() {
  const input: ServiceAppointmentAdmissionInput = { merchantId: "merchant", productId: "service", variantId: "variant", professionalId: "professional",
    professionalVersion: 1, policyVersion: 2, date: "2030-01-09", startsAt: "2030-01-09T10:00:00.000Z", endsAt: "2030-01-09T10:20:00.000Z",
    priceInCents: 5000, currency: "BRL", buyerGlobalUserId: "buyer", customer: { name: "Synthetic buyer", email: "buyer@example.test" },
    actorId: "buyer", origin: "storefront", idempotencyKey: "paid-unit-regression", confirmation: { kind: "approved_order_unit", orderId: "order", unitId: "line_1" } };
  const schedule = { professionalId: input.professionalId, professionalVersion: 1, policyVersion: 2, date: input.date,
    startsAt: input.startsAt, endsAt: input.endsAt, timeZone: "UTC", durationMinutes: 20 };
  const order = { id: "order", merchantId: "merchant", status: "paid", sessionId: "session", externalOrderId: "provider", orderTotal: 50, currency: "BRL",
    lineItemsJson: [{ lineId: "line_1", snapshotVersion: 2, productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1,
      variantId: "variant", unitPriceCents: 5000, schedule }] };
  const payment = { id: "intent", status: "approved", amountCents: 5000, approvedAmountCents: 5000, currency: "BRL", providerPaymentId: "provider" };
  const professional = { id: "professional", merchantId: "merchant", publicName: "Professional", version: 1, isActive: true, isPublished: true, timeZone: "UTC" };
  const variant = { id: "variant", productId: "service", isActive: true, price: { basePriceInCents: 5000, currency: "BRL" } };
  const product = { id: "service", merchantId: "merchant", isActive: true, deletedAt: null, type: "service", categoryId: null, category: null,
    metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } }, variants: [variant] };
  const state = { missingProfessional: false, recurringRows: 7, canonicalLinkReads: 0, appointments: [] as any[], audits: [] as any[], events: [] as any[], manualRecords: undefined as any };
  const tx = {
    $queryRaw: async () => [{ id: "merchant" }],
    merchant: { findUnique: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }) },
    serviceBusinessPolicy: { findUnique: async () => ({ version: 2, configuredAt: now, admissionsEnabled: true, paymentMode: "online", holdEnabled: false, holdMinutes: null }) },
    serviceReservation: { findFirst: async () => null }, productVariant: { findFirst: async () => ({ ...variant, product }) },
    professionalService: { findFirst: async () => { state.canonicalLinkReads++; return state.missingProfessional ? null : {
      id: "link", merchantId: "merchant", professionalId: "professional", productId: "service", isActive: true, professional, product }; } },
    professionalAvailability: { findMany: async () => Array.from({ length: state.recurringRows }, (_, index) => ({ weekday: index % 7,
      startMinute: 600, endMinute: 720, timeZone: "UTC", validFrom: null, validUntil: null })) },
    availabilityException: { findMany: async () => [] },
    serviceAppointment: { findUnique: async () => null, findMany: async () => [], findFirst: async () => state.manualRecords?.appointment ?? null,
      create: async ({ data }: any) => { const row = { ...data, id: "created", version: 1 }; state.appointments.push(row); return row; } },
    appointmentAudit: { findMany: async () => state.manualRecords ? [state.manualRecords.receipt] : [], findFirst: async () => null,
      create: async ({ data }: any) => { state.audits.push(data); return data; } },
    appointmentPayment: { findFirst: async () => state.manualRecords?.financial ?? null },
    outboxMessage: { create: async ({ data }: any) => { state.events.push(data); return data; } },
    completedOrder: { findFirst: async () => order }, checkoutSession: { findUnique: async () => ({ globalUserId: "buyer" }) },
    paymentIntent: { findFirst: async () => payment },
  } as unknown as Prisma.TransactionClient;
  function manual() {
    input.origin = "manual"; input.actorId = "operator";
    const selected = { productId: input.productId, variantId: input.variantId, professionalId: input.professionalId, professionalVersion: 1, policyVersion: 2,
      date: input.date, startsAt: input.startsAt, endsAt: input.endsAt, timeZone: "UTC", durationMinutes: 20, priceInCents: 5000, currency: "BRL", slotId: "" };
    selected.slotId = professionalSlotId(input.merchantId, selected);
    const appointment = { ...selected, id: "manual", merchantId: "merchant", version: 1, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt),
      buyerGlobalUserId: "buyer", customerSnapshot: { ...input.customer }, origin: "manual", operationalStatus: "pending", orderId: null, orderUnitId: null,
      requestFingerprint: "manual-original", policySnapshot: { holdEnabled: false, holdMinutes: null, paymentMode: "online" } };
    const financial = { id: "financial", paymentIntentId: payment.id, appointmentId: appointment.id, mode: "online", status: "pending", receivedAt: null,
      requestFingerprint: "a".repeat(64), amountCents: 5000, currency: "BRL" };
    const proof = { schemaVersion: 1, merchantId: "merchant", appointmentId: appointment.id, appointmentVersion: 1, paymentIntentId: payment.id,
      sessionId: order.sessionId, unitId: "line_1", operatorId: "operator", paymentRecordId: financial.id, admissionFingerprint: appointment.requestFingerprint,
      requestFingerprint: financial.requestFingerprint, captureAuditId: null, selection: selected };
    state.manualRecords = { appointment, financial, receipt: { merchantId: "merchant", appointmentId: appointment.id, action: "manual_payment_prepare",
      actorId: "operator", version: 1, after: { privatePaymentContinuation: proof } } };
    return { pendingPaymentRecordId: financial.id };
  }
  const facts = () => structuredClone({ order, payment, manual: state.manualRecords });
  const noWrites = () => { assert.deepEqual(state.appointments, []); assert.deepEqual(state.audits, []); assert.deepEqual(state.events, []); };
  return { input, tx, schedule, order, payment, professional, product, state, manual, facts, noWrites };
}
const rejected = (work: Promise<unknown>, code: string, status = 409) => assert.rejects(work,
  error => error instanceof HttpException && error.getStatus() === status && error.message === code);

test("T40 paid unit classification preserves canonical historical continuation fences", async t => {
  for (const mismatch of ["timeZone", "durationMinutes"] as const) await t.test("wrong frozen paid " + mismatch + " is a financial unit mismatch with no writes", async () => {
    const f = fixture(); if (mismatch === "timeZone") f.schedule.timeZone = "Pacific/Tahiti"; else f.schedule.durationMinutes = 99;
    const before = f.facts(); await rejected(admitServiceAppointment(f.tx, f.input, { clock: () => now }), "service_payment_unit_mismatch");
    assert.ok(f.state.canonicalLinkReads > 0); f.noWrites(); assert.deepEqual(f.facts(), before);
  });
  await t.test("valid paid UTC history still uses its exact old civil contract and approved money", async () => {
    const f = fixture(), before = f.facts(), result = await admitServiceAppointment(f.tx, f.input, { clock: () => now });
    assert.equal(result.appointment.timeZone, "UTC"); assert.equal(result.appointment.durationMinutes, 20); assert.equal(result.appointment.operationalStatus, "scheduled");
    assert.equal(result.appointment.orderId, "order"); assert.equal(result.appointment.orderUnitId, "line_1");
    assert.equal(f.state.appointments.length, 1); assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1); assert.deepEqual(f.facts(), before);
  });
  await t.test("a real missing professional error from canonical availability keeps its original code", async () => {
    const f = fixture(); f.state.missingProfessional = true; const before = f.facts();
    await rejected(admitServiceAppointment(f.tx, f.input, { clock: () => now }), "professional_service_not_found", 404); f.noWrites(); assert.deepEqual(f.facts(), before);
  });
  await t.test("real availability source exhaustion remains unavailable rather than financial mismatch", async () => {
    const f = fixture(); f.state.recurringRows = 101; const before = f.facts();
    await rejected(admitServiceAppointment(f.tx, f.input, { clock: () => now }), "availability_source_limit", 503); f.noWrites(); assert.deepEqual(f.facts(), before);
  });
  await t.test("real changed professional version keeps the stale-selection error", async () => {
    const f = fixture(); f.professional.version = 2; const before = f.facts();
    await rejected(admitServiceAppointment(f.tx, f.input, { clock: () => now }), "service_selection_stale"); f.noWrites(); assert.deepEqual(f.facts(), before);
  });
  await t.test("private stored manual continuation keeps the original timezone conflict and original records", async () => {
    const f = fixture(), context = f.manual(); f.product.metadata.serviceSchedule.durationMinutes = 30; const before = f.facts();
    await rejected(admitServiceAppointment(f.tx, f.input, { clock: () => now, ...context }), "service_timezone_continuation_conflict");
    assert.ok(f.state.canonicalLinkReads > 0); f.noWrites(); assert.deepEqual(f.facts(), before);
  });
  await t.test("an unrelated Error with the same text retains exact identity through the existing internal seam", async () => {
    const f = fixture(), fault = Error("service_timezone_continuation_conflict"), before = f.facts();
    await assert.rejects(admitServiceAppointment(f.tx, f.input, { clock: () => now, readAvailability: async () => { throw fault; } }), error => error === fault);
    f.noWrites(); assert.deepEqual(f.facts(), before);
  });
});
