import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { createSendChatUseCase } from "../application/use-cases/send-chat-message.fixture.js";
import { ChatLlmGatewayService } from "../application/services/chat-llm-gateway.service.js";
import { SafeAuthorizedOffer } from "../domain/types/safe-authorized-offer.js";

// Real routing, prompt builder and response persistence; controlled provider and
// preprocessed customer/shipping state, without OTP/payment/catalog effects.
for (const total of [100, 42.5, 0]) test(`main chat sends the BRL amount ${total} to its gateway`, async () => {
  const { response, prompts, calls } = await run(total);
  assert.equal(calls, 1);
  assert.match(prompts[0], new RegExp(`Carrinho: R\\$${total.toFixed(2).replace(".", "\\.")}(?:\\n|$)`));
  assert.match(prompts[0], /ETAPA ATUAL: payment/);
  assert.equal(response.message, "Posso explicar esta etapa.");
  assert.equal(response.turns.length, 2);
});

test("main chat avoids provider I/O for invalid or non-BRL cart context", async () => {
  for (const [total, currency] of [[1.001, "BRL"], [-1, "BRL"], [100, "USD"]] as const) {
    const { response, calls } = await run(total, currency);
    assert.equal(calls, 0);
    assert.equal(response.message, "Confira os dados do pedido.");
  }
});

async function run(total: number, currency = "BRL") {
  const repo = new InMemoryCheckoutRepository();
  const snapshot = checkoutSession({ cohort: "treatment", customer: { fullName: "Fixture Buyer", email: "fixture@example.invalid",
    email_verified: true, cpf: "52998224725", phone: "11987654321", address_verified: true,
    address: { zip: "01001000", street: "Fixture Street", number: "1", complement: "", city: "Sao Paulo", state: "SP" } } });
  snapshot.cart = { ...snapshot.cart, total, currency: currency as any };
  await repo.saveSession(snapshot);
  const prompts: string[] = [];
  let calls = 0;
  const gateway = new ChatLlmGatewayService();
  gateway.call = async messages => { calls++; prompts.push(messages[0].content); return { content: "Posso explicar esta etapa.", toolCalls: [] }; };
  const useCase = createSendChatUseCase(repo, {
    conversation: { async reply() { return { message: "Confira os dados do pedido.", objection: "unknown" }; } } as any,
    customerService: { async correctCustomerInput() {}, async processCustomerInput(session: unknown) { return session; } } as any,
    shippingService: { async processShippingState(session: unknown) { return session; }, summarizeDelivery() {} } as any,
    offerService: { async authorizeOffer() { return SafeAuthorizedOffer.noOffer(snapshot.merchantId, snapshot.sessionId); } } as any,
    chatLlmGateway: gateway,
    chatToolExecutor: { async executeToolCalls() { throw new Error("UNEXPECTED_TOOL"); } } as any,
  });
  const response = await useCase.execute({ merchant_id: snapshot.merchantId, session_id: snapshot.sessionId,
    conversation_id: snapshot.conversationId, user_message: "Explique esta etapa" });
  return { response, prompts, calls };
}
