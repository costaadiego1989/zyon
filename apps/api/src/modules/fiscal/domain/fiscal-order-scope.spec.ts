import assert from "node:assert/strict";
import test from "node:test";
import { isFiscalOrderScope } from "./fiscal-order-scope.js";

test("FISCAL-24 the order store is the sole admitted issuer and commercial owner", () => {
  assert.equal(isFiscalOrderScope("store", ["store", "store", "store"]), true);
  assert.equal(isFiscalOrderScope("store", []), true);
  for (const owners of [["foreign"], ["store", "foreign"], ["foreign", "store"], [""]]) {
    assert.equal(isFiscalOrderScope("store", owners), false);
  }
});
test("FISCAL-24 an absent order store never grants fiscal scope", () => {
  assert.equal(isFiscalOrderScope("", []), false);
  assert.equal(isFiscalOrderScope("", [""]), false);
});
