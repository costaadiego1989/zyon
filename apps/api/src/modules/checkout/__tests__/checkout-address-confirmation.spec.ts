import assert from "node:assert/strict";
import test from "node:test";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { DeterministicConversationAdapter } from "../infrastructure/adapters/deterministic-conversation.adapter.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../application/services/checkout-offer.service.js";
import { ChatLlmGatewayService } from "../application/services/chat-llm-gateway.service.js";
import { ChatToolExecutorService } from "../application/services/chat-tool-executor.service.js";
import { createSendChatUseCase } from "../application/use-cases/send-chat-message.fixture.js";

function setup(number?: string) {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({
    shipping: undefined,
    customer: {
      fullName: "Maria Silva", email: "buyer@example.com", email_verified: true,
      cpf: "52998224725", phone: "11987654321",
      address: { zip: "01310100", street: "Avenida Paulista", city: "São Paulo", state: "SP", number },
    },
  }));
  const customerService = new CheckoutCustomerService(repository);
  const gateway = new ChatLlmGatewayService();
  let llmCalls = 0;
  gateway.call = async () => {
    llmCalls += 1;
    return { content: "Olá! Como posso te ajudar hoje?", toolCalls: [] };
  };
  const useCase = createSendChatUseCase(repository, {
    conversation: new DeterministicConversationAdapter(),
    customerService,
    shippingService: new CheckoutShippingService(repository, customerService),
    offerService: new CheckoutOfferService(repository),
    chatLlmGateway: gateway,
    chatToolExecutor: new ChatToolExecutorService(),
  });
  const send = (user_message: string) => useCase.execute({
    merchant_id: "mrc_1", session_id: "chk_1", conversation_id: "conv_1", user_message,
  });
  return { repository, send, llmCalls: () => llmCalls };
}

test("CEP confirmation keeps number, complement and shipping in the checkout flow with an LLM configured", async () => {
  const { repository, send, llmCalls } = setup();
  const confirmation = await send("01310100");
  assert.deepEqual(confirmation.missing_fields, ["confirmar endereço"]);
  assert.match(confirmation.message, /Está correto/);

  const number = await send("sim");
  assert.equal(repository.getSession("mrc_1", "chk_1")?.customer?.address_verified, true);
  assert.deepEqual(number.missing_fields, ["número"]);
  assert.match(number.message, /número/);
  assert.doesNotMatch(number.message, /Como posso te ajudar/);

  const complement = await send("100");
  assert.deepEqual(complement.missing_fields, ["complemento (ou responda que não tem)"]);
  assert.match(complement.message, /complemento/);
  const shipping = await send("sem complemento");
  assert.deepEqual(shipping.missing_fields, ["frete"]);
  assert.match(shipping.message, /opções de frete/);
  assert.equal(llmCalls(), 0, "required checkout fields must not be routed to a context-free LLM");

  const payment = await send("Quero PAC");
  assert.equal(payment.stage, "payment");
  assert.match(payment.message, /pagar/);
  assert.equal(llmCalls(), 0);
  assert.equal(repository.getSession("mrc_1", "chk_1")?.paymentMethod, undefined);
});

test("confirming an address with a saved number does not store sim as the complement", async () => {
  const { repository, send } = setup("100");
  const response = await send("Sim!");
  assert.deepEqual(response.missing_fields, ["complemento (ou responda que não tem)"]);
  assert.equal(repository.getSession("mrc_1", "chk_1")?.customer?.address?.complement, undefined);
});

test("spoken confirmations and rejection preserve the address transition", async () => {
  for (const reply of ["confirmo", "certo", "isso", "é esse", "esse mesmo"]) {
    const { repository, send } = setup();
    const response = await send(reply);
    assert.deepEqual(response.missing_fields, ["número"], reply);
    assert.equal(repository.getSession("mrc_1", "chk_1")?.customer?.address_verified, true);
  }
  const { repository, send } = setup();
  const response = await send("não");
  assert.deepEqual(response.missing_fields, ["CEP"]);
  assert.equal(repository.getSession("mrc_1", "chk_1")?.customer?.address?.zip, undefined);
});
