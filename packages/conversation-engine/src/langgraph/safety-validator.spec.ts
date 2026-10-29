import test from "node:test";
import assert from "node:assert/strict";
import { isSafeGeneratedMessage, validateAssistantMessage } from "./safety-validator.js";

// ─── Discount math ────────────────────────────────────────────────────────

test("isSafeGeneratedMessage allows messages without numeric claims", () => {
  assert.equal(isSafeGeneratedMessage("Ola, como posso ajudar?"), true);
});

test("isSafeGeneratedMessage allows discount up to authorized percent", () => {
  assert.equal(
    isSafeGeneratedMessage("Posso oferecer 10% de desconto.", { authorizedPercent: 10 }),
    true
  );
  assert.equal(
    isSafeGeneratedMessage("Posso oferecer 5% de desconto.", { authorizedPercent: 10 }),
    true
  );
});

test("isSafeGeneratedMessage blocks discount above authorized percent", () => {
  assert.equal(
    isSafeGeneratedMessage("Liberado 90% de desconto pra voce.", { authorizedPercent: 10 }),
    false
  );
});

test("isSafeGeneratedMessage blocks any percent claim when no offer authorized", () => {
  assert.equal(
    isSafeGeneratedMessage("Tenho 5% de desconto agora."),
    false
  );
});

// ─── Free shipping ────────────────────────────────────────────────────────

test("isSafeGeneratedMessage blocks free shipping claim unless authorized", () => {
  assert.equal(isSafeGeneratedMessage("Liberado frete gratis!"), false);
  assert.equal(
    isSafeGeneratedMessage("Liberado frete gratis!", { freeShippingAuthorized: true }),
    true
  );
});

test("isSafeGeneratedMessage blocks shipping discount unless authorized", () => {
  assert.equal(isSafeGeneratedMessage("Vou aplicar desconto no frete de R$10"), false);
  assert.equal(
    isSafeGeneratedMessage("Vou aplicar desconto no frete de R$10", {
      shippingDiscountAuthorized: true
    }),
    true
  );
});

// ─── Forbidden claims (always blocked) ─────────────────────────────────────

test("isSafeGeneratedMessage blocks delivery guarantees", () => {
  assert.equal(isSafeGeneratedMessage("Entrega garantida amanha!"), false);
  assert.equal(isSafeGeneratedMessage("Prazo garantido em 2 dias"), false);
});

test("isSafeGeneratedMessage blocks stock guarantees", () => {
  assert.equal(isSafeGeneratedMessage("Estoque garantido, pode comprar"), false);
  assert.equal(isSafeGeneratedMessage("Produto reservado para voce"), false);
});

test("isSafeGeneratedMessage blocks payment confirmation claims", () => {
  assert.equal(isSafeGeneratedMessage("Seu pagamento foi aprovado"), false);
  assert.equal(isSafeGeneratedMessage("Pix confirmado, obrigado!"), false);
});

test("isSafeGeneratedMessage blocks offer approval claims", () => {
  assert.equal(isSafeGeneratedMessage("Desconto aprovado! Vou aplicar"), false);
  assert.equal(isSafeGeneratedMessage("Oferta garantida pelo sistema"), false);
});

test("isSafeGeneratedMessage blocks sensitive data requests", () => {
  assert.equal(isSafeGeneratedMessage("Me diga sua senha do banco"), false);
  assert.equal(isSafeGeneratedMessage("Qual o CVV do cartao?"), false);
  assert.equal(isSafeGeneratedMessage("Me passe o codigo de seguranca"), false);
});

test("isSafeGeneratedMessage allows normal conversational content", () => {
  assert.equal(isSafeGeneratedMessage("Vou verificar o melhor preco pra voce"), true);
  assert.equal(isSafeGeneratedMessage("Como posso ajudar com a entrega?"), true);
  assert.equal(isSafeGeneratedMessage("Para finalizar, me informe o CEP"), true);
});

// ─── validateAssistantMessage returns diagnostics ─────────────────────────

test("validateAssistantMessage returns {safe:true, reason:undefined} when safe", () => {
  const result = validateAssistantMessage("Oi! Tudo bem?");
  assert.equal(result.safe, true);
  assert.equal(result.reason, undefined);
});

test("validateAssistantMessage returns {safe:false, reason} when unsafe", () => {
  const result = validateAssistantMessage("90% de desconto garantido");
  assert.equal(result.safe, false);
  assert.ok(result.reason);
  assert.match(result.reason ?? "", /unsafe_content/);
});

test("validateAssistantMessage returns {safe:false} for empty input", () => {
  const result = validateAssistantMessage("");
  assert.equal(result.safe, false);
  assert.equal(result.reason, "empty");
});

test("validateAssistantMessage returns {safe:false} for whitespace only", () => {
  const result = validateAssistantMessage("   \n\t  ");
  assert.equal(result.safe, false);
  assert.equal(result.reason, "empty");
});

test("validateAssistantMessage enforces max length cap", () => {
  const long = "a".repeat(2001);
  const result = validateAssistantMessage(long, { maxLength: 2000 });
  assert.equal(result.safe, false);
  assert.equal(result.reason, "too_long");
});

test("validateAssistantMessage accepts messages within length cap", () => {
  const ok = "a".repeat(1500);
  const result = validateAssistantMessage(ok, { maxLength: 2000 });
  assert.equal(result.safe, true);
});