import assert from "node:assert/strict";
import test from "node:test";
import { rescheduleQuoteFingerprint, validateRescheduleDestination } from "./reschedule-service-appointment.use-case.js";

const quote = () => ({ merchantId: "own", appointmentId: "a", version: 2, productId: "s", variantId: "v", professionalId: "p",
  professionalVersion: 3, policyVersion: 4, policyHash: "b".repeat(64), startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T10:20:00.000Z",
  timeZone: "UTC", durationMinutes: 20, priceInCents: 5000, currency: "BRL", paymentMode: "at_attendance" as const, holdEnabled: false, holdMinutes: null });
test("T34 canonical reschedule quote", async t => {
  await t.test("all original identity/current destination/commercial coordinates bind explicit acceptance", () => {
    const original = quote(), hash = rescheduleQuoteFingerprint(original); assert.match(hash, /^[a-f0-9]{64}$/);
    for (const change of [{ merchantId: "foreign" }, { appointmentId: "other" }, { version: 3 }, { professionalId: "other" }, { professionalVersion: 4 },
      { policyVersion: 5 }, { policyHash: "c".repeat(64) }, { startsAt: "2030-01-02T10:20:00.000Z" }, { endsAt: "2030-01-02T10:40:00.000Z" },
      { timeZone: "America/Sao_Paulo" }, { durationMinutes: 30 }, { priceInCents: 6000 }, { currency: "USD" }, { paymentMode: "online" }, { holdEnabled: true, holdMinutes: 4 }])
      assert.notEqual(rescheduleQuoteFingerprint({ ...original, ...change }), hash);
  });
  await t.test("property insertion order never changes the same server quotation", () => {
    const original = quote(), reversed = Object.fromEntries(Object.entries(original).reverse());
    assert.equal(rescheduleQuoteFingerprint(reversed as ReturnType<typeof quote>), rescheduleQuoteFingerprint(original));
  });
  await t.test("destination validates actual typed identifiers/instant/version without body price/timezone grants", () => {
    assert.deepEqual(validateRescheduleDestination({ professionalId: "p", expectedProfessionalVersion: 3, startsAt: "2030-01-02T10:00:00Z" }),
      { professionalId: "p", expectedProfessionalVersion: 3, startsAt: "2030-01-02T10:00:00.000Z" });
    for (const change of [{ professionalId: "" }, { expectedProfessionalVersion: 0 }, { startsAt: "yesterday" }, { priceInCents: 1 }, { timeZone: "UTC" }])
      assert.throws(() => validateRescheduleDestination({ professionalId: "p", expectedProfessionalVersion: 3, startsAt: "2030-01-02T10:00:00Z", ...change }));
  });
  await t.test("original record versions are distinct from an authenticated operator's acceptance", () => {
    const original = quote(); assert.notEqual(rescheduleQuoteFingerprint({ ...original, version: original.version + 1 }), rescheduleQuoteFingerprint(original));
    assert.notEqual(rescheduleQuoteFingerprint({ ...original, policyHash: "0".repeat(64) }), rescheduleQuoteFingerprint(original));
  });
});
