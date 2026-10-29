import test from "node:test";
import assert from "node:assert/strict";
import { beginProviderShipping, completeProviderShipping, unknownProviderShipping } from "./widget-checkout-provider-shipping.js";

const now = "2026-10-20T12:00:00.000Z", id = "7ddca159-7f78-49ba-b060-d0af0e074b18";
const current = { merchantId: "merchant", sessionId: "session", buyerId: "buyer", acceptanceEventId: "accepted",
  persistenceVersion: 12, mode: "radius" as const, originZip: "01310000", destinationZip: "02010000", basisHash: "a".repeat(64), destinationHash: "b".repeat(64),
  packageHash: "c".repeat(64), originHash: "d".repeat(64), configHash: "e".repeat(64), metadataHash: "f".repeat(64) };
const result = { requestId: id, mode: "radius" as const, expiresAt: "2026-10-20T12:01:00.000Z",
  options: [{ carrier_key: "own_delivery_radius", label: "Entrega própria", price: 700, eta_days: 1 }],
  evidence: { kind: "cep_haversine" as const, originZip: "01310000", destinationZip: "02010000", distanceKm: 3 } };
const pending = () => beginProviderShipping(current, { expectedVersion: 12 }, { requestId: id, now });
const afterBegin = () => ({ ...current, persistenceVersion: 13 });

test("pending and completed bind exact generation and preserve raw tariff", () => {
  const started = pending();
  assert.equal(started.state, "pending");
  assert.equal(started.persistenceVersion, 13);
  const completed = completeProviderShipping(started, afterBegin(), result, "2026-10-20T12:00:01.000Z");
  assert.equal(completed.state, "completed");
  assert.equal(completed.result.options[0]!.price, 700);
  assert.equal(completed.persistenceVersion, 14);
  assert.equal("realCost" in completed.result.options[0]!, false);
});
for (const field of ["merchantId", "sessionId", "buyerId", "acceptanceEventId", "basisHash", "destinationHash", "packageHash", "originHash", "configHash", "metadataHash"] as const) {
  test(`completion rejects changed canonical ${field}`, () => {
    const changed = { ...afterBegin(), [field]: field.endsWith("Hash") ? "0".repeat(64) : "changed" };
    assert.throws(() => completeProviderShipping(pending(), changed, result, "2026-10-20T12:00:01.000Z"));
  });
}
test("unknown is terminal and cannot accept late completion or redispatch", () => {
  const uncertain = unknownProviderShipping(pending(), afterBegin(), "2026-10-20T12:00:01.000Z");
  assert.throws(() => completeProviderShipping(uncertain, { ...afterBegin(), persistenceVersion: 14 }, result, "2026-10-20T12:00:02.000Z"));
  assert.throws(() => beginProviderShipping({ ...current, persistenceVersion: 14 }, { expectedVersion: 14 }, { requestId: id, now }, uncertain));
});
test("stale version, wrong UUID, expired/future DB time and forged price/cost refuse", () => {
  assert.throws(() => beginProviderShipping(current, { expectedVersion: 11 }, { requestId: id, now }));
  assert.throws(() => beginProviderShipping(current, { expectedVersion: 12, price: 0 }, { requestId: id, now }));
  for (const invalid of [{ ...result, requestId: "6ddca159-7f78-49ba-b060-d0af0e074b18" },
    { ...result, options: [{ ...result.options[0], realCost: 1 }] }, { ...result, options: [{ ...result.options[0], price: -1 }] }])
    assert.throws(() => completeProviderShipping(pending(), afterBegin(), invalid, "2026-10-20T12:00:01.000Z"));
  assert.throws(() => completeProviderShipping(pending(), afterBegin(), result, "2026-10-20T12:02:00.000Z"));
  assert.throws(() => completeProviderShipping(pending(), afterBegin(), result, "2026-10-20T11:59:59.000Z"));
  assert.throws(() => completeProviderShipping(pending(), afterBegin(), { ...result,
    evidence: { ...result.evidence, destinationZip: "11111111" } }, "2026-10-20T12:00:01.000Z"));
});
test("carrier proof cannot use radius evidence or mix accounts", () => {
  const carrier = { ...current, mode: "carrier" as const };
  const started = beginProviderShipping(carrier, { expectedVersion: 12 }, { requestId: id, now });
  assert.throws(() => completeProviderShipping(started, { ...carrier, persistenceVersion: 13 }, { ...result, mode: "carrier" }, "2026-10-20T12:00:01.000Z"));
});
