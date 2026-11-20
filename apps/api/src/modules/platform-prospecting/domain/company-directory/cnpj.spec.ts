import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalCnpj } from "./cnpj.js";

test("PROS-04 AC1 preserves numeric zeros and the official alphanumeric example", () => {
  assert.equal(canonicalCnpj("00.000.000/0001-91"), "00000000000191");
  assert.equal(canonicalCnpj("12.ABC.345/01DE-35"), "12ABC34501DE35");
  assert.equal(canonicalCnpj("12abc34501de35"), "12ABC34501DE35");
  assert.equal(canonicalCnpj("11.222.333/0001-81"), "11222333000181");
});

test("PROS-04 AC2 rejects malformed identifiers and wrong check digits before a record exists", () => {
  for (const value of ["12ABC34501DE34", "12ABC34501DE3A", "00000000000000", "1122233300018", "112223330001810", "11@222333000181", "11.222333/0001-81", "１２ABC34501DE35"]) {
    assert.throws(() => canonicalCnpj(value), /invalid_cnpj/);
  }
});
