import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext } from "@aacp/shared-types";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { startCheckoutRequest } from "../../__tests__/checkout-test-fixtures.js";
import { StartCheckoutUseCase } from "./start-checkout.use-case.js";
import { SendChatMessageUseCase } from "./send-chat-message.use-case.js";

class RecordingConversationPort implements ConversationPort {
  calls: Parameters<ConversationPort["reply"]>[0][] = [];

  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    this.calls.push(input);
    return {
      message: input.agentContext?.agent.agentName ?? "default reply",
      objection: "price" as const
    };
  }
}

class FakeAgentContextPort implements AgentContextPort {
  calls: Parameters<AgentContextPort["get"]>[0][] = [];

  constructor(private readonly context?: AgentContext) {}

  async get(input: Parameters<AgentContextPort["get"]>[0]) {
    this.calls.push(input);
    return this.context;
  }
}

test("SendChatMessageUseCase passes merchant agent context to conversation without authorizing from capabilities", async () => {
  const repository = new InMemoryCheckoutRepository();
  const started = await new StartCheckoutUseCase(repository).execute(startCheckoutRequest({ session_id: "chk_1" }));
  const conversation = new RecordingConversationPort();
  const agentContext = new FakeAgentContextPort(testAgentContext());
  const useCase = new SendChatMessageUseCase(repository, conversation, agentContext);

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    conversation_id: "conv_1",
    user_message: "esta caro, quero 90% de desconto",
    agent_id: "closer-1"
  });

  assert.equal(agentContext.calls[0]?.merchantId, "mrc_1");
  assert.equal(agentContext.calls[0]?.agentId, "closer-1");
  assert.equal(agentContext.calls[0]?.globalUserId, started.global_user_id);
  assert.equal(conversation.calls[0]?.agentContext?.agent.agentName, "Nina");
  assert.notEqual(response.authorized_offer?.value, 90);
  assert.equal((response.authorized_offer?.value ?? 0) <= 10, true);
});

test("SendChatMessageUseCase remains compatible when agent context is not configured", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository).execute(startCheckoutRequest({ session_id: "chk_1" }));
  const conversation = new RecordingConversationPort();
  const useCase = new SendChatMessageUseCase(repository, conversation);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    conversation_id: "conv_1",
    user_message: "frete caro"
  });

  assert.equal(conversation.calls[0]?.agentContext, undefined);
  assert.equal(conversation.calls[0]?.authorizedOffer instanceof Object, true);
});

test("SendChatMessageUseCase extracts email/CPF/phone/CEP and patches session.customer", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository).execute(
    startCheckoutRequest({ session_id: "chk_extract", customer: undefined, shipping: undefined })
  );
  const conversation = new RecordingConversationPort();
  const useCase = new SendChatMessageUseCase(repository, conversation);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_extract",
    conversation_id: "conv_x",
    user_message: "Meu email é JOAO@ex.com, CPF 123.456.789-09, fone (11) 98888-7777, CEP 01001-000"
  });

  const session = await repository.getSession("mrc_1", "chk_extract");
  assert.equal(session?.customer?.email, "joao@ex.com");
  assert.equal(session?.customer?.cpf, "12345678909");
  assert.equal(session?.customer?.phone, "11988887777");
  assert.equal(session?.customer?.address?.zip, "01001000");
  assert.equal(conversation.calls[0]?.stage, "data_collection");
});

test("SendChatMessageUseCase captures fullName when previous agent turn asked for the name", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository).execute(
    startCheckoutRequest({ session_id: "chk_name", customer: undefined })
  );
  await repository.appendChatTurn("mrc_1", "chk_name", {
    role: "agent",
    text: "Antes de continuar, posso saber seu nome completo?",
    occurredAt: new Date().toISOString()
  });
  const conversation = new RecordingConversationPort();
  const useCase = new SendChatMessageUseCase(repository, conversation);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_name",
    conversation_id: "conv_name",
    user_message: "Joao Silva"
  });

  const session = await repository.getSession("mrc_1", "chk_name");
  assert.equal(session?.customer?.fullName, "Joao Silva");
});

test("SendChatMessageUseCase returns refreshed experience snapshot with stage and missing fields", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository).execute(
    startCheckoutRequest({ session_id: "chk_exp", customer: undefined })
  );
  const conversation = new RecordingConversationPort();
  const useCase = new SendChatMessageUseCase(repository, conversation);

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_exp",
    conversation_id: "conv_exp",
    user_message: "joao@ex.com"
  });

  assert.ok(response.experience, "experience snapshot returned");
  assert.equal(response.experience?.totals.currency, "BRL");
  assert.equal(response.experience?.customer?.email, "joao@ex.com");
  assert.equal(response.stage, "data_collection");
  assert.ok(response.missing_fields && response.missing_fields.length > 0);
});

test("SendChatMessageUseCase appends buyer + agent turns and forwards history", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository).execute(startCheckoutRequest({ session_id: "chk_h" }));
  const conversation = new RecordingConversationPort();
  const useCase = new SendChatMessageUseCase(repository, conversation);

  const first = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_h",
    conversation_id: "conv_1",
    user_message: "esta caro"
  });
  const second = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_h",
    conversation_id: "conv_1",
    user_message: "ainda caro"
  });

  assert.equal(first.turns.length, 2, "first call: buyer + agent turn appended");
  assert.equal(first.turns[0]?.role, "buyer");
  assert.equal(first.turns[1]?.role, "agent");
  assert.equal(second.turns.length, 4);
  assert.equal(conversation.calls[1]?.history?.length, 2, "second call gets history of previous round");
  assert.ok(conversation.calls[1]?.cart, "cart forwarded to engine");
});

function testAgentContext(): AgentContext {
  return {
    merchant_id: "mrc_1",
    agent_id: "closer-1",
    agent: {
      agentName: "Nina",
      persona: "checkout sales agent",
      tone: "consultative",
      language: "pt-BR",
      greeting: "Oi, posso ajudar a finalizar com seguranca."
    },
    capabilities: {
      priceObjectionHandling: true,
      shippingObjectionHandling: true,
      trustReassurance: true,
      paymentFrictionGuidance: true,
      escalation: true,
      machineToMachineNegotiation: true
    },
    guardrails: {
      forbidUnauthorizedDiscounts: true,
      forbidUnauthorizedFreeShipping: true,
      forbidDeliveryPromisesWithoutSource: true,
      forbidStockPromisesWithoutSource: true,
      forbidPaymentStatusClaims: true,
      forbidLegalMedicalFinancialAdvice: true,
      forbidAbusivePressure: true,
      blockedPhrases: [],
      requiredDisclaimers: ["Ofertas dependem das regras autorizadas da loja."],
      escalationTriggers: ["pedido fora da politica"]
    },
    checkout_settings: {
      agentMode: "silent_until_trigger",
      openWidgetOnTrigger: true,
      cooldownSeconds: 120,
      maxInterventionsPerSession: 3,
      triggerPreferences: ["coupon_field_clicked"],
      handoffEnabled: true
    },
    copy_constraints: ["Mention offers only when authorized by deterministic modules."]
  };
}
