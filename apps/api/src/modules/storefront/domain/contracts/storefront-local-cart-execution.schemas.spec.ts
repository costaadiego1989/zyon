import assert from "node:assert/strict";
import test from "node:test";
import { storefrontLocalCartExecutionResultSchema } from "./storefront-local-cart-execution.schemas.js";

const requestId = "56f51c75-e1d5-4a84-9031-e616927707a0";
const effectId = "a5537938-7496-4ea4-94b4-ec872a418337";
const reference = { kind: "local_effect_recorded", requestId, effectId, revision: 1 };

for (const value of [reference, { ...reference, revision: Number.MAX_SAFE_INTEGER },
  { kind: "receipt_required", requestId, state: "processing" }, { kind: "receipt_required", requestId, state: "unknown" },
  { kind: "outcome_unknown", requestId }]) test(`strict application DTO accepts ${value.kind}/${"state" in value ? value.state : "reference"}`, () => {
  assert.deepEqual(storefrontLocalCartExecutionResultSchema.parse(value), value);
});

for (const kind of ["identity_conflict", "lane_blocked", "revision_conflict", "scope_unavailable", "admission_unknown"]) {
  test(`${kind} has no implicit claim or evidence`, () => {
    assert.deepEqual(storefrontLocalCartExecutionResultSchema.parse({ kind }), { kind });
    assert.equal(storefrontLocalCartExecutionResultSchema.safeParse({ kind, requestId }).success, false);
  });
}

for (const value of [reference, { kind: "receipt_required", requestId, state: "unknown" }, { kind: "outcome_unknown", requestId }]) {
  for (const extra of [{ claimToken: effectId }, { claim: {} }, { fingerprint: "opaque" }, { exception: "secret" },
    { cause: "secret" }, { cart: {} }, { scope: {} }, { args: {} }]) {
    test(`${value.kind} rejects extra ${Object.keys(extra)[0]}`, () => {
      assert.equal(storefrontLocalCartExecutionResultSchema.safeParse({ ...value, ...extra }).success, false);
    });
  }
}
for (const value of [{ ...reference, requestId: "bad" }, { ...reference, effectId: "bad" },
  ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", 1n, NaN, Infinity].map(revision => ({ ...reference, revision })),
  { kind: "receipt_required", requestId, state: "completed" }, { kind: "receipt_required", requestId },
  { kind: "outcome_unknown" }, { kind: "outcome_unknown", requestId: "bad" },
  { kind: "claimed", claim: { requestId } }, { kind: "completed", requestId }, { kind: "rejected" },
  { kind: "effect_recorded", requestId, effectId, revision: 1 }, { kind: "not_current" }]) {
  test(`application DTO rejects malformed or unimplemented state ${value.kind}/${Object.keys(value).join()}/${String("revision" in value ? value.revision : "")}`, () => {
    assert.equal(storefrontLocalCartExecutionResultSchema.safeParse(value).success, false);
  });
}

