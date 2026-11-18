import test from "node:test";
import assert from "node:assert/strict";

test("FISCAL-64 fiscal_mjs_source_child_executed", () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(["child", "child-v8"].includes(process.env.NODE_TEST_CONTEXT));
  assert.equal(process.env.REDIS_URL, "");
});
