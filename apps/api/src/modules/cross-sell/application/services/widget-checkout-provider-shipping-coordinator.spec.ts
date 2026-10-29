import test from "node:test";
import assert from "node:assert/strict";
import { WidgetCheckoutProviderShippingCoordinator } from "./widget-checkout-provider-shipping-coordinator.js";
import { beginProviderShipping, completeProviderShipping, unknownProviderShipping } from "../../domain/services/widget-checkout-provider-shipping.js";
import type { WidgetCheckoutProviderShippingRepository } from "../../domain/ports/widget-checkout-provider-shipping.port.js";
import type { ProviderShippingResult, ProviderShippingSources } from "../../domain/contracts/widget-checkout-provider-shipping.schemas.js";

const id = "7ddca159-7f78-49ba-b060-d0af0e074b18", scope = { merchantId: "merchant", sessionId: "session" };
function fixture() {
  const sources: ProviderShippingSources = { ...scope, buyerId: "buyer", acceptanceEventId: "accepted", persistenceVersion: 5,
    mode: "radius", originZip: "01310000", destinationZip: "02010000", basisHash: "a".repeat(64), destinationHash: "b".repeat(64), packageHash: "c".repeat(64),
    originHash: "d".repeat(64), configHash: "e".repeat(64), metadataHash: "f".repeat(64) };
  const pending = beginProviderShipping(sources, { expectedVersion: 5 }, { requestId: id, now: "2026-10-20T12:00:00.000Z" });
  assert.equal(pending.state, "pending");
  if (pending.state !== "pending") throw Error("fixture_not_pending");
  const calls: string[] = [];
  const response: ProviderShippingResult = { requestId: id, mode: "radius", expiresAt: "2026-10-20T12:01:00.000Z",
    options: [{ carrier_key: "own_delivery_radius", label: "Entrega própria", price: 700, eta_days: 1 }],
    evidence: { kind: "cep_haversine", originZip: "01310000", destinationZip: "02010000", distanceKm: 3 } };
  const dispatch = { requestId: id, merchantId: "merchant", metadataHash: sources.metadataHash, expiresAt: pending.expiresAt,
    mode: "radius" as const, originZip: "01310000", destinationZip: "02010000", config: {} };
  const repository: WidgetCheckoutProviderShippingRepository = {
    begin: async () => { calls.push("begin_committed"); return { pending, dispatch }; },
    complete: async (_scope, requestId, result) => {
      calls.push("complete_new_tx"); assert.equal(requestId, id);
      return completeProviderShipping(pending, pending.sources, result, "2026-10-20T12:00:01.000Z");
    },
    markUnknown: async (_scope, requestId) => {
      calls.push("unknown_new_tx"); assert.equal(requestId, id);
      return unknownProviderShipping(pending, pending.sources, "2026-10-20T12:00:01.000Z");
    },
  };
  const supplier = { quote: async () => { calls.push("supplier_outside_tx"); return response; } };
  return { repository, supplier, calls, response, pending, dispatch };
}

test("only known committed begin dispatches once and completes in separate transaction port", async () => {
  const f = fixture(), coordinator = new WidgetCheckoutProviderShippingCoordinator(f.repository, f.supplier);
  const result = await coordinator.execute(scope, { expectedVersion: 5 });
  assert.equal(result.state, "completed");
  assert.deepEqual(f.calls, ["begin_committed", "supplier_outside_tx", "complete_new_tx"]);
});
for (const stage of ["begin", "complete", "markUnknown"] as const) {
  test(`lost ${stage} commit ACK is never retried or compensated`, async () => {
    const f = fixture();
    if (stage === "markUnknown") f.supplier.quote = async () => { f.calls.push("supplier_outside_tx"); throw Error("PRIVATE_TIMEOUT"); };
    f.repository[stage] = async () => { f.calls.push(`${stage}_ack_lost`); throw Error("commit_ack_unknown"); };
    await assert.rejects(new WidgetCheckoutProviderShippingCoordinator(f.repository, f.supplier).execute(scope, { expectedVersion: 5 }), /commit_ack_unknown/);
    assert.deepEqual(f.calls, stage === "begin" ? ["begin_ack_lost"] : stage === "complete"
      ? ["begin_committed", "supplier_outside_tx", "complete_ack_lost"]
      : ["begin_committed", "supplier_outside_tx", "markUnknown_ack_lost"]);
  });
}
test("provider exception persists unknown without exception detail or retry", async () => {
  const f = fixture(); f.supplier.quote = async () => { f.calls.push("supplier_outside_tx"); throw Error("PRIVATE_PROVIDER_RESPONSE"); };
  const result = await new WidgetCheckoutProviderShippingCoordinator(f.repository, f.supplier).execute(scope, { expectedVersion: 5 });
  assert.equal(result.state, "unknown"); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  assert.deepEqual(f.calls, ["begin_committed", "supplier_outside_tx", "unknown_new_tx"]);
});
test("malformed provider data is unknown, not an empty completed quote", async () => {
  const f = fixture(); f.supplier.quote = async () => ({ ...f.response, options: [{ price: "PRIVATE_AMOUNT" }] } as never);
  const result = await new WidgetCheckoutProviderShippingCoordinator(f.repository, f.supplier).execute(scope, { expectedVersion: 5 });
  assert.equal(result.state, "unknown"); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  assert.deepEqual(f.calls, ["begin_committed", "unknown_new_tx"]);
});
test("completion must revalidate changed config instead of accepting provider price", async () => {
  const f = fixture();
  f.repository.complete = async (_scope, _id, result) => {
    f.calls.push("complete_new_tx");
    return completeProviderShipping(f.pending, { ...f.pending.sources, configHash: "0".repeat(64) }, result, "2026-10-20T12:00:01.000Z");
  };
  await assert.rejects(new WidgetCheckoutProviderShippingCoordinator(f.repository, f.supplier).execute(scope, { expectedVersion: 5 }), /review_required/);
  assert.deepEqual(f.calls, ["begin_committed", "supplier_outside_tx", "complete_new_tx"]);
});
for (const field of ["requestId", "merchantId", "metadataHash", "expiresAt", "mode"] as const) {
  test(`canonical dispatch ${field} mismatch refuses before provider`, async () => {
    const f = fixture();
    f.repository.begin = async () => ({ pending: f.pending, dispatch: { ...f.dispatch,
      [field]: field === "mode" ? "carrier" : "changed" } as never });
    await assert.rejects(new WidgetCheckoutProviderShippingCoordinator(f.repository, f.supplier).execute(scope, { expectedVersion: 5 }), /review_required/);
    assert.deepEqual(f.calls, []);
  });
}
