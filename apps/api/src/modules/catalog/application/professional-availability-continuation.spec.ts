import assert from "node:assert/strict";
import test from "node:test";
import { continuationAvailabilityTimeZone, preserveVerifiedProfessionalAvailability } from "./professional-availability-continuation.js";

const selected = { productId: "service", variantId: "variant", professionalId: "professional", professionalVersion: 4, policyVersion: 2,
  date: "2030-01-03", startsAt: "2030-01-03T01:00:00.000Z", endsAt: "2030-01-03T01:30:00.000Z", timeZone: "UTC", durationMinutes: 30 };
const input = { merchantId: "merchant", productId: "service", variantId: "variant", professionalId: "professional", expectedVersion: 4,
  fromDate: selected.date, toDate: selected.date };
const facts = { timeZone: "UTC", durationMinutes: 30, policyVersion: 2 };

test("T112 private presentation continuation carries previously verified facts without JSON authority", async t => {
  await t.test("a private context retains the exact selection and cannot be changed through the original object", () => {
    const value = { ...selected }, context = preserveVerifiedProfessionalAvailability(input.merchantId, value);
    value.timeZone = "America/Manaus";
    assert.equal(continuationAvailabilityTimeZone(context, input, facts), "UTC"); assert.equal(Object.isFrozen(context), true);
  });
  await t.test("public JSON flags copied objects and arbitrary zones do not recreate a private context", () => {
    const context = preserveVerifiedProfessionalAvailability(input.merchantId, selected);
    for (const forged of [{ legacy: true, ...selected }, { ...context }, JSON.parse(JSON.stringify(context)), { timeZone: "UTC", createdAt: "2000-01-01" }])
      assert.throws(() => continuationAvailabilityTimeZone(forged as typeof context, input, facts), /service_timezone_continuation_conflict/);
    assert.equal(continuationAvailabilityTimeZone(undefined, input, facts), undefined);
  });
  await t.test("merchant professional service variant version policy date and duration must remain exact", () => {
    const context = preserveVerifiedProfessionalAvailability(input.merchantId, selected);
    for (const changed of [{ merchantId: "foreign" }, { professionalId: "other" }, { productId: "other" }, { variantId: "other" },
      { expectedVersion: 5 }, { fromDate: "2030-01-02" }, { toDate: "2030-01-04" }])
      assert.throws(() => continuationAvailabilityTimeZone(context, { ...input, ...changed }, facts), /service_timezone_continuation_conflict/);
    for (const changed of [{ policyVersion: 3 }, { durationMinutes: 45 }, { timeZone: "America/Manaus" }])
      assert.throws(() => continuationAvailabilityTimeZone(context, input, { ...facts, ...changed }), /service_timezone_continuation_conflict/);
  });
});
