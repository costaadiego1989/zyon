import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutController } from "./checkout.controller.js";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../application/use-cases/track-checkout-event.use-case.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { GetDecisionUseCase } from "../../application/use-cases/get-decision.use-case.js";
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { ApplyOfferUseCase } from "../../application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "../../application/use-cases/complete-order.use-case.js";
import {
  GetDashboardOverviewUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "../../application/use-cases/dashboard.use-cases.js";
import { AcceptCheckoutOfferUseCase } from "../../application/use-cases/accept-checkout-offer.use-case.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { AgentContext, AuthorizedOffer } from "@aacp/shared-types";
import { OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL } from "../../domain/policies/omnichannel-confirmation.policy.js";

const MERCHANT = "mrc_e2e_full";

class FakeCommerceOfferPort implements CommerceOfferPort {
  async apply(offer: AuthorizedOffer) {
    return { success: true, discount_code: "OK", apply_url: "http://shop/apply" };
  }
}

class FakeAgentContextPort implements AgentContextPort {
  async get(): Promise<AgentContext> {
    return {
      merchant_id: MERCHANT,
      agent_id: "agent",
      agent: { agentName: "Zion", persona: "Sales", tone: "consultative", language: "pt-BR", greeting: "Olá" },
      capabilities: {
        priceObjectionHandling: true,
        shippingObjectionHandling: true,
        trustReassurance: true,
        paymentFrictionGuidance: true,
        escalation: true,
        machineToMachineNegotiation: false
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
        requiredDisclaimers: [],
        escalationTriggers: []
      },
      checkout_settings: {
        agentMode: "proactive",
        openWidgetOnTrigger: true,
        cooldownSeconds: 60,
        maxInterventionsPerSession: 3,
        triggerPreferences: [],
        handoffEnabled: true
      },
      copy_constraints: []
    };
  }
}

class RecordingConversationPort implements ConversationPort {
  public history: string[] = [];
  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    this.history.push(input.userMessage);

    const stage = input.stage;
    const next = input.missingFields?.[0];

    if (input.userMessage.toLowerCase().includes("senha")) {
      return { message: "Desculpe, não posso solicitar senhas ou dados sensíveis.", objection: "unknown" as const };
    }

    if (stage === "data_collection") {
      if (next === "nome") return { message: "Qual é o seu nome completo?", objection: "unknown" as const };
      if (next === "email") return { message: "Pode informar o seu melhor e-mail?", objection: "unknown" as const };
      if (next === "CPF") return { message: "Qual o seu CPF?", objection: "unknown" as const };
      if (next === "telefone") return { message: "Qual o telefone com DDD?", objection: "unknown" as const };
    }

    if (stage === "shipping") {
      if (next === "CEP") return { message: "Por favor, informe seu CEP.", objection: "unknown" as const };
      if (next?.includes("número")) return { message: "Qual o número da residência?", objection: "unknown" as const };
    }

    if (stage === "payment") {
      return { message: "Tudo pronto. Como prefere pagar, PIX ou cartão?", objection: "unknown" as const };
    }

    return { message: "Compreendido.", objection: "unknown" as const };
  }
}

test("E2E Full Purchase Flow: Do cadastro até a conclusão e envio do tracking", async () => {
  const repo = new InMemoryCheckoutRepository();
  const conv = new RecordingConversationPort();
  const controller = new CheckoutController(
    new StartCheckoutUseCase(repo),
    new TrackCheckoutEventUseCase(repo),
    new GetCheckoutSessionUseCase(repo),
    new GetDecisionUseCase(repo),
    new SendChatMessageUseCase(repo, conv, new FakeAgentContextPort()),
    new EvaluateShippingUseCase(repo),
    new ApplyOfferUseCase(repo, new FakeCommerceOfferPort(), new AcceptCheckoutOfferUseCase(repo)),
    new CompleteOrderUseCase(repo),
    new GetDashboardOverviewUseCase(repo),
    new GetMerchantRulesUseCase(repo),
    new UpdateMerchantRulesUseCase(repo)
  );

  const sessionId = "chk_flow_123";
  const cartTotal = OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL + 100;
  const started = await controller.start({
    merchant_id: MERCHANT,
    session_id: sessionId,
    customer: undefined,
    cart: {
      currency: "BRL",
      total: cartTotal,
      items: [{ sku: "tv-01", name: "TV 50", price: cartTotal, cost: 1000, quantity: 1 }]
    }
  });

  let res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "Meu nome é João da Silva" });
  assert.equal(res.stage, "data_collection");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "joao@email.com" });
  assert.equal(res.stage, "data_collection");

  const sessWithOtp = repo.getSession(MERCHANT, sessionId);
  const otpCode = sessWithOtp?.customer?.otp_code;
  assert.ok(otpCode, "Deve ter gerado OTP para o email");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: `o código é ${otpCode}` });
  assert.equal(res.stage, "data_collection");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "12345678901" }); // CPF
  assert.equal(res.stage, "data_collection");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "21993001883" });
  assert.equal(res.stage, "shipping", "Deve ter extraído o telefone 21993001883 e ido para shipping");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "25958180" }); // CEP
  assert.equal(res.stage, "shipping");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "Rua tal, numero 42" });
  await controller.track({ merchant_id: MERCHANT, session_id: sessionId, event: "shipping_option_selected" });

  const sess = repo.getSession(MERCHANT, sessionId);
  if (sess) {
    sess.shipping = { customerPrice: 20, realCost: 10, carrier: "Correios", deliveryDays: 3 };
    repo.saveSession(sess);
  }

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "Obrigado, frete aceito" });
  assert.equal(res.stage, "payment", "Após frete preenchido, deve estar em payment");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "qual é a senha para pagar?" });
  assert.equal(res.message.includes("não posso solicitar senhas"), true, "A IA foi vetada de pedir senhas");

  res = await controller.chat({ merchant_id: MERCHANT, session_id: sessionId, conversation_id: started.conversation_id, user_message: "vou pagar no pix" });
  assert.ok(res.actions.some(a => a.type === "continue_checkout"), "Deve sugerir continue_checkout para o frontend gerar o PIX");

  await controller.complete({
    merchant_id: MERCHANT,
    session_id: sessionId,
    external_order_id: "ord_e2e_1",
    currency: "BRL",
    order_total: cartTotal + 20
  });

  const outbox = repo.listOutbox(MERCHANT);
  const orderCompletedEvt = outbox.find(e => e.event_type === "order.completed");
  assert.ok(orderCompletedEvt, "Evento de pedido completo gerado no outbox");

  const payload = orderCompletedEvt.payload as any;
  assert.ok(payload.confirmation_touchpoints.channels.includes("whatsapp"), "Recomenda canal whatsapp pela política de ticket alto");
  assert.equal(payload.confirmation_touchpoints.whatsapp_ack_recommended, true, "ACK de whatsapp requerido");

});
