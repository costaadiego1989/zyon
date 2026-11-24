import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { FIXED_SERVICE_TIME_ZONE, assertNewServiceTimeZone, defaultNewServiceTimeZone } from "./fixed-service-time-zone.js";
import { validateProfessionalInput } from "./service-professional-input.js";
import { validateRecurringAvailability } from "./professional-availability-input.js";
import { SaveProfessionalAvailabilityUseCase } from "../../application/save-professional-availability.use-case.js";
import { saveAvailabilityException, validateAvailabilityException } from "../../application/save-availability-exception.use-case.js";
import { PrismaServiceProfessionalRepository } from "../../infrastructure/repositories/prisma-service-professional.repository.js";

const actor = { merchantId: "merchant", userId: "operator", role: "owner" };
const interval = { kind: "one_off" as const, startsAt: "2030-01-02T13:00:00Z", endsAt: "2030-01-02T13:30:00Z" };
function fixture(timeZone: string = FIXED_SERVICE_TIME_ZONE, before: Record<string, unknown> | null = null) {
  const profile = { id: "professional", merchantId: actor.merchantId, timeZone, isActive: true, version: 5 };
  const writes: Array<Record<string, unknown>> = [], reads: string[] = [];
  let occupied = false;
  const tx = {
    $queryRaw: async () => { reads.push("lock"); return [{ id: "resource" }]; },
    merchant: { findUnique: async () => { reads.push("auth"); return { businessMode: "services", businessModeSelectedAt: new Date("2020-01-01T00:00:00Z"), businessModeNeedsReview: false }; } },
    product: { count: async () => 0 },
    serviceProfessional: { findFirst: async () => { reads.push("profile"); return profile; },
      create: async (input: Record<string, unknown>) => { writes.push(input); throw Error("unexpected_professional_write"); },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
    professionalAvailability: { updateMany: async (input: Record<string, unknown>) => { writes.push(input); throw Error("unexpected_grade_write"); } },
    serviceAppointment: { findFirst: async () => occupied ? { id: "confirmed-appointment" } : null },
    availabilityException: {
      findFirst: async ({ where }: { where: { id?: unknown } }) => typeof where.id === "string" ? before : null,
      create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { id: "new-exception", ...data }; },
      update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { ...before, ...data, version: Number(before!.version) + 1 }; },
    },
  };
  const prisma = { $transaction: async (work: (value: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
  return { tx: tx as unknown as Prisma.TransactionClient, prisma, profile, writes, reads, occupy: () => { occupied = true; } };
}

test("T111 fixed zone policy and actual writers", async t => {
  await t.test("omitted new zone becomes Brasilia without mutating its caller", () => {
    const raw = { publicName: "New professional" }, normalized = defaultNewServiceTimeZone(raw);
    assert.deepEqual(normalized, { ...raw, timeZone: "America/Sao_Paulo" }); assert.deepEqual(raw, { publicName: "New professional" });
    assert.equal(assertNewServiceTimeZone(FIXED_SERVICE_TIME_ZONE), FIXED_SERVICE_TIME_ZONE);
  });
  for (const timeZone of ["UTC", "America/Manaus"]) await t.test(`new ${timeZone} is refused without changing global historical validation`, () => {
    assert.throws(() => assertNewServiceTimeZone(timeZone), /new_service_timezone_must_be_brasilia/);
    assert.equal(validateProfessionalInput({ publicName: "Historical", timeZone }).timeZone, timeZone);
    assert.equal(validateRecurringAvailability({ timeZone, rows: [{ weekday: 3, startMinute: 600, endMinute: 660 }] }).rows[0]!.timeZone, timeZone);
    assert.equal(validateAvailabilityException({ ...interval, timeZone }).timeZone, timeZone);
  });
  for (const timeZone of ["UTC", "America/Manaus"]) await t.test(`professional create rejects ${timeZone} only after administration`, async () => {
    const f = fixture();
    await assert.rejects(() => new PrismaServiceProfessionalRepository(f.prisma).create(actor, { publicName: "New", timeZone }), /new_service_timezone_must_be_brasilia/);
    assert.ok(f.reads.includes("auth")); assert.equal(f.writes.length, 0);
  });
  await t.test("valid Staff remains forbidden before the fixed-zone policy", async () => {
    const f = fixture();
    await assert.rejects(() => new PrismaServiceProfessionalRepository(f.prisma).create({ ...actor, role: "staff" }, { publicName: "New", timeZone: "UTC" }), /service_operator_required/);
    assert.equal(f.writes.length, 0);
  });
  await t.test("new recurring zone rejection follows existing resource and version checks", async () => {
    const f = fixture(), writer = new SaveProfessionalAvailabilityUseCase(f.prisma), raw = { timeZone: "UTC", rows: [{ weekday: 3, startMinute: 600, endMinute: 660 }] };
    await assert.rejects(() => writer.execute(actor, f.profile.id, 4, raw), /service_professional_stale/);
    await assert.rejects(() => writer.execute(actor, f.profile.id, 5, raw), /new_service_timezone_must_be_brasilia/);
    assert.ok(f.reads.includes("auth")); assert.ok(f.reads.includes("profile")); assert.equal(f.writes.length, 0);
  });
  await t.test("a new grade on a historical professional requires explicit Brasilia rather than reusing old wall minutes", async () => {
    const f = fixture("UTC");
    await assert.rejects(() => new SaveProfessionalAvailabilityUseCase(f.prisma).execute(actor, f.profile.id, 5, { rows: [{ weekday: 3, startMinute: 600, endMinute: 660 }] }), /explicit_brasilia_grade_required/);
    assert.equal(f.profile.timeZone, "UTC"); assert.equal(f.writes.length, 0);
  });
  for (const kind of ["one_off", "block"] as const) await t.test(`new Brasilia ${kind} can use a historical professional without a recurring grade`, async () => {
    const f = fixture("America/Manaus");
    const result = await saveAvailabilityException(f.tx, actor, f.profile.id, 5, { ...interval, kind });
    assert.equal(result.exception.timeZone, FIXED_SERVICE_TIME_ZONE); assert.equal(result.exception.startsAt.toISOString(), "2030-01-02T13:00:00.000Z");
    assert.equal(result.exception.endsAt.toISOString(), "2030-01-02T13:30:00.000Z"); assert.equal(f.profile.timeZone, "America/Manaus");
    assert.equal(f.writes.some(value => Object.hasOwn(value, "timeZone") && value.timeZone === "America/Manaus"), false);
  });
  await t.test("new interval admission does not weaken the confirmed-appointment conflict", async () => {
    const f = fixture("UTC"); f.occupy();
    await assert.rejects(() => saveAvailabilityException(f.tx, actor, f.profile.id, 5, { ...interval, kind: "block" }), /availability_appointment_conflict/);
    assert.equal(f.writes.length, 0);
  });
  await t.test("ordinary withdrawal preserves the stored precise historical interval and zone", async () => {
    const before = { id: "historic", merchantId: actor.merchantId, professionalId: "professional", kind: "block", timeZone: "UTC",
      startsAt: new Date("2030-01-02T09:00:30.123Z"), endsAt: new Date("2030-01-02T09:30:30.123Z"), reason: "Historical reason", version: 3, isActive: true, actorId: "previous" };
    const f = fixture(FIXED_SERVICE_TIME_ZONE, before);
    const result = await saveAvailabilityException(f.tx, actor, f.profile.id, 5, { ...interval, id: before.id, timeZone: "UTC", isActive: false, reason: "Must not replace history" });
    assert.deepEqual(result.exception, { ...before, isActive: false, actorId: actor.userId, version: 4 });
  });
  await t.test("a new inactive record cannot use the historical withdrawal branch", async () => {
    const f = fixture("UTC");
    await assert.rejects(() => saveAvailabilityException(f.tx, actor, f.profile.id, 5, { ...interval, timeZone: "UTC", isActive: false }), /new_service_timezone_must_be_brasilia/);
    assert.equal(f.writes.length, 0);
  });
  await t.test("caller legacy flags cannot grant historical authority", async () => {
    const f = fixture("UTC");
    await assert.rejects(() => saveAvailabilityException(f.tx, actor, f.profile.id, 5, { ...interval, timeZone: "UTC", legacy: true } as never), /invalid_availability_exception/);
    assert.equal(f.writes.length, 0);
  });
});
