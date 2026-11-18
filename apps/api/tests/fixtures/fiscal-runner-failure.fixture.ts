import test from "node:test";
import assert from "node:assert/strict";
// Invoked only by the runner's negative integration case, never discovered.
test("synthetic_expected_child_assertion_failure", () => {
  assert.equal("actual-child-result", "expected-child-result");
});
