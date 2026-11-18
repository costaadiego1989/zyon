import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFiscalTaxId, validateFiscalRecipient, type FiscalRecipientField } from "./fiscal-recipient.js";

const fields: readonly FiscalRecipientField[] = ["name", "taxId", "address.street", "address.number", "address.neighborhood", "address.city", "address.state", "address.postalCode"];
const recipient = () => ({ name: " Cliente de teste ", taxId: "529.982.247-25", email: "buyer@example.test", phone: "+55 (11) 99999-1234",
  address: { street: " Rua de teste ", number: "123", neighborhood: "Centro", city: "São Paulo", state: "sp", postalCode: "01001-000", cityCode: "3550308", countryCode: "1058" } });

test("complete recipient data validates and keeps a canonical CPF and address", () => {
  const value = validateFiscalRecipient(recipient(), fields);
  assert.equal(value.valid, true);
  if (!value.valid) throw new Error("fixture_invalid");
  assert.equal(value.recipient.taxId, "52998224725");
  assert.equal(value.recipient.name, "Cliente de teste");
  assert.equal(value.recipient.address?.state, "SP");
  assert.equal(value.recipient.address?.postalCode, "01001000");
});

test("existing numeric CNPJs continue to validate with their original digits", () => {
  assert.equal(normalizeFiscalTaxId("04.252.011/0001-10"), "04252011000110");
});

test("FISCAL-09 valid alphanumeric CNPJ preserves letters and both check digits", () => {
  // Receita Federal official example: ASCII minus 48, modulo 11.
  const input = { ...recipient(), taxId: "12.abc.345/01de-35" };
  const value = validateFiscalRecipient(input, fields);
  assert.equal(normalizeFiscalTaxId(input.taxId), "12ABC34501DE35");
  assert.equal(value.valid, true);
  if (!value.valid) throw new Error("fixture_invalid");
  assert.equal(value.recipient.taxId, "12ABC34501DE35");
  assert.equal(input.taxId, "12.abc.345/01de-35");
});

test("an incorrect CPF check digit is rejected", () => {
  assert.equal(normalizeFiscalTaxId("52998224724"), undefined);
});

test("repeated numeric CPF and CNPJ values are rejected", () => {
  for (const value of ["00000000000", "11111111111", "00000000000000", "11111111111111"]) assert.equal(normalizeFiscalTaxId(value), undefined);
});

test("an incorrect numeric CNPJ check digit is rejected", () => {
  assert.equal(normalizeFiscalTaxId("04252011000111"), undefined);
});

test("an incorrect alphanumeric CNPJ check digit is rejected", () => {
  assert.equal(normalizeFiscalTaxId("12ABC34501DE34"), undefined);
});

test("CNPJ check positions remain numeric even when the base is alphanumeric", () => {
  assert.equal(normalizeFiscalTaxId("12ABC34501DE3A"), undefined);
});

test("tax identifiers containing unsupported characters are not silently repaired", () => {
  for (const value of ["12ABC34501DE35!", "12_ABC34501DE35", "１２ABC34501DE35", "52998224725x"]) assert.equal(normalizeFiscalTaxId(value), undefined);
});

test("missing fiscal fields are returned explicitly before payment", () => {
  const value = validateFiscalRecipient({ name: "Comprador" }, fields);
  assert.deepEqual(value, { valid: false, code: "fiscal_customer_data_required", fields: fields.filter(field => field !== "name") });
});

test("invalid postal code, UF and municipal code identify their own fields", () => {
  const input = recipient();
  input.address.postalCode = "0100"; input.address.state = "XX"; input.address.cityCode = "123";
  assert.deepEqual(validateFiscalRecipient(input, fields), { valid: false, code: "fiscal_customer_data_required", fields: ["address.state", "address.postalCode", "address.cityCode"] });
});

test("provided invalid email and phone are refused without exposing their values", () => {
  const value = validateFiscalRecipient({ ...recipient(), email: "not-email", phone: "abc" }, fields);
  assert.deepEqual(value, { valid: false, code: "fiscal_customer_data_required", fields: ["email", "phone"] });
});

test("a fiscal profile controls which absent fields must be collected", () => {
  const value = validateFiscalRecipient({ name: "Comprador" }, ["name"]);
  assert.equal(value.valid, true);
  if (!value.valid) throw new Error("fixture_invalid");
  assert.equal(value.recipient.name, "Comprador");
  assert.equal(value.recipient.taxId, undefined);
});

test("correcting recipient data never mutates a supplied cart or its agreed values", () => {
  const input = { ...recipient(), cart: { items: [{ sku: "sku_a", quantity: 2, unitPriceCents: 1234 }], totalCents: 2468 } };
  const before = structuredClone(input);
  assert.equal(validateFiscalRecipient(input, fields).valid, true);
  assert.deepEqual(input, before);
});

test("unknown required field configuration is refused", () => {
  assert.throws(() => validateFiscalRecipient(recipient(), ["unknown_field" as FiscalRecipientField]), /fiscal_recipient_profile_invalid/);
});

test("non-string and oversized recipient values are refused rather than coerced", () => {
  const value = validateFiscalRecipient({ ...recipient(), name: { value: "Buyer" }, taxId: 52998224725 }, fields);
  assert.deepEqual(value, { valid: false, code: "fiscal_customer_data_required", fields: ["name", "taxId"] });
  assert.deepEqual(validateFiscalRecipient({ ...recipient(), name: "a".repeat(257) }, fields), { valid: false, code: "fiscal_customer_data_required", fields: ["name"] });
});

test("NF-e textual bounds and phone presentation reject malformed provided fields", () => {
  for (const name of ["A", "a".repeat(61), "Buyer\nOther"]) {
    assert.deepEqual(validateFiscalRecipient({ ...recipient(), name }, fields), { valid: false, code: "fiscal_customer_data_required", fields: ["name"] });
  }
  assert.deepEqual(validateFiscalRecipient({ ...recipient(), phone: "++5511999991234" }, fields), { valid: false, code: "fiscal_customer_data_required", fields: ["phone"] });
});
