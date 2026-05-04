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
