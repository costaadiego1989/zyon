import test from "node:test";
import assert from "node:assert/strict";
import { chatPaymentSelection } from "./chat-payment-selection.js";

test("payment routing preserves methods and priority used by the response builder", () => {
  for (const [message, method] of [["PIX", "pix"], ["qr code", "pix"], ["cartão", "credit_card"],
    ["credito", "credit_card"], ["boleto", "boleto"], ["USDC", "crypto"], ["carteira", "crypto"],
    ["pix ou boleto", "pix"], ["cartao ou usdt", "credit_card"], ["boleto ou crypto", "boleto"],
    ["Explique esta etapa", undefined]] as const) {
    assert.equal(chatPaymentSelection(message, "payment"), method, message);
  }
});

test("payment routing cannot select a method in another stage or when explicitly suppressed", () => {
  assert.equal(chatPaymentSelection("pix", "data_collection"), undefined);
  assert.equal(chatPaymentSelection("cartao", "shipping"), undefined);
  assert.equal(chatPaymentSelection("boleto", "payment", true), undefined);
});
