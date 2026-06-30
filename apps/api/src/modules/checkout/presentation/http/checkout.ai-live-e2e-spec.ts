import test from "node:test";
import assert from "node:assert/strict";
import { generateSalesReply } from "@zyon/conversation-engine";
import type { AgentContext, AuthorizedOffer } from "@zyon/shared-types";
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
import { merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";

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
    const acceptOffer = new AcceptCheckoutOfferUseCase(repository, repository, repository);
    const custService = new CheckoutCustomerService(repository);
    const shipService = new CheckoutShippingService(repository, custService);
    const offerService = new CheckoutOfferService(repository);
    const controller = new CheckoutController(
      new StartCheckoutUseCase(repository, repository, repository),
      new TrackCheckoutEventUseCase(repository, repository),
      new GetCheckoutSessionUseCase(repository),
      new GetDecisionUseCase(repository),
      new SendChatMessageUseCase(repository, new LiveAiConversationPort(), custService, shipService, offerService, {
        async get() {
          return liveAgentContext();
        }
      }),
      new EvaluateShippingUseCase(repository, repository, repository),
      new ApplyOfferUseCase(repository, repository, new FakeCommerceOfferPort(), acceptOffer),
      new CompleteOrderUseCase(repository, repository, repository),
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

test(
  "live AI checkout e2e simulates a full multi-turn purchase journey",
  {
    skip: runLiveAi
      ? false
      : "Set RUN_REAL_AI_E2E=true and DEEPSEEK_API_KEY or OPENAI_API_KEY to run live AI checkout e2e."
  },
  async () => {
    const repository = new InMemoryCheckoutRepository();
    const acceptOffer = new AcceptCheckoutOfferUseCase(repository, repository, repository);
    const custService = new CheckoutCustomerService(repository);
    const shipService = new CheckoutShippingService(repository, custService);
    const offerService = new CheckoutOfferService(repository);
    const controller = new CheckoutController(
      new StartCheckoutUseCase(repository, repository, repository),
      new TrackCheckoutEventUseCase(repository, repository),
      new GetCheckoutSessionUseCase(repository),
      new GetDecisionUseCase(repository),
      new SendChatMessageUseCase(repository, new LiveAiConversationPort(), custService, shipService, offerService, {
        async get() {
          return liveAgentContext();
        }
      }),
      new EvaluateShippingUseCase(repository, repository, repository),
      new ApplyOfferUseCase(repository, repository, new FakeCommerceOfferPort(), acceptOffer),
      new CompleteOrderUseCase(repository, repository, repository),
      new GetDashboardOverviewUseCase(repository),
      new GetMerchantRulesUseCase(repository),
      new UpdateMerchantRulesUseCase(repository)
    );

    const merchantId = "mrc_live_ai_journey";
    const started = await controller.start({
      merchant_id: merchantId,
      session_id: `chk_live_journey_${crypto.randomUUID()}`,
      customer: { email: "buyer-journey@example.com", isReturning: false },
      cart: {
        currency: "BRL",
        total: 459.9,
        items: [
          {
            sku: "bag-pro",
            name: "Bolsa Executiva Couro Safiano",
            price: 459.9,
            cost: 200,
            quantity: 1
          }
        ]
      },
      shipping: { customerPrice: 29.9, realCost: 22, region: "SP", deliveryDays: 4 }
    });

    await controller.track({
      merchant_id: merchantId,
      session_id: started.session_id,
      event: "shipping_objection_detected"
    });

    const r1 = await controller.chat({
      merchant_id: merchantId,
      session_id: started.session_id,
      conversation_id: started.conversation_id,
      user_message: "Achei o frete um pouco salgado, tem como melhorar?"
    });
    assert.equal(r1.message.length > 10, true, "AI must produce free-form text");
    assert.equal(Array.isArray(r1.turns), true, "first turn returns chat history");
    assert.equal(r1.turns!.length, 2, "2 turns after first round (buyer+agent)");

    const r2 = await controller.chat({
      merchant_id: merchantId,
      session_id: started.session_id,
      conversation_id: started.conversation_id,
      user_message: "E sobre o cupom? voce mencionou frete agora me fala do desconto."
    });
    assert.equal(r2.turns!.length, 4, "history grows on subsequent rounds");
    assert.notEqual(r2.message, r1.message, "AI must produce a different reply on round 2");

    const r3 = await controller.chat({
      merchant_id: merchantId,
      session_id: started.session_id,
      conversation_id: started.conversation_id,
      user_message: "Pode aplicar a melhor condicao autorizada para eu fechar agora?"
    });
    assert.ok(r3.authorized_offer, "round 3 produces an authorized offer");
    assert.equal(r3.authorized_offer!.approved, true);

    const apply = await controller.offer({
      merchant_id: merchantId,
      session_id: started.session_id,
      offer_id: r3.authorized_offer!.id
    });
    assert.equal(apply.success, true);

    const completed = await controller.complete({
      merchant_id: merchantId,
      session_id: started.session_id,
      external_order_id: `ord_${crypto.randomUUID()}`,
      order_total: 459.9,
      currency: "BRL",
      accepted_offer_id: r3.authorized_offer!.id
    });
    assert.equal(completed.recorded, true);
    assert.equal(completed.event_type, "order.completed");

    const snap = await controller.session(merchantId, started.session_id);
    assert.equal(snap.chatHistory.length, 6, "session keeps full chat history (3 rounds = 6 turns)");
    assert.equal(snap.chatHistory[0]?.role, "buyer");
    assert.equal(snap.chatHistory[1]?.role, "agent");
  }
);

test(
  "live AI checkout e2e respects configurable guardrails and quick replies",
  {
    skip: runLiveAi
      ? false
      : "Set RUN_REAL_AI_E2E=true and DEEPSEEK_API_KEY or OPENAI_API_KEY to run live AI checkout e2e."
  },
  async () => {
    const repository = new InMemoryCheckoutRepository();
    const acceptOffer = new AcceptCheckoutOfferUseCase(repository, repository, repository);
    const custService = new CheckoutCustomerService(repository);
    const shipService = new CheckoutShippingService(repository, custService);
    const offerService = new CheckoutOfferService(repository);
    const controller = new CheckoutController(
      new StartCheckoutUseCase(repository, repository, repository),
      new TrackCheckoutEventUseCase(repository, repository),
      new GetCheckoutSessionUseCase(repository),
      new GetDecisionUseCase(repository),
      new SendChatMessageUseCase(repository, new LiveAiConversationPort(), custService, shipService, offerService, {
        async get() {
          return liveAgentContext();
        }
      }),
      new EvaluateShippingUseCase(repository, repository, repository),
      new ApplyOfferUseCase(repository, repository, new FakeCommerceOfferPort(), acceptOffer),
      new CompleteOrderUseCase(repository, repository, repository),
      new GetDashboardOverviewUseCase(repository),
      new GetMerchantRulesUseCase(repository),
      new UpdateMerchantRulesUseCase(repository)
    );

    const merchantId = "mrc_live_ai_matrix";
    const sessionId = `chk_live_matrix_${crypto.randomUUID()}`;

    await controller.update(merchantId, {
      ...merchantRules({
        couponBoxEnabled: false,
        maxDiscountPercent: 10,
        allowStackDiscountAndFreeShipping: false,
        quickReplies: {
          payment: ["Tenho um cupom", "Prefiro PIX", "Prefiro cartão"]
        }
      })
    });

    const started = await controller.start({
      merchant_id: merchantId,
      session_id: sessionId,
      customer: {
        fullName: "Compradora Matrix",
        email: "buyer-matrix@example.com",
        email_verified: true,
        cpf: "39784089095",
        phone: "11988887777",
        address: {
          zip: "01310100",
          street: "Avenida Paulista",
          number: "1578",
          city: "São Paulo",
          state: "SP"
        }
      },
      cart: {
        currency: "BRL",
        total: 300,
        items: [{ sku: "kit-matrix", name: "Kit Matrix", price: 300, cost: 120, quantity: 1 }]
      },
      shipping: { customerPrice: 39, realCost: 37, region: "SP", deliveryDays: 4 }
    });

    const paymentRound = await controller.chat({
      merchant_id: merchantId,
      session_id: started.session_id,
      conversation_id: started.conversation_id,
      user_message: "Tenho um cupom e quero pagar agora.",
      agent_id: "checkout-live-ai"
    });

    assert.equal(paymentRound.stage, "payment");
    assert.equal(paymentRound.experience?.copy.quick_replies?.includes("Tenho um cupom"), false);
    assert.equal(paymentRound.experience?.copy.quick_replies?.includes("Prefiro PIX"), true);

    const shippingSession = await repository.getSession(merchantId, started.session_id);
    if (shippingSession) {
      shippingSession.cart.currentDiscount = 40;
      await repository.saveSession(shippingSession);
    }

    const shippingQuote = await controller.shipping({
      merchant_id: merchantId,
      session_id: started.session_id,
      cart_value: 300,
      shipping_price: 39,
      shipping_real_cost: 37,
      abandonment_score: 0.9
    });

    assert.equal(shippingQuote.approved, false);
    assert.equal(shippingQuote.reason, "stack_discount_and_free_shipping_not_allowed");
    assert.ok(["shipping_free", "shipping_discount_fixed", "none"].includes(shippingQuote.action));
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
