import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getProfessionalAvailability } from "./get-professional-availability.js";

function fixture() {
  const date = "2030-01-02", now = new Date("2030-01-01T09:00Z");
  const own: any = { id: "own", merchantId: "m", professionalId: "p", productId: "service", variantId: "variant",
    version: 3, operationalStatus: "scheduled", startsAt: new Date(date + "T10:00Z"), endsAt: new Date(date + "T10:20Z") };
  const other = { ...own, id: "other", startsAt: new Date(date + "T10:40Z"), endsAt: new Date(date + "T11:00Z") };
  let sourceReads = 0;
  const tx = {
    professionalService: { findFirst: async () => ({ id: "link", merchantId: "m", professionalId: "p", productId: "service", isActive: true,
      professional: { id: "p", merchantId: "m", isActive: true, isPublished: true, timeZone: "UTC", version: 4 },
      product: { id: "service", merchantId: "m", isActive: true, deletedAt: null, type: "service", categoryId: null, category: null,
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 30, slots: [] } },
        variants: [{ id: "variant", productId: "service", isActive: true, price: { basePriceInCents: 5000, currency: "BRL" } }] } }) },
    serviceBusinessPolicy: { findUnique: async () => ({ version: 2, configuredAt: now }) },
    professionalAvailability: { findMany: async () => { sourceReads++; return Array.from({ length: 7 }, (_, weekday) => ({ weekday,
      startMinute: 600, endMinute: 720, timeZone: "UTC", validFrom: null, validUntil: null })); } },
    availabilityException: { findMany: async () => [] },
    serviceAppointment: {
      findFirst: async ({ where }: any) => where.id === own.id && where.merchantId === own.merchantId && where.version === own.version
        && where.productId === own.productId && where.variantId === own.variantId && where.operationalStatus.in.includes(own.operationalStatus) ? own : null,
      findMany: async ({ where }: any) => [own, other].filter(a => a.merchantId === where.merchantId && a.professionalId === where.professionalId
        && where.operationalStatus.in.includes(a.operationalStatus) && a.id !== where.NOT?.id),
    },
  } as unknown as Prisma.TransactionClient;
  const input = { merchantId: "m", professionalId: "p", productId: "service", variantId: "variant", expectedVersion: 4,
    fromDate: date, toDate: date, now };
  return { tx, input, own, get sourceReads() { return sourceReads; } };
}

test("T34 exact private own-appointment availability exclusion", async t => {
  await t.test("ordinary reads retain occupied origin and another appointment", async () => {
    const f = fixture(), result = await getProfessionalAvailability(f.tx, f.input);
    assert.equal(result.slots.some(s => s.startsAt === "2030-01-02T10:00:00.000Z"), false);
    assert.equal(result.slots.some(s => s.startsAt === "2030-01-02T10:30:00.000Z"), false);
  });
  await t.test("trusted exact id/version permits own changed duration while retaining other capacity", async () => {
    const f = fixture(), result = await getProfessionalAvailability(f.tx, f.input, { excludeAppointment: { appointmentId: "own", expectedVersion: 3 } });
    assert.equal(result.slots.some(s => s.startsAt === "2030-01-02T10:00:00.000Z"), true);
    assert.equal(result.slots.some(s => s.startsAt === "2030-01-02T10:30:00.000Z"), false);
  });
  await t.test("foreign stale and different selected product identity never grant an exclusion", async () => {
    for (const changed of [{ merchantId: "foreign" }, { version: 4 }, { productId: "other-service" }, { variantId: "other-variant" }]) {
      const f = fixture(); Object.assign(f.own, changed);
      await assert.rejects(getProfessionalAvailability(f.tx, f.input, { excludeAppointment: { appointmentId: "own", expectedVersion: 3 } }), /service_appointment_exclusion_conflict/);
      assert.equal(f.sourceReads, 0);
    }
  });
  await t.test("terminal attendance and forged other row cannot be hidden", async () => {
    const terminal = fixture(); terminal.own.operationalStatus = "completed";
    await assert.rejects(getProfessionalAvailability(terminal.tx, terminal.input, { excludeAppointment: { appointmentId: "own", expectedVersion: 3 } }), /service_appointment_exclusion_conflict/);
    const other = fixture(); await assert.rejects(getProfessionalAvailability(other.tx, other.input,
      { excludeAppointment: { appointmentId: "different", expectedVersion: 3 } }), /service_appointment_exclusion_conflict/);
  });
});
