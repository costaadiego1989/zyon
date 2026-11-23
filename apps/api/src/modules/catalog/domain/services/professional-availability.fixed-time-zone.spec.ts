import assert from "node:assert/strict";
import test from "node:test";
import { resolveNewProfessionalAvailability, resolveProfessionalAvailability, type ProfessionalAvailabilitySource } from "./professional-availability.js";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";

const BR = "America/Sao_Paulo", now = new Date("2029-01-01T00:00:00Z");
const range = (startsAt: string, endsAt: string) => ({ startsAt: new Date(startsAt), endsAt: new Date(endsAt) });
const source = (): ProfessionalAvailabilitySource => ({ professionalVersion: 4, policyVersion: 2, timeZone: "America/Manaus", durationMinutes: 30,
  recurring: [{ weekday: 3, startMinute: 1380, endMinute: 1440, timeZone: "America/Manaus", validFrom: null, validUntil: null }], exceptions: [], appointments: [] });
const query = { fromDate: "2030-01-03", toDate: "2030-01-03", now };

test("T112 new availability uses Brasilia while historical calendar facts retain their zones", async t => {
  await t.test("a historical Manaus Wednesday night remains the same UTC interval under Thursday Brasilia labels", () => {
    const value = source(), before = structuredClone(value), result = resolveNewProfessionalAvailability(value, query);
    assert.equal(result.timeZone, BR); assert.deepEqual(result.dates, ["2030-01-03"]);
    assert.deepEqual(result.slots.map(s => [s.startsAt, s.endsAt, s.date, s.startTime, s.timeZone]), [
      ["2030-01-03T03:00:00.000Z", "2030-01-03T03:30:00.000Z", "2030-01-03", "00:00", BR],
      ["2030-01-03T03:30:00.000Z", "2030-01-03T04:00:00.000Z", "2030-01-03", "00:30", BR],
    ]); assert.deepEqual(value, before);
    const historical = resolveProfessionalAvailability(value, { ...query, fromDate: "2030-01-02", toDate: "2030-01-02" });
    assert.equal(historical.timeZone, "America/Manaus"); assert.deepEqual(historical.slots.map(s => s.startTime), ["23:00", "23:30"]);
    assert.deepEqual(result.slots.map(s => s.startsAt), historical.slots.map(s => s.startsAt));
  });
  await t.test("Brasilia midnight is the date-window boundary even when the profile says UTC", () => {
    const value = { ...source(), timeZone: "UTC", recurring: [], exceptions: [{ ...range("2030-01-03T02:30:00Z", "2030-01-03T03:30:00Z"), kind: "one_off" as const }] };
    const first = resolveNewProfessionalAvailability(value, { ...query, fromDate: "2030-01-02", toDate: "2030-01-02" });
    const second = resolveNewProfessionalAvailability(value, query), combined = resolveNewProfessionalAvailability(value, { ...query, fromDate: "2030-01-02" });
    assert.deepEqual(first.slots.map(s => [s.date, s.startTime]), [["2030-01-02", "23:30"]]);
    assert.deepEqual(second.slots.map(s => [s.date, s.startTime]), [["2030-01-03", "00:00"]]);
    assert.deepEqual([...first.slots, ...second.slots], combined.slots);
  });
  await t.test("historical rule offsets are never replaced by profile or presentation offsets", () => {
    const value = source(); value.timeZone = "UTC";
    const result = resolveNewProfessionalAvailability(value, query);
    assert.equal(result.slots[0]!.startsAt, "2030-01-03T03:00:00.000Z");
    assert.equal(result.slots[0]!.startTime, "00:00"); assert.equal(value.recurring[0]!.timeZone, "America/Manaus");
  });
  await t.test("occupancy and precise blocks remain absolute and cannot become capacity after relabelling", () => {
    const value = source(); value.appointments = [range("2030-01-03T03:00:30.123Z", "2030-01-03T03:20:30.123Z")];
    value.exceptions = [{ ...range("2030-01-03T03:30:00Z", "2030-01-03T04:00:00Z"), kind: "block" }];
    const before = structuredClone(value), result = resolveNewProfessionalAvailability(value, query);
    assert.equal(result.status, "empty"); assert.deepEqual(result.slots, []); assert.deepEqual(value, before);
  });
  await t.test("new slot identities carry returned Brasilia labels while old identities remain distinct immutable values", () => {
    const value = source(), fresh = resolveNewProfessionalAvailability(value, query).slots[0]!;
    const old = resolveProfessionalAvailability(value, { ...query, fromDate: "2030-01-02", toDate: "2030-01-02" }).slots[0]!;
    const facts = { productId: "service", variantId: "variant", professionalId: "professional", professionalVersion: 4, policyVersion: 2 };
    const newIdentity = professionalSlotId("merchant", { ...facts, ...fresh }), oldIdentity = professionalSlotId("merchant", { ...facts, ...old });
    assert.notEqual(newIdentity, oldIdentity); assert.equal(fresh.startsAt, old.startsAt);
    assert.equal(old.date, "2030-01-02"); assert.equal(old.timeZone, "America/Manaus");
    assert.equal(newIdentity, professionalSlotId("merchant", { ...facts, ...fresh }));
  });
  await t.test("historical DST gaps and folds never invent elapsed slots in the Brasilia envelope", () => {
    for (const date of ["2030-03-10", "2030-11-03"]) {
      const value = { ...source(), timeZone: "UTC", recurring: [{ weekday: 0, startMinute: 60, endMinute: 240, timeZone: "America/New_York", validFrom: null, validUntil: null }] };
      const result = resolveNewProfessionalAvailability(value, { ...query, fromDate: date, toDate: date });
      assert.equal(result.status, "ready"); assert.ok(result.slots.every(s => s.timeZone === BR));
      assert.ok(result.slots.every(s => Date.parse(s.endsAt) - Date.parse(s.startsAt) === 30 * 60_000));
      assert.equal(new Set(result.slots.map(s => s.startsAt)).size, result.slots.length);
    }
  });
  await t.test("stale empty errors bounds and source limits stay separate under the fixed envelope", () => {
    const value = source(); assert.equal(resolveNewProfessionalAvailability(value, { ...query, expectedVersion: 3 }).status, "stale");
    assert.equal(resolveNewProfessionalAvailability({ ...value, recurring: [] }, query).status, "empty");
    assert.throws(() => resolveNewProfessionalAvailability(value, { ...query, toDate: "2030-02-03" }), /invalid_availability_window/);
    assert.throws(() => resolveNewProfessionalAvailability({ ...value, appointments: [range("invalid", "2030-01-03T04:00Z")] }, query), /availability_invalid_source/);
    assert.throws(() => resolveNewProfessionalAvailability({ ...value, durationMinutes: 0 }, query), /availability_source_limit/);
  });
});
