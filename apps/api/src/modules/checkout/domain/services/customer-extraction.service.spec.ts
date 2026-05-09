import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveChatStage,
  extractAddressDetailLine,
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
      email_verified: true,
      cpf: "12345678901",
      phone: "11988887777"
    }
  });
  assert.equal(deriveChatStage(withCustomer), "shipping");

  const withZipOnly = checkoutSession({
    customer: {
      ...withCustomer.customer!,
      address: { zip: "01001000" }
    },
    shipping: { customerPrice: 29.9, region: "SP" }
  });
  assert.equal(deriveChatStage(withZipOnly), "shipping");

  const addrReadyNoNumber = checkoutSession({
    customer: {
      ...withCustomer.customer!,
      address: {
        zip: "01001000",
        street: "Praça da Sé",
        city: "São Paulo",
        state: "SP"
      }
    },
    shipping: { customerPrice: 29.9, region: "SP" }
  });
  assert.equal(deriveChatStage(addrReadyNoNumber), "shipping");

  const addrComplete = checkoutSession({
    customer: {
      ...withCustomer.customer!,
      address: {
        zip: "01001000",
        street: "Rua Augusta",
        number: "100",
        complement: "",
        city: "São Paulo",
        state: "SP"
      }
    },
    shipping: { customerPrice: 29.9, region: "SP" }
  });
  assert.equal(deriveChatStage(addrComplete), "payment");

  const ready = checkoutSession({
    customer: addrComplete.customer,
    shipping: addrComplete.shipping,
    paymentMethod: "pix"
  });
  assert.equal(deriveChatStage(ready), "completed");
});

test("missingFieldsForStage lists user-facing labels for each stage in order", () => {
  const empty = checkoutSession({ customer: {} });
  assert.deepEqual(missingFieldsForStage(empty, "data_collection"), ["nome", "email", "código de verificação", "CPF", "telefone"]);

  const withName = checkoutSession({
    customer: { fullName: "Joao" }
  });
  assert.deepEqual(missingFieldsForStage(withName, "data_collection"), ["email", "código de verificação", "CPF", "telefone"]);

  const readyCadastro = checkoutSession({
    customer: {
      fullName: "Joao",
      email: "j@x.com",
      email_verified: true,
      cpf: "12345678901",
      phone: "11988887777"
    }
  });
  assert.deepEqual(missingFieldsForStage(readyCadastro, "shipping"), ["CEP"]);

  const cepOnly = checkoutSession({
    customer: {
      ...readyCadastro.customer!,
      address: { zip: "01001000" }
    }
  });
  assert.deepEqual(missingFieldsForStage(cepOnly, "shipping"), ["confirmar CEP"]);

  const stroked = checkoutSession({
    customer: {
      ...readyCadastro.customer!,
      address: {
        zip: "01001000",
        street: "Rua X",
        city: "São Paulo",
        state: "SP"
      }
    }
  });
  assert.deepEqual(missingFieldsForStage(stroked, "shipping"), ["número"]);

  const numberedNoQuote = checkoutSession({
    customer: {
      ...readyCadastro.customer!,
      address: {
        zip: "01001000",
        street: "Rua X",
        number: "10",
        city: "São Paulo",
        state: "SP"
      }
    },
    shipping: undefined
  });
  assert.deepEqual(missingFieldsForStage(numberedNoQuote, "shipping"), ["complemento (ou responda que não tem)"]);

  const readyNoQuote = checkoutSession({
    customer: {
      ...numberedNoQuote.customer!,
      address: {
        ...numberedNoQuote.customer!.address!,
        complement: ""
      }
    },
    shipping: undefined
  });
  assert.deepEqual(missingFieldsForStage(readyNoQuote, "shipping"), ["frete"]);

  const withShipping = checkoutSession({
    customer: readyNoQuote.customer,
    shipping: { customerPrice: 29.9 }
  });
  assert.deepEqual(missingFieldsForStage(withShipping, "payment"), ["forma de pagamento"]);
});

test("extractAddressDetailLine strips CEP and parses number with optional complement", () => {
  assert.deepEqual(extractAddressDetailLine("42, apto 12 bloco sul"), {
    number: "42",
    complement: "apto 12 bloco sul"
  });
  assert.deepEqual(extractAddressDetailLine("120 / Torre Alfa"), {
    number: "120",
    complement: "Torre Alfa"
  });
  assert.deepEqual(extractAddressDetailLine("99"), {
    number: "99",
    complement: undefined
  });
  assert.deepEqual(extractAddressDetailLine("s/n"), { number: "S/N", complement: undefined });
  assert.deepEqual(extractAddressDetailLine("sem numero"), { number: "S/N", complement: undefined });
  assert.equal(extractAddressDetailLine("somente texto"), null);
});
