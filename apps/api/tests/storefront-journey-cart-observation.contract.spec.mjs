import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as observation from "./storefront-journey-cart-observation.mjs";
import { journeyLlmDiagnosticSchema } from "./storefront-journey-llm.guards.mjs";

test("failed-turn observation distinguishes committed cart effects without returning cart contents", async () => {
  const before = { items: [{ variantId: "private-canary", quantity: 1 }], total: 5000 };
  assert.equal(await observation.observeFailedJourneyCart(undefined, async () => before), "not_observed");
  assert.equal(await observation.observeFailedJourneyCart(null, async () => null), "absent");
  assert.equal(await observation.observeFailedJourneyCart(before, async () => structuredClone(before)), "unchanged");
  assert.equal(await observation.observeFailedJourneyCart(before, async () => ({ ...before, total: 10000 })), "changed");
  assert.equal(await observation.observeFailedJourneyCart(null, async () => before), "changed");
  assert.equal(await observation.observeFailedJourneyCart(before, async () => null), "changed");
  assert.equal(await observation.observeFailedJourneyCart(before, async () => { throw Error("private-canary"); }), "observation_failed");
  assert.equal(before.items[0].quantity, 1);
});

test("observation does not retry a failed scoped read", async () => {
  let calls = 0;
  assert.equal(await observation.observeFailedJourneyCart(null, async () => { calls++; throw Error("private"); }), "observation_failed");
  assert.equal(calls, 1);
});

test("diagnostic schema permits only fixed observation enums, never cart payloads", () => {
  const field = journeyLlmDiagnosticSchema.shape.cartObservation;
  for (const value of ["not_observed", "absent", "unchanged", "changed", "observation_failed"])
    assert.equal(field.parse(value), value);
  for (const value of ["private-canary", null, { items: [{ variantId: "private-canary" }] }])
    assert.equal(field.safeParse(value).success, false);
});

test("real phase captures scoped SQL state before sending and observes failure without replay", () => {
  const phase = readFileSync(new URL("./storefront-journey-llm-phase.mjs", import.meta.url), "utf8");
  assert.ok(phase.indexOf("cartBeforeTurn = await readScopedCart()") < phase.indexOf("const response = await fetch("));
  assert.match(phase, /merchantId_sessionId: \{ merchantId, sessionId \}/);
  assert.match(phase, /await observeFailedJourneyCart\(cartBeforeTurn, readScopedCart\)/);
  assert.match(phase, /lastProviderFailure: summarizeJourneyProviderFailure\(traces\), cartObservation, traces/);
  assert.equal(phase.match(/observeFailedJourneyCart\(cartBeforeTurn, readScopedCart\)/g).length, 1);
});
