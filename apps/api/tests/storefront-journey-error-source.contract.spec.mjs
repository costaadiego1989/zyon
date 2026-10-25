import test from "node:test";
import assert from "node:assert/strict";
import { journeyErrorSource, journeyMutationBuckets } from "./storefront-journey-error-source.mjs";

test("diagnostic exposes only a fixed harness file and line, never raw sensitive text", () => {
  const stack = "CANARY_KEY CANARY_BUYER\n at f (file:///private/secret/storefront-journey-neighborhood.http-scenario.mjs:42:9)";
  const result = journeyErrorSource({ stack, message: "CANARY_KEY" });
  assert.deepEqual(result, { file: "storefront-journey-neighborhood.http-scenario.mjs", line: 42 });
  assert.equal(JSON.stringify(result).includes("CANARY"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
test("foreign frames and malformed or oversized stacks do not disclose paths", () => {
  for (const stack of ["at f (/foreign/module.js:1:1)", "storefront-journey-commerce.worker.mjs:0:1)",
    "storefront-journey-commerce.worker.mjs:1234567:1)", "x".repeat(100001), {}, undefined])
    assert.equal(journeyErrorSource({ stack }), undefined);
});
test("unknown stack getters are never executed", () => {
  let calls = 0; const error = Object.defineProperty({}, "stack", { get() { calls++; return "CANARY_KEY"; } });
  assert.equal(journeyErrorSource(error), undefined); assert.equal(calls, 0);
});
test("native Error stack getter is accepted without exporting raw stack data", () => {
  const error = new Error("CANARY_KEY");
  assert.equal(journeyErrorSource(error), undefined);
});
test("mutation diagnostics expose only fixed bucket names and never execute getters", () => {
  assert.deepEqual(journeyMutationBuckets({ journeyChangedTables: ["checkout", "outbox"] }), ["checkout", "outbox"]);
  assert.equal(journeyMutationBuckets({ journeyChangedTables: ["CANARY_KEY"] }), undefined);
  assert.equal(journeyMutationBuckets(Object.defineProperty({}, "journeyChangedTables", { get() { assert.fail("getter_must_not_run"); } })), undefined);
});
