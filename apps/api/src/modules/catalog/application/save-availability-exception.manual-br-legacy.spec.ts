import assert from "node:assert/strict";
import { modeledUnitServiceRelease } from "../../../../tests/service-release-modeled-unit.fixture.mjs";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { saveAvailabilityException } from "./save-availability-exception.use-case.js";
import { createManualServiceAppointmentWithin } from "../../operations/application/create-manual-service-appointment.use-case.js";

// Component facts only; the actual T22/T23/T26/T30/T31 functions execute.
// This is not native SQL rollback, HTTP admission or provider evidence.
const actor = { merchantId: "merchant", userId: "owner", role: "owner" }, now = new Date("2030-01-01T09:00:00Z");
const interval = { kind: "one_off" as const, startsAt: "2030-01-02T14:00:00.000Z", endsAt: "2030-01-02T14:30:00.000Z" };
function fixture() {
  const professional = { id: "professional", merchantId: "merchant", publicName: "Legacy professional", timeZone: "UTC", version: 3, isActive: true, isPublished: true };
  const variant = { id: "variant", productId: "service", isActive: true, price: { basePriceInCents: 5000, currency: "BRL" } };
  const product = { id: "service", merchantId: "merchant", type: "service", isActive: true, deletedAt: null, categoryId: null, category: null,
    metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 30, slots: [] } }, variants: [variant] };
  const state = { exceptions: [] as any[], appointments: [] as any[], audits: [] as any[], events: [] as any[], payments: [] as any[], occupied: false };
  const matches = (row: any, where: any) => (!where.id || row.id === where.id) && (!where.merchantId || row.merchantId === where.merchantId)
    && (!where.professionalId || row.professionalId === where.professionalId) && (!where.kind || row.kind === where.kind) && (!where.isActive || row.isActive);
  const decorated = (row: any) => row ? { ...row, payments: state.payments.filter(payment => payment.appointmentId === row.id) } : null;
  const forbidden = async () => assert.fail("no PSP, order or physical-stock writer belongs to this manual attendance flow");
  const tx = {
    $queryRaw: async () => [{ id: "resource" }],
    merchant: { findUnique: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }) },
    serviceBusinessPolicy: { findUnique: async () => ({ admissionsEnabled: true, configuredAt: now, version: 2, paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null }) },
    serviceReservation: { findFirst: async () => null },
    serviceProfessional: { findFirst: async () => professional, updateMany: async ({ where }: any) => {
      if (where.id !== professional.id || where.merchantId !== professional.merchantId || where.version !== professional.version) return { count: 0 };
      professional.version++; return { count: 1 }; } },
    professionalService: { findFirst: async () => ({ id: "link", merchantId: "merchant", professionalId: "professional", productId: "service", isActive: true, professional, product }) },
    productVariant: { findFirst: async () => ({ ...variant, product }) }, professionalAvailability: { findMany: async () => [] },
    availabilityException: {
      findFirst: async ({ where }: any) => state.exceptions.find(row => matches(row, where)) ?? null,
      findMany: async () => state.exceptions.filter(row => row.isActive),
      create: async ({ data }: any) => { const row = { ...data, id: "exception-" + (state.exceptions.length + 1), version: 1 }; state.exceptions.push(row); return row; },
      update: async ({ where, data }: any) => { const row = state.exceptions.find(value => matches(value, where)); assert.ok(row);
        Object.assign(row, { ...data, version: row.version + 1 }); return row; },
    },
    serviceAppointment: {
      findUnique: async ({ where }: any) => state.appointments.find(row => row.merchantId === where.merchantId_idempotencyKey.merchantId && row.idempotencyKey === where.merchantId_idempotencyKey.idempotencyKey) ?? null,
      findMany: async () => state.appointments,
      findFirst: async ({ where }: any) => where.operationalStatus ? state.occupied ? { id: "occupied" } : null : decorated(state.appointments.find(row => matches(row, where))),
      create: async ({ data }: any) => { const row = { ...data, id: "appointment", version: 1, availabilityExceptionId: null }; state.appointments.push(row); return row; },
      update: async ({ where, data }: any) => { const row = state.appointments.find(value => matches(value, where)); assert.ok(row); Object.assign(row, data); return decorated(row); },
    },
    appointmentAudit: {
      findUnique: async ({ where }: any) => state.audits.find(row => row.merchantId === where.merchantId_commandId.merchantId && row.commandId === where.merchantId_commandId.commandId) ?? null,
      create: async ({ data }: any) => { state.audits.push(data); return data; },
      update: async ({ where, data }: any) => { const row = state.audits.find(value => value.merchantId === where.merchantId_commandId.merchantId && value.commandId === where.merchantId_commandId.commandId); assert.ok(row); Object.assign(row, data); return row; },
    },
    appointmentPayment: { findUnique: async ({ where }: any) => state.payments.find(row => row.merchantId === where.merchantId_idempotencyKey.merchantId && row.idempotencyKey === where.merchantId_idempotencyKey.idempotencyKey) ?? null,
      create: async ({ data }: any) => { const row = { ...data, id: "local-payment" }; state.payments.push(row); return row; } },
    outboxMessage: { create: async ({ data }: any) => { state.events.push(data); return data; } },
    paymentIntent: { create: forbidden }, completedOrder: { create: forbidden }, inventoryMovement: { create: forbidden }, productStock: { update: forbidden, updateMany: forbidden },
  } as unknown as Prisma.TransactionClient;
  const snapshot = () => structuredClone({ professional, state });
  const command = { commandId: "manual-br", productId: "service", variantId: "variant", professionalId: "professional", expectedProfessionalVersion: 3,
    expectedPolicyVersion: 2, startsAt: interval.startsAt, customer: { kind: "contact" as const, name: "Synthetic buyer", email: "buyer@example.test" }, explicitOneOff: { reason: "Owned manual interval" } };
  return { tx, professional, state, snapshot, command };
}

const originalFixture = fixture;
function modeledFixture(context: { after: (callback: () => void) => unknown }, ...args: Parameters<typeof originalFixture>) {
  const f = originalFixture(...args), modeledLedger = modeledUnitServiceRelease(context);
  f.tx.$queryRaw = modeledLedger.wrapQueryRaw(f.tx.$queryRaw) as typeof f.tx.$queryRaw;
  return Object.assign(f, { modeledLedger });
}

test("T40 focused manual Brasilia interval on a legacy professional uses the coupled canonical writer", async t => {
  await t.test("real manual command creates its BR one-off, canonical appointment and pending local balance while preserving the old professional zone", async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    const f = fixture(), made = await createManualServiceAppointmentWithin(f.tx, actor, f.command, { clock: () => now });
    assert.equal(made.appointment.timeZone, "America/Sao_Paulo"); assert.equal(made.appointment.startsAt.toISOString(), interval.startsAt);
    assert.equal(made.appointment.endsAt.toISOString(), interval.endsAt); assert.equal(made.appointment.operationalStatus, "scheduled");
    assert.equal(f.professional.timeZone, "UTC"); assert.equal(f.professional.version, 4); assert.equal(f.state.exceptions.length, 1);
    assert.equal(f.state.exceptions[0].timeZone, "America/Sao_Paulo"); assert.equal(made.availabilityExceptionId, f.state.exceptions[0].id);
    assert.equal(f.state.appointments.length, 1); assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1);
    assert.equal(f.state.payments.length, 1); assert.equal(f.state.payments[0].status, "pending"); assert.equal(f.state.payments[0].amountCents, 5000);
    const before = f.snapshot(), replay = await createManualServiceAppointmentWithin(f.tx, actor, f.command, { clock: () => now });
    assert.equal(replay.replayed, true); assert.equal(replay.appointment.id, made.appointment.id); assert.deepEqual(f.snapshot(), before);
  });
  await t.test("an omitted new interval zone defaults to BR without rewriting the legacy professional", async () => {
    const f = fixture(), result = await saveAvailabilityException(f.tx, actor, "professional", 3, interval);
    assert.equal(result.exception.timeZone, "America/Sao_Paulo"); assert.equal(f.professional.timeZone, "UTC"); assert.equal(result.version, 4);
  });
  await t.test("new non-BR intervals cannot use a legacy professional zone to bypass fixed new-write policy", async () => {
    const f = fixture(), before = f.snapshot(); await assert.rejects(saveAvailabilityException(f.tx, actor, "professional", 3, { ...interval, timeZone: "UTC" }), /new_service_timezone_must_be_brasilia/);
    assert.deepEqual(f.snapshot(), before);
  });
  await t.test("a real occupied interval still refuses the BR one-off before any writes", async () => {
    const f = fixture(); f.state.occupied = true; const before = f.snapshot();
    await assert.rejects(saveAvailabilityException(f.tx, actor, "professional", 3, { ...interval, timeZone: "America/Sao_Paulo" }), /availability_appointment_conflict/); assert.deepEqual(f.snapshot(), before);
  });
  await t.test("withdrawal preserves exact historical UTC instants and reason even when the new envelope defaults to BR", async () => {
    const f = fixture(), row = { id: "historical", merchantId: "merchant", professionalId: "professional", kind: "block", startsAt: new Date("2030-01-02T13:00:30.123Z"),
      endsAt: new Date("2030-01-02T13:30:30.123Z"), timeZone: "UTC", reason: "Historical reason", actorId: "old-actor", isActive: true, version: 2 };
    f.state.exceptions.push(row); const before = structuredClone(row);
    const result = await saveAvailabilityException(f.tx, actor, "professional", 3, { id: row.id, kind: "block", startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), isActive: false, reason: "Must not replace" });
    assert.deepEqual(result.exception, { ...before, actorId: actor.userId, isActive: false, version: 3 }); assert.equal(f.professional.timeZone, "UTC");
  });
  await t.test("professional version fence remains ahead of BR exception writes", async () => {
    const f = fixture(), before = f.snapshot(); await assert.rejects(saveAvailabilityException(f.tx, actor, "professional", 2, { ...interval, timeZone: "America/Sao_Paulo" }), /service_professional_stale/); assert.deepEqual(f.snapshot(), before);
  });
});
