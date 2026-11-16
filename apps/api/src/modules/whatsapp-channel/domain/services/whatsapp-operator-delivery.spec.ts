import test from "node:test";
import assert from "node:assert/strict";
import { parseOperatorDispatch, ownsOperatorDispatch, classifyOperatorSubmission, mergeOperatorDelivery } from "./whatsapp-operator-delivery.js";
const event = () => ({ eventId: "event", eventType: "whatsapp.support.message.requested", merchantId: "merchant", schemaVersion: 1,
  correlationId: "support_message:message", causationId: "message", deliveryLeaseToken: "private-original-lease",
  payload: { messageId: "message", ticketId: "ticket", bindingId: "binding", epoch: 2 } });
const row = () => ({ eventId: "event", eventType: "whatsapp.support.message.requested", merchantId: "merchant", schemaVersion: 1,
  correlationId: "support_message:message", causationId: "message", producer: "support", payload: event().payload,
  status: "processing", leaseToken: "private-original-lease", leaseExpiresAt: new Date(2000) });

test("operator dispatch captures only exact immutable original references and server lease", () => {
  const input = event(), proof = parseOperatorDispatch(input); assert.ok(proof); assert.equal(Object.isFrozen(proof), true);
  input.deliveryLeaseToken = "replacement"; input.payload.epoch = 99;
  assert.equal(proof.leaseToken, "private-original-lease"); assert.equal(proof.epoch, 2);
  assert.equal(proof.correlationId, "support_message:message"); assert.equal(proof.ticketId, "ticket");
});
test("a direct event name or free target cannot manufacture dispatch authority", () => {
  for (const input of [null, [], { ...event(), deliveryLeaseToken: undefined }, { ...event(), deliveryLeaseToken: ["private-original-lease"] },
    { ...event(), payload: { ...event().payload, recipient: "+5511000000000" } }, { ...event(), correlationId: "support_message:foreign" },
    { ...event(), causationId: "foreign" }, { ...event(), payload: { ...event().payload, epoch: 2.5 } }]) assert.equal(parseOperatorDispatch(input), undefined);
});
test("claim proof requires the original lease and fresh post-lock SQL clock", () => {
  const proof = parseOperatorDispatch(event()); assert.ok(proof); assert.equal(ownsOperatorDispatch(proof, row(), new Date(1000)), true);
  assert.equal(ownsOperatorDispatch(proof, { ...row(), leaseToken: "newer-lease" }, new Date(1000)), false);
  assert.equal(ownsOperatorDispatch(proof, row(), new Date(2000)), false);
  for (const changed of [{ merchantId: "foreign" }, { status: "delivered" }, { producer: "checkout" }, { payload: { ...event().payload, ticketId: "foreign" } }])
    assert.equal(ownsOperatorDispatch(proof, { ...row(), ...changed }, new Date(1000)), false);
});
test("SDK sent or queued with an admitted exact provider ID means accepted only", () => {
  for (const status of ["sent", "queued"] as const) assert.deepEqual(classifyOperatorSubmission("started", { status, messageId: "provider-1" }),
    { status: "accepted", providerMessageId: "provider-1" });
});
test("unknown timeout absent ID or a missing start seam never becomes a blind retry", () => {
  for (const [start, result] of [["started", { status: "unknown", messageId: "" }], ["started", { status: "sent", messageId: "" }],
    ["unknown", { status: "sent", messageId: "provider-1" }]] as const)
    assert.deepEqual(classifyOperatorSubmission(start, result), { status: "unknown", providerMessageId: null, errorCode: "submission_unknown" });
});
test("proven no-start and definitive provider rejection remain distinct from unknown", () => {
  assert.deepEqual(classifyOperatorSubmission("not_started", { status: "unknown", messageId: "" }), { status: "failed", providerMessageId: null, errorCode: "submission_not_started" });
  assert.deepEqual(classifyOperatorSubmission("started", { status: "failed", messageId: "" }), { status: "failed", providerMessageId: null, errorCode: "provider_rejected" });
});
test("delivery projection is monotonic idempotent and tied to one provider identity", () => {
  const queued = { status: "queued" as const, revision: 0, providerMessageId: null };
  const accepted = mergeOperatorDelivery(queued, { status: "accepted", providerMessageId: "provider-1" });
  assert.deepEqual(accepted, { changed: true, state: { status: "accepted", revision: 1, providerMessageId: "provider-1" } });
  assert.deepEqual(mergeOperatorDelivery(accepted.state, { status: "accepted", providerMessageId: "provider-1" }), { changed: false, state: accepted.state });
  assert.throws(() => mergeOperatorDelivery(accepted.state, { status: "read", providerMessageId: "foreign-provider" }), /operator_delivery_provider_conflict/);
});
test("a historical positive receipt outranks late acceptance or failure", () => {
  const read = { status: "read" as const, revision: 4, providerMessageId: "provider-1" };
  for (const status of ["accepted", "delivered", "failed", "unknown"] as const)
    assert.deepEqual(mergeOperatorDelivery(read, { status, providerMessageId: "provider-1" }), { changed: false, state: read });
});
test("known failure stays truthful until stronger delivery proof and clears its safe error", () => {
  const failed = { status: "failed" as const, revision: 2, providerMessageId: "provider-1", errorCode: "provider_rejected" };
  assert.deepEqual(mergeOperatorDelivery(failed, { status: "accepted", providerMessageId: "provider-1" }), { changed: false, state: failed });
  assert.deepEqual(mergeOperatorDelivery(failed, { status: "delivered", providerMessageId: "provider-1" }),
    { changed: true, state: { status: "delivered", revision: 3, providerMessageId: "provider-1" } });
});
