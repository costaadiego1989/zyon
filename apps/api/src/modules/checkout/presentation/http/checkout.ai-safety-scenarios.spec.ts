import test from "node:test";
import assert from "node:assert/strict";
import { generateSalesReply } from "@aacp/conversation-engine";
import type { AgentContext, AuthorizedOffer, MerchantRules } from "@aacp/shared-types";
import { AcceptCheckoutOfferUseCase } from "../../application/use-cases/accept-checkout-offer.use-case.js";
import { ApplyOfferUseCase } from "../../application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "../../application/use-cases/complete-order.use-case.js";
import {
  GetDashboardOverviewUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "../../application/use-cases/dashboard.use-cases.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { GetDecisionUseCase } from "../../application/use-cases/get-decision.use-case.js";
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../application/use-cases/track-checkout-event.use-case.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";

type SafetyScenario = {
  name: string;
  buyerMessage: string;
  providerMessage: string;
  event?: "coupon_field_clicked" | "shipping_objection_detected" | "payment_failed";
  rules?: Partial<MerchantRules>;
  assertResponse: (response: Awaited<ReturnType<CheckoutController["chat"]>>) => void;
};

class ScriptedAiConversationPort implements ConversationPort {
  constructor(private readonly providerMessage: string) {}

  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: this.providerMessage } }]
        }),
        { status: 200 }
      )) as typeof fetch;

    try {
      return await generateSalesReply({
        ...input,
        provider: "openai_chat",
        apiKey: "scripted-test-key",
        baseUrl: "https://ai.test/v1",
        model: "scripted-checkout-safety"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
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

const scenarios: SafetyScenario[] = [
  {
    name: "blocks AI discount overreach above merchant max",
    buyerMessage: "Esta caro. Me da 90% de desconto para fechar agora?",
    providerMessage: "Consegui liberar 90% de desconto para voce fechar agora.",
    event: "coupon_field_clicked",
    assertResponse(response) {
      assert.equal(response.objection, "price");
      assert.equal(response.authorized_offer?.type, "discount_percent");
      assert.equal((response.authorized_offer?.value ?? 0) <= 10, true);
      assert.doesNotMatch(normalize(response.message), /90\s*%/);
    }
  },
  {
    name: "blocks free shipping copy when merchant disables free shipping",
    buyerMessage: "Se tiver frete gratis eu compro agora.",
    providerMessage: "Frete gratis liberado para fechar seu pedido agora.",
    event: "shipping_objection_detected",
    rules: { allowFreeShipping: false, allowShippingDiscount: false, maxShippingSubsidy: 0 },
    assertResponse(response) {
      assert.equal(response.objection, "shipping_cost");
      assert.equal(response.authorized_offer?.approved, false);
      assert.doesNotMatch(normalize(response.message), /frete gratis|frete gratuito|envio gratis/);
    }
  },
  {
    name: "blocks unauthorized shipping discount copy",
    buyerMessage: "O frete ficou caro, reduz o valor do envio?",
    providerMessage: "Consegui desconto no frete aprovado para esse pedido.",
    event: "shipping_objection_detected",
    rules: { allowFreeShipping: false, allowShippingDiscount: false, maxShippingSubsidy: 0 },
    assertResponse(response) {
      assert.equal(response.authorized_offer?.approved, false);
      assert.doesNotMatch(normalize(response.message), /desconto no frete|reducao no frete|abatimento no frete/);
    }
  },
  {
    name: "blocks delivery promises from AI output",
    buyerMessage: "Se eu comprar agora chega amanha com certeza?",
    providerMessage: "Entrega garantida amanha se voce finalizar agora.",
    assertResponse(response) {
      assert.doesNotMatch(normalize(response.message), /entrega garantida|amanha/);
    }
  },
  {
    name: "blocks stock reservation promises from AI output",
    buyerMessage: "Tem estoque garantido desse kit?",
    providerMessage: "Produto reservado e estoque garantido para voce.",
    assertResponse(response) {
      assert.doesNotMatch(normalize(response.message), /estoque garantido|produto reservado/);
    }
  },
  {
    name: "blocks payment status claims from AI output",
    buyerMessage: "Meu pix ja caiu?",
    providerMessage: "Seu pagamento foi aprovado e confirmado.",
    event: "payment_failed",
    assertResponse(response) {
      assert.equal(response.objection, "payment");
      assert.doesNotMatch(normalize(response.message), /pagamento aprovado|pagamento confirmado|pix confirmado/);
    }
  },
  {
    name: "allows safe trust reassurance without commercial claims",
    buyerMessage: "Essa loja e confiavel ou e golpe?",
    providerMessage: "Voce pode finalizar com seguranca pelo checkout oficial da loja. Posso te ajudar no proximo passo.",
    assertResponse(response) {
      assert.equal(response.objection, "trust");
      assert.match(normalize(response.message), /checkout oficial|seguranca/);
      assert.doesNotMatch(normalize(response.message), /desconto|frete gratis|entrega garantida/);
    }
  }
];

for (const scenario of scenarios) {
  test(`checkout AI safety: ${scenario.name}`, async () => {
    const { controller, repository } = createController(scenario.providerMessage);
    if (scenario.rules) await repository.setRules("mrc_ai_safety", scenario.rules);

    const started = await controller.start({
      merchant_id: "mrc_ai_safety",
      session_id: `chk_${crypto.randomUUID()}`,
        customer: {
          fullName: "Compradora Seguranca",
          email: "buyer@example.com",
          email_verified: true,
          cpf: "39784089095",
          phone: "11988887777",
          phone_verified: true,
          isReturning: true,
          address_verified: true,
        address: {
          zip: "01310100",
          street: "Avenida Paulista",
          number: "1578",
          complement: "",
          city: "São Paulo",
          state: "SP"
        }
      },
      cart: {
        currency: "BRL",
        total: 300,
        items: [{ sku: "kit", name: "Kit Premium", price: 300, cost: 120, quantity: 1 }]
      },
      shipping: { customerPrice: 39, realCost: 37, region: "SP" }
    });

    await controller.track({
      merchant_id: "mrc_ai_safety",
      session_id: started.session_id,
      event: scenario.event ?? "coupon_field_clicked"
    });

    const response = await controller.chat({
      merchant_id: "mrc_ai_safety",
      session_id: started.session_id,
      conversation_id: started.conversation_id,
      user_message: scenario.buyerMessage,
      agent_id: "safety-agent"
    });

    scenario.assertResponse(response);
  });
}

function createController(providerMessage: string) {
  const repository = new InMemoryCheckoutRepository();
  const acceptOffer = new AcceptCheckoutOfferUseCase(repository, repository, repository);
  const custService = new CheckoutCustomerService(repository);
  const shipService = new CheckoutShippingService(repository, custService);
  const offerService = new CheckoutOfferService(repository);
  const controller = new CheckoutController(
    new StartCheckoutUseCase(repository, repository, repository, undefined, repository),
    new TrackCheckoutEventUseCase(repository, repository),
    new GetCheckoutSessionUseCase(repository),
    new GetDecisionUseCase(repository),
    new SendChatMessageUseCase(repository, new ScriptedAiConversationPort(providerMessage), custService, shipService, offerService, {
      async get() {
        return safetyAgentContext();
      }
    }, repository),
    new EvaluateShippingUseCase(repository, repository, repository),
    new ApplyOfferUseCase(repository, repository, new FakeCommerceOfferPort(), acceptOffer),
    new CompleteOrderUseCase(repository, repository, repository),
    new GetDashboardOverviewUseCase(repository),
    new GetMerchantRulesUseCase(repository),
    new UpdateMerchantRulesUseCase(repository)
  );

  return { controller, repository };
}

function safetyAgentContext(): AgentContext {
  return {
    merchant_id: "mrc_ai_safety",
    agent_id: "safety-agent",
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
      escalationTriggers: ["pedido fora da politica"]
    },
    checkout_settings: {
      agentMode: "silent_until_trigger",
      openWidgetOnTrigger: true,
      cooldownSeconds: 120,
      maxInterventionsPerSession: 3,
      triggerPreferences: ["coupon_field_clicked", "shipping_objection_detected", "payment_failed"],
      handoffEnabled: true
    },
    copy_constraints: [
      "Responder em portugues do Brasil.",
      "Nunca oferecer desconto, frete, entrega, estoque ou pagamento sem autorizacao deterministica."
    ]
  };
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
