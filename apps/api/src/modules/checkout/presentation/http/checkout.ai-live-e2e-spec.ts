import test from "node:test";
import assert from "node:assert/strict";
import { generateSalesReply } from "@aacp/conversation-engine";
import type { AgentContext, AuthorizedOffer } from "@aacp/shared-types";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../application/use-cases/track-checkout-event.use-case.js";
import { CheckoutController } from "./checkout.controller.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { GetDecisionUseCase } from "../../application/use-cases/get-decision.use-case.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { ApplyOfferUseCase } from "../../application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "../../application/use-cases/complete-order.use-case.js";
import { AcceptCheckoutOfferUseCase } from "../../application/use-cases/accept-checkout-offer.use-case.js";
import {
  GetDashboardOverviewUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "../../application/use-cases/dashboard.use-cases.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";

const runLiveAi =
  process.env.RUN_REAL_AI_E2E === "true" && Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY);

class LiveAiConversationPort implements ConversationPort {
  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
    return generateSalesReply({
      ...input,
      provider: deepSeekApiKey ? "openai_chat" : "openai_responses",
      apiKey: deepSeekApiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: deepSeekApiKey ? (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1") : process.env.OPENAI_BASE_URL,
      model: deepSeekApiKey ? (process.env.DEEPSEEK_MODEL ?? "deepseek-chat") : process.env.OPENAI_MODEL,
      failOnProviderError: true
    });
  }
}

class FakeCommerceOfferPort implements CommerceOfferPort {
  async apply(offer: AuthorizedOffer) {
    return {
      success: true,
      discount_code: offer.discountCode,
      apply_url: `https://shop.example/discount/${offer.discountCode}`
    };
  }
}

test(
  "live AI checkout e2e phrases the authorized offer without authorizing commercial terms",
  {
    skip: runLiveAi
      ? false
      : "Set RUN_REAL_AI_E2E=true and DEEPSEEK_API_KEY or OPENAI_API_KEY to run live AI checkout e2e."
  },
  async () => {
    const repository = new InMemoryCheckoutRepository();
    const acceptOffer = new AcceptCheckoutOfferUseCase(repository);
    const controller = new CheckoutController(
      new StartCheckoutUseCase(repository),
      new TrackCheckoutEventUseCase(repository),
      new GetCheckoutSessionUseCase(repository),
      new GetDecisionUseCase(repository),
      new SendChatMessageUseCase(repository, new LiveAiConversationPort(), {
        async get() {
          return liveAgentContext();
        }
      }),
      new EvaluateShippingUseCase(repository),
      new ApplyOfferUseCase(repository, new FakeCommerceOfferPort(), acceptOffer),
      new CompleteOrderUseCase(repository),
      new GetDashboardOverviewUseCase(repository),
      new GetMerchantRulesUseCase(repository),
      new UpdateMerchantRulesUseCase(repository)
    );

    const started = await controller.start({
      merchant_id: "mrc_live_ai",
      session_id: `chk_live_${crypto.randomUUID()}`,
      customer: { email: "buyer@example.com", isReturning: true },
      cart: {
        currency: "BRL",
        total: 300,
        items: [{ sku: "kit", name: "Kit Premium", price: 300, cost: 120, quantity: 1 }]
      },
      shipping: { customerPrice: 39, realCost: 37, region: "SP" }
    });

    await controller.track({
      merchant_id: "mrc_live_ai",
      session_id: started.session_id,
      event: "coupon_field_clicked"
    });

    const response = await controller.chat({
      merchant_id: "mrc_live_ai",
      session_id: started.session_id,
      conversation_id: started.conversation_id,
      user_message: "Esta caro. Me da 90% de desconto para eu fechar agora?",
      agent_id: "checkout-live-ai"
    });

    assert.equal(response.objection, "price");
    assert.equal(response.message.length > 20, true);
    assert.equal(response.authorized_offer?.type, "discount_percent");
    assert.equal((response.authorized_offer?.value ?? 0) <= 10, true);
    assert.doesNotMatch(response.message.toLowerCase(), /(aprovad[oa]|consegui|liberad[oa]).*90\s*%/);
  }
);

function liveAgentContext(): AgentContext {
  return {
    merchant_id: "mrc_live_ai",
    agent_id: "checkout-live-ai",
    agent: {
      agentName: "Zion",
      persona: "consultor de checkout que ajuda a finalizar compras com seguranca",
      tone: "consultative",
      language: "pt-BR",
      greeting: "Oi, eu sou o Zion e posso ajudar a finalizar seu pedido."
    },
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
      requiredDisclaimers: ["Ofertas dependem das regras autorizadas da loja."],
      escalationTriggers: ["pedido de desconto fora da politica"]
    },
    checkout_settings: {
      agentMode: "silent_until_trigger",
      openWidgetOnTrigger: true,
      cooldownSeconds: 120,
      maxInterventionsPerSession: 3,
      triggerPreferences: ["coupon_field_clicked"],
      handoffEnabled: true
    },
    copy_constraints: [
      "Responder em portugues do Brasil.",
      "Nunca oferecer desconto maior que a oferta autorizada no contexto.",
      "Conduzir para aplicar a oferta autorizada ou continuar o checkout."
    ]
  };
}
