import assert from "node:assert/strict";
import test from "node:test";
import type { CheckoutSession } from "@zyon/shared-types";
import { hasProfessionalServiceSelection, professionalHoldRequests, readProfessionalCheckoutSelections } from "./service-checkout-selection.js";

function cart(): Pick<CheckoutSession, "merchantId" | "cart"> {
  const schedule = { slotId: "display-id-is-not-authority", date: "2030-01-02", startsAt: "2030-01-02T10:00:00Z", endsAt: "2030-01-02T10:30:00Z",
    timeZone: "UTC", durationMinutes: 30, professionalId: "professional-one", professionalVersion: 3, policyVersion: 7 };
  return { merchantId: "synthetic-store", cart: { currency: "BRL", total: 50, items: [{ sku: "service", product_id: "product", variantId: "variant", productType: "service",
    fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: schedule, name: "Synthetic service", price: 50, quantity: 1 }] } };
}
test("T27", async t => {
  await t.test("professional selections bind tenant, resource, time and accepted versions", () => {
    const session = cart(), [first] = readProfessionalCheckoutSelections(session);
    assert.equal(hasProfessionalServiceSelection(session), true);
    assert.equal(first.professionalId, "professional-one");assert.equal(first.professionalVersion, 3);assert.equal(first.policyVersion, 7);
    assert.equal(first.priceInCents, 5000);assert.equal(first.currency, "BRL");
    assert.equal(first.startsAt, "2030-01-02T10:00:00.000Z");assert.equal(first.endsAt, "2030-01-02T10:30:00.000Z");
    for (const [field, value] of [["professionalId", "professional-two"], ["professionalVersion", 4], ["policyVersion", 8]]) {
      const changed = cart();Reflect.set(changed.cart.items[0].fulfillmentSchedule!, field, value);
      assert.notEqual(readProfessionalCheckoutSelections(changed)[0].slotId, first.slotId);
    }
    assert.notEqual(readProfessionalCheckoutSelections({ ...session, merchantId: "other-store" })[0].slotId, first.slotId);
    assert.deepEqual(professionalHoldRequests([first]), [{ resourceId: "professional:professional-one", slotId: first.slotId,
      startsAt: first.startsAt, endsAt: first.endsAt }]);
  });
  await t.test("display IDs do not replace canonical selection identity", () => {
    const session = cart(), first = readProfessionalCheckoutSelections(session);
    session.cart.items[0].fulfillmentSchedule!.slotId = "different-display-id";
    assert.deepEqual(readProfessionalCheckoutSelections(session), first);
  });
  await t.test("physical carts have no professional schedule and remain untouched", () => {
    const session = cart();session.cart.items[0].productType = "physical";session.cart.items[0].fulfillmentStrategy = "carrier";
    delete session.cart.items[0].fulfillmentSchedule;
    const before = structuredClone(session);
    assert.equal(hasProfessionalServiceSelection(session), false);assert.deepEqual(readProfessionalCheckoutSelections(session), []);
    assert.deepEqual(session, before);
  });
  await t.test("old variant schedules are legacy until explicitly selected", () => {
    const session = cart(), raw = session.cart.items[0].fulfillmentSchedule!;
    for (const field of ["professionalId", "professionalVersion", "policyVersion"]) Reflect.deleteProperty(raw, field);
    assert.equal(hasProfessionalServiceSelection(session), false);
    assert.throws(() => readProfessionalCheckoutSelections(session), /service_professional_selection_required/);
  });
  await t.test("malformed or partial versions and intervals fail rather than becoming a lease", () => {
    for (const [field, value] of [["professionalId", null], ["professionalVersion", 0], ["policyVersion", 1.5],
      ["endsAt", "2030-01-02T10:31:00Z"], ["date", "2030-02-31"], ["timeZone", "invalid-zone"]]) {
      const session = cart();Reflect.set(session.cart.items[0].fulfillmentSchedule!, field, value);
      assert.throws(() => readProfessionalCheckoutSelections(session), /service_professional_selection_/);
    }
  });
  await t.test("two overlapping selections of one professional cannot self-reserve", () => {
    const session = cart();session.cart.items.push(structuredClone(session.cart.items[0]));
    assert.throws(() => readProfessionalCheckoutSelections(session), /service_slot_quantity_invalid/);
    Reflect.set(session.cart.items[1].fulfillmentSchedule!, "professionalId", "professional-two");
    assert.equal(readProfessionalCheckoutSelections(session).length, 2);
  });
});
