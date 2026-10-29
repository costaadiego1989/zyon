import test from "node:test";
import assert from "node:assert/strict";
import { smartFallback } from "./support-fallback.service.js";

const DEFAULT_REPLY = "Entendo sua dúvida. Nossa equipe responde em até 24h — envie um e-mail para o suporte da loja.";

test("smartFallback routes shipping keywords to the freight reply", () => {
  assert.equal(smartFallback("Qual o prazo de entrega?").startsWith("Para dúvidas sobre frete"), true);
  assert.equal(smartFallback("Como funciona o rastreamento?").startsWith("Para dúvidas sobre frete"), true);
  assert.equal(smartFallback("Posso alterar o frete?").startsWith("Para dúvidas sobre frete"), true);
});

test("smartFallback routes returns keywords to the returns reply", () => {
  assert.equal(smartFallback("Quero fazer uma troca de produto").startsWith("Trocas e devoluções"), true);
  assert.equal(smartFallback("Posso cancelar o pedido?").startsWith("Trocas e devoluções"), true);
  assert.equal(smartFallback("Como pedir reembolso?").startsWith("Trocas e devoluções"), true);
});

test("smartFallback routes payment keywords to the payment reply", () => {
  assert.equal(smartFallback("Meu cartão foi recusado").startsWith("Para problemas com pagamento"), true);
  assert.equal(smartFallback("Posso pagar com PIX?").startsWith("Para problemas com pagamento"), true);
  assert.equal(smartFallback("Pagar com boleto é seguro?").startsWith("Para problemas com pagamento"), true);
});

test("smartFallback routes product/stock keywords to the product reply", () => {
  assert.equal(smartFallback("O produto está disponível?").startsWith("Para informações sobre disponibilidade"), true);
  assert.equal(smartFallback("Quando esse item volta ao estoque?").startsWith("Para informações sobre disponibilidade"), true);
});

test("smartFallback routes discount keywords to the coupon reply", () => {
  assert.equal(smartFallback("Tenho um cupom de desconto").startsWith("Cupons são aplicados"), true);
  assert.equal(smartFallback("Como funciona a promoção da loja?").startsWith("Cupons são aplicados"), true);
});

test("smartFallback routes account keywords to the account reply", () => {
  assert.equal(smartFallback("Esqueci minha senha de acesso").startsWith("Para problemas de acesso à conta"), true);
  assert.equal(smartFallback("Não consigo fazer login").startsWith("Para problemas de acesso à conta"), true);
});

test("smartFallback uses the default reply when no pattern matches", () => {
  assert.equal(smartFallback("Como vocês estão hoje?"), DEFAULT_REPLY);
  assert.equal(smartFallback(""), DEFAULT_REPLY);
});

test("smartFallback is case-insensitive", () => {
  assert.equal(smartFallback("PIX É SEGURO?").startsWith("Para problemas com pagamento"), true);
});
