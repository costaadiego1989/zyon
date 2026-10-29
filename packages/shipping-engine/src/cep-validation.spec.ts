import test from "node:test";
import assert from "node:assert/strict";
import { validateCep, assertValidCep } from "./cep-validation.js";

test("validateCep accepts 8 digits and returns normalized value", () => {
  assert.deepEqual(validateCep("01310100"), { valid: true, normalized: "01310100" });
});

test("validateCep accepts dashed CEP and strips punctuation", () => {
  assert.deepEqual(validateCep("01310-100"), { valid: true, normalized: "01310100" });
});

test("validateCep accepts CEP with spaces and punctuation", () => {
  assert.deepEqual(validateCep(" 01.310-100 "), { valid: true, normalized: "01310100" });
});

test("validateCep rejects empty CEP", () => {
  assert.deepEqual(validateCep("   "), { valid: false, reason: "cep_empty" });
});

test("validateCep rejects non-string CEP", () => {
  assert.deepEqual(validateCep(null), { valid: false, reason: "cep_must_be_string" });
  assert.deepEqual(validateCep(1310100), { valid: false, reason: "cep_must_be_string" });
});

test("validateCep rejects short CEP", () => {
  assert.deepEqual(validateCep("123"), { valid: false, reason: "cep_invalid_length:3" });
});

test("validateCep rejects long / international postal code", () => {
  assert.deepEqual(validateCep("90210-1234"), { valid: false, reason: "cep_invalid_length:9" });
});

test("validateCep rejects all-zero CEP", () => {
  assert.deepEqual(validateCep("00000-000"), { valid: false, reason: "cep_all_zeros" });
});

test("assertValidCep returns normalized CEP or throws", () => {
  assert.equal(assertValidCep("01310-100"), "01310100");
  assert.throws(() => assertValidCep("123"), /cep_invalid_length:3/);
});
