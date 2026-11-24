import assert from "node:assert/strict";
import test from "node:test";
import { professionalScheduleSnapshot, professionalStorefrontSlot } from "./service-checkout-cart.js";
import type { ProfessionalCheckoutSelection } from "./service-checkout-selection.js";

// A display projection must not reinterpret the canonical instant or change the
// existing checkout schedule/fingerprint when supplying the cart's wall time.
const example = (timeZone = "America/Sao_Paulo", startsAt = "2035-02-05T13:00:00.000Z"): ProfessionalCheckoutSelection => ({
  productId: "product", variantId: "variant", professionalId: "professional", professionalVersion: 3,
  policyVersion: 2, date: "2035-02-05", startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
  timeZone, durationMinutes: 30, priceInCents: 5000, currency: "BRL", slotId: "a".repeat(64),
});
test("T40 storefront selected-slot presentation", async t => {
  await t.test("includes the required cart time in Brasília from the canonical UTC instant", () => {
    const slot = example(); const projected = professionalStorefrontSlot(slot);
    assert.deepEqual(projected, { ...professionalScheduleSnapshot(slot), startTime: "10:00" });
    assert.equal(slot.startsAt, "2035-02-05T13:00:00.000Z");
    assert.equal("startTime" in professionalScheduleSnapshot(slot), false);
  });
  await t.test("uses a historical tuple's own zone without changing its stored instants", () => {
    const slot = example("America/Manaus");
    assert.deepEqual(professionalStorefrontSlot(slot), { ...professionalScheduleSnapshot(slot), startTime: "09:00" });
    assert.equal(slot.timeZone, "America/Manaus");
  });
  await t.test("renders midnight as 00:00 while preserving the professional and policy versions", () => {
    const slot = example("America/Sao_Paulo", "2035-02-05T03:00:00.000Z");
    assert.deepEqual(professionalStorefrontSlot(slot), { ...professionalScheduleSnapshot(slot), startTime: "00:00" });
    assert.equal(professionalStorefrontSlot(slot).professionalVersion, 3);
    assert.equal(professionalStorefrontSlot(slot).policyVersion, 2);
  });
});
