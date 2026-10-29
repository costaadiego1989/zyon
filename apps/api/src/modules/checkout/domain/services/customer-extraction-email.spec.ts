import test from "node:test";
import assert from "node:assert/strict";
import { extractCpf } from "./customer-extraction.service.js";

test("numeric email addresses and unrelated numeric fields never supply a CPF", () => {
  for (const input of ["buyer12345678901@example.com", "qa-native-12345678-abcd-9999-1234-ab1234567890@example.invalid", "Pedido 12345, código 678901", "Código 123456, CEP 12345678", "+55 21 97119-1446", "123456789012"]) {
    assert.equal(extractCpf(input), undefined, input);
  }
});
test("a separately supplied plain or formatted CPF remains available to the secure storefront", () => {
  assert.equal(extractCpf("52998224725"), "52998224725");
  assert.equal(extractCpf("Meu CPF é 529.982.247-25."), "52998224725");
  assert.equal(extractCpf("Nome Pessoa, email buyer12345678901@example.com, CPF 52998224725"), "52998224725");
});
