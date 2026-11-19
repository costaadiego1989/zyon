// BOOK-05/08/10: historical channel, immutable units and current projection.
import assert from "node:assert/strict";
import test from "node:test";
import { readStoredServiceOrigin, serviceProjectionStatus, professionalOrderLine } from "./service-order-appointment.js";
import { serviceCheckoutProvenance } from "./service-checkout-provenance.js";
test("T35", async t => {
  await t.test("only server verified checkout identity selects an origin", () => {
    const scope = { merchantId: "m", sessionId: "s", globalUserId: "b" };
    assert.equal(serviceCheckoutProvenance(scope, undefined), undefined);
    const p = serviceCheckoutProvenance(scope, { serverChannel: "storefront", trustedBuyer: { globalUserId: "b", customer: { email: "buyer@example.test", email_verified: true } } });
    assert.equal(p?.serviceOrigin, "storefront");
    assert.equal(serviceCheckoutProvenance(scope, { trustedBuyer: { globalUserId: "b", customer: { email: "buyer@example.test", email_verified: true } } }), undefined);
    assert.throws(() => serviceCheckoutProvenance(scope, { serverChannel: "storefront", trustedBuyer: { globalUserId: "foreign", customer: { email: "buyer@example.test", email_verified: true } } }));
    const w = serviceCheckoutProvenance(scope, { serverChannel: "whatsapp", trustedWhatsAppBuyer: { merchantId: "m", conversationId: "durable-conversation", globalUserId: "b",
      customer: { phone: "5511999999999", phone_verified: true, email_verified: false } } });
    assert.equal(w?.serviceOrigin, "whatsapp");
    assert.equal(readStoredServiceOrigin({ ...scope, ...w }), "whatsapp");
    assert.equal(readStoredServiceOrigin({ ...scope, ...w, globalUserId: "other" }), "whatsapp"); // origin does not grant buyer identity
    assert.throws(() => readStoredServiceOrigin({ ...scope, serviceOrigin: "storefront", serviceOriginProof: null }));
  });
  await t.test("unproven legacy origin is not guessed from cart or customer flags", () => {
    assert.throws(() => readStoredServiceOrigin({ merchantId: "m", sessionId: "s", globalUserId: "b", serviceOrigin: null,
      serviceOriginProof: null, cart: { source: "whatsapp" }, customer: { phone_verified: true } }));
  });
  await t.test("server origin receipt copies only bound identity, never arbitrary session cart or customer data", () => {
    const scope = { merchantId: "m", sessionId: "s", globalUserId: "b", cart: { source: "whatsapp", privateCart: "secret" }, customer: { email: "private@example.test" } };
    const proof = serviceCheckoutProvenance(scope, { serverChannel: "storefront" });
    assert.deepEqual(proof?.serviceOriginProof, { schemaVersion: 1, merchantId: "m", sessionId: "s", globalUserId: "b", authority: "storefront_entrypoint" });
    assert.equal(JSON.stringify(proof).includes("secret"), false); assert.equal(JSON.stringify(proof).includes("private@example.test"), false);
  });
  await t.test("the immutable order line, not mutable fulfillment schedule, owns classification", () => {
    const old = { lineItemsJson: [{ lineId: "l", productType: "service", fulfillmentStrategy: "scheduled_service", schedule: { startsAt: "2030-01-01" } }] };
    assert.equal(professionalOrderLine(old as any, "l"), undefined);
    const professional = { ...old.lineItemsJson[0], snapshotVersion: 2, quantity: 1, variantId: "v", unitPriceCents: 5000,
      schedule: { professionalId: "p", professionalVersion: 1, policyVersion: 1, date: "2030-01-01", startsAt: "2030-01-01T10:00:00.000Z",
        endsAt: "2030-01-01T10:20:00.000Z", timeZone: "UTC", durationMinutes: 20, slotId: "opaque" } };
    assert.equal(professionalOrderLine({ lineItemsJson: [professional] } as any, "l")?.schedule?.professionalId, "p");
    assert.throws(() => professionalOrderLine({ lineItemsJson: [{ ...professional, quantity: 2 }] } as any, "l"));
    assert.throws(() => professionalOrderLine({ lineItemsJson: [professional, professional] } as any, "l"));
  });
  await t.test("canonical terminal and moved states cannot be revived as reserved", () => {
    assert.equal(serviceProjectionStatus("scheduled"), "reserved"); assert.equal(serviceProjectionStatus("in_service"), "reserved");
    assert.equal(serviceProjectionStatus("cancelled"), "cancelled"); assert.equal(serviceProjectionStatus("completed"), "completed");
    assert.equal(serviceProjectionStatus("no_show"), "no_show"); assert.equal(serviceProjectionStatus("pending"), "cancelled");
  });
});
