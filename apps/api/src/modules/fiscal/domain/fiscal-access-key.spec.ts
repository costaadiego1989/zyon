import assert from "node:assert/strict";
import test from "node:test";
import { isFiscalAccessKey } from "./fiscal-access-key.js";
test("NF-e numeric and new alpha-CNPJ keys preserve exactly the documented letter positions", () => {
  const numeric = "35261112345678000195550010000000221123456780";
  const alpha = "35261112ABC34501DE35550010000000221123456780";
  assert.equal(numeric.length, 44); assert.equal(alpha.length, 44); assert.equal(isFiscalAccessKey(numeric), true); assert.equal(isFiscalAccessKey(alpha), true);
  for (const index of [0, 5, 18, 19, 20, 43]) assert.equal(isFiscalAccessKey(numeric.slice(0, index) + "A" + numeric.slice(index + 1)), false);
  assert.equal(isFiscalAccessKey(alpha.toLowerCase()), false); assert.equal(isFiscalAccessKey(alpha + "0"), false);
});
