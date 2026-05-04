import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveChatStage,
  extractCep,
  extractCpf,
  extractEmail,
  extractName,
  extractPhone,
  missingFieldsForStage
} from "./customer-extraction.service.js";
import { checkoutSession } from "../../__tests__/checkout-test-fixtures.js";

test("extractEmail finds well-formed addresses inside arbitrary text", () => {
  assert.equal(extractEmail("meu email é joao.silva+work@example.com obrigado"), "joao.silva+work@example.com");
  assert.equal(extractEmail("not_an_email"), undefined);
  assert.equal(extractEmail("abc@def"), undefined);
});

test("extractCpf returns 11-digit string stripping punctuation", () => {
  assert.equal(extractCpf("CPF 123.456.789-09 por favor"), "12345678909");
  assert.equal(extractCpf("12345678901"), "12345678901");
  assert.equal(extractCpf("123 456 789 09"), "12345678909");
  assert.equal(extractCpf("apenas 9999999"), undefined);
});

test("extractCep returns 8-digit string stripping punctuation", () => {
  assert.equal(extractCep("CEP 01001-000"), "01001000");
  assert.equal(extractCep("12345678"), "12345678");
  assert.equal(extractCep("não tem"), undefined);
});

test("extractPhone returns 10 or 11 digit phone", () => {
  assert.equal(extractPhone("(11) 98888-7777"), "11988887777");
  assert.equal(extractPhone("21 3333-4444"), "2133334444");
  assert.equal(extractPhone("apenas texto"), undefined);
});

test("extractName uses agent question heuristic when buyer reply is short", () => {
  const lastAgent = "Antes de continuar, posso saber seu nome completo?";
  assert.equal(extractName("Joao Silva", lastAgent), "Joao Silva");
  assert.equal(extractName("é joao silva", lastAgent), "Joao Silva");
  assert.equal(extractName("meu cpf é 12345678909", lastAgent), undefined);
  assert.equal(extractName("Joao Silva", "qual seu cpf?"), undefined);
  assert.equal(extractName("a".repeat(120), lastAgent), undefined);
});

test("deriveChatStage walks data_collection -> shipping -> payment -> completed", () => {
  const empty = checkoutSession();
  assert.equal(deriveChatStage(empty), "data_collection");

  const withCustomer = checkoutSession({
    customer: {
      fullName: "Joao",
      email: "j@x.com",
      cpf: "12345678901",
      phone: "11988887777"
    }
  });
  assert.equal(deriveChatStage(withCustomer), "shipping");

  const withShipping = checkoutSession({
    customer: {
      fullName: "Joao",
      email: "j@x.com",
      cpf: "12345678901",
      phone: "11988887777",
      address: { zip: "01001000" }
    },
    shipping: { customerPrice: 29.9, region: "SP" }
  });
  assert.equal(deriveChatStage(withShipping), "payment");

  const ready = checkoutSession({
    customer: withShipping.customer,
    shipping: withShipping.shipping,
    paymentMethod: "pix"
  });
  assert.equal(deriveChatStage(ready), "completed");
});

test("missingFieldsForStage lists user-facing labels for each stage in order", () => {
  const empty = checkoutSession({ customer: {} });
  assert.deepEqual(missingFieldsForStage(empty, "data_collection"), [
    "nome",
    "email",
    "CPF",
    "telefone"
  ]);

  const withName = checkoutSession({
    customer: { fullName: "Joao" }
  });
  assert.deepEqual(missingFieldsForStage(withName, "data_collection"), [
    "email",
    "CPF",
    "telefone"
  ]);

  const ready = checkoutSession({
    customer: {
      fullName: "Joao",
      email: "j@x.com",
      cpf: "12345678901",
      phone: "11988887777"
    },
    shipping: undefined
  });
  assert.deepEqual(missingFieldsForStage(ready, "shipping"), ["CEP", "entrega"]);

  const withShipping = checkoutSession({
    customer: ready.customer,
    shipping: { customerPrice: 29.9 }
  });
  assert.deepEqual(missingFieldsForStage(withShipping, "payment"), ["forma de pagamento"]);
});
