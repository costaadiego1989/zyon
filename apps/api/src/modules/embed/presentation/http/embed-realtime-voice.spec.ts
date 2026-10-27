import assert from "node:assert/strict";
import test from "node:test";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { checkoutVoicePrompt, EmbedRealtimeVoiceController } from "./embed-realtime-voice.controller.js";

test("new checkout asks for the next field instead of presenting the storefront", () => {
  const session = checkoutSession({ customer: undefined });
  assert.match(checkoutVoicePrompt(session), /celular com DDD/);
  assert.match(checkoutVoicePrompt(session), /enviaremos um código/);
  assert.doesNotMatch(checkoutVoicePrompt(session), /acesso (?:é|está) confirmado/);
  assert.doesNotMatch(checkoutVoicePrompt(session), /Olá|Sou|Zion|A partir/);
});

function readySession() {
  return checkoutSession({ customer: { fullName: "QA Buyer", email: "qa@example.test", email_verified: true,
    phone: "11987654321", cpf: "52998224725", address_verified: true,
    address: { zip: "01310100", street: "Paulista", city: "São Paulo", state: "SP", number: "100", complement: "" } },
    chatHistory: [{ role: "buyer", text: "Vamos prosseguir", occurredAt: new Date().toISOString() },
      { role: "agent", text: "Escolha como prefere receber. Qual frete prefere?", occurredAt: new Date().toISOString() }] });
}

test("quick purchase resumes the current payment, ignoring an obsolete shipping question", () => {
  const session = readySession();
  assert.match(checkoutVoicePrompt(session), /endereço e frete já estão definidos/);
  assert.doesNotMatch(checkoutVoicePrompt(session), /Qual frete|prefere receber/);
  session.paymentMethod = "pix";
  assert.match(checkoutVoicePrompt(session), /pagamento já está disponível/);
  assert.doesNotMatch(checkoutVoicePrompt(session), /Qual frete|Como deseja pagar|confirmado|pago/);
  session.paymentMethod = "credit_card";
  assert.match(checkoutVoicePrompt(session), /pagamento já está disponível/);
});

test("an address edit resumes CEP instead of repeating the old payment or shipping prompt", () => {
  const session = readySession();
  session.customer!.address = undefined;
  session.customer!.address_verified = false;
  session.shipping = undefined;
  assert.equal(checkoutVoicePrompt(session), "Qual é o CEP de entrega?");
});

test("refreshing voice context checks the merchant boundary and does not issue another provider secret", async () => {
  const session = readySession(); session.paymentMethod = "pix";
  const checks: string[] = [];
  const controller = new EmbedRealtimeVoiceController({
    assertSessionBelongsToEmbedMerchant: async (claims: { merchantId: string }, id: string) => { checks.push(`${claims.merchantId}:${id}`); },
    loadSession: async () => session,
  } as never, { assertAllowed: async () => {} } as never, { createClientSecret: async () => { throw new Error("must not create a new session"); } } as never);
  const context = await controller.currentContext({ embedClaims: { merchantId: "mrc_1" } } as never, { session_id: "chk_1" });
  assert.deepEqual(checks, ["mrc_1:chk_1"]);
  assert.match(context.instructions, /ETAPA ATUAL.*pagamento já está disponível/);
  await assert.rejects(() => controller.currentContext({} as never, { session_id: "" }));
});

test("voice reconnection resumes a pending correction without speaking its author prefix", () => {
  const session = checkoutSession({ chatHistory: [
    { role: "buyer", text: "Meu e-mail está errado", occurredAt: new Date().toISOString() },
    { role: "agent", text: "Zion: Qual é o e-mail correto para este pedido?", occurredAt: new Date().toISOString() },
  ] });
  assert.equal(checkoutVoicePrompt(session), "Qual é o e-mail correto para este pedido?");
  session.chatHistory[1]!.text = "Olá! Sou sua assistente. A partir de agora vou encontrar produtos.";
  assert.doesNotMatch(checkoutVoicePrompt(session), /Olá|Sou|A partir/);
});
