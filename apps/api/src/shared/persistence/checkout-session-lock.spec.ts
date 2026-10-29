import assert from "node:assert/strict";
import test from "node:test";
import { lockCheckoutSessionAnchor } from "./checkout-session-lock.js";

for (const [merchantId, sessionId] of [["tenant", "checkout"], ["tenant:one", "checkout:two"],
  ['tenant",\"x', "checkout'); SELECT 1; --"], ["loja-ç", "sessão-🛒"]]) {
  test(`session anchor binds the exact tenant/session tuple (${merchantId})`, async () => {
    let queries = 0;
    await lockCheckoutSessionAnchor({ async $queryRaw(parts, ...values) {
      queries++;
      assert.equal(parts.join("?"), "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text");
      assert.deepEqual(values, [JSON.stringify(["checkout-session", merchantId, sessionId])]);
      return [];
    } }, merchantId!, sessionId!);
    assert.equal(queries, 1);
  });
}

test("anchor waits for the same transaction lock without starting nested transactions", async () => {
  let release!: () => void, done = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const result = lockCheckoutSessionAnchor({ async $queryRaw() { await gate; return []; } }, "tenant", "session")
    .then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  release(); await result; assert.equal(done, true);
});

test("lock failure propagates without retry or fallback", async () => {
  const failure = new Error("synthetic_lock_failure"); let calls = 0;
  await assert.rejects(lockCheckoutSessionAnchor({ async $queryRaw() { calls++; throw failure; } }, "tenant", "session"), error => error === failure);
  assert.equal(calls, 1);
});
