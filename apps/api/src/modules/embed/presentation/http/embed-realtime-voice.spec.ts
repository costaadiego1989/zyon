import assert from "node:assert/strict";
import test from "node:test";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { checkoutVoicePrompt } from "./embed-realtime-voice.controller.js";

test("new checkout asks for the next field instead of presenting the storefront", () => {
  const session = checkoutSession({ customer: undefined });
  assert.match(checkoutVoicePrompt(session), /celular com DDD/);
  assert.doesNotMatch(checkoutVoicePrompt(session), /Olá|Sou|Zion|A partir/);
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
