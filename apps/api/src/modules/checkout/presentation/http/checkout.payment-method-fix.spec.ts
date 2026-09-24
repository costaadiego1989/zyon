import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext, AuthorizedOffer, Cart } from "@zyon/shared-types";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { FakePaymentProvider } from "../../../payment/infrastructure/fake-payment-provider.js";
import { InMemoryPaymentRepository } from "../../../payment/infrastructure/in-memory-payment.repository.js";
import { AcceptCheckoutOfferUseCase } from "../../application/use-cases/accept-checkout-offer.use-case.js";
import { ApplyOfferUseCase } from "../../application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "../../application/use-cases/complete-order.use-case.js";
import { GetDashboardOverviewUseCase } from "../../application/use-cases/dashboard.use-cases.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { GetDecisionUseCase } from "../../application/use-cases/get-decision.use-case.js";
import { GetMerchantRulesUseCase, UpdateMerchantRulesUseCase } from "../../application/use-cases/dashboard.use-cases.js";
import { createStartCheckoutUseCase } from "../../application/use-cases/start-checkout.fixture.js";
import { createSendChatUseCase } from "../../application/use-cases/send-chat-message.fixture.js";
import { TrackCheckoutEventUseCase } from "../../application/use-cases/track-checkout-event.use-case.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";
import { OtpService } from "../../application/services/otp.service.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutController } from "./checkout.controller.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import { RecordCompletedPurchaseUseCase } from "../../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";
import { BuyerPurchaseHistoryAdapter } from "../../infrastructure/adapters/buyer-purchase-history.adapter.js";

const MERCHANT = "mrc_payment_fix";
const CART: Cart = {
  currency: "BRL", source: "storefront", total: 199.9,
  items: [{ sku: "sku-1", name: "Produto Teste", price: 199.9, cost: 80, quantity: 1, category: "Teste" }]
};

class FakeCommerceOffer implements CommerceOfferPort {
  async apply(_o: AuthorizedOffer) { return { success: true, discount_code: "TEST10", apply_url: "http://shop/apply" }; }
}
class FakeAgent implements AgentContextPort {
  async get(): Promise<AgentContext> {
    return {
      merchant_id: MERCHANT, agent_id: "agent",
      agent: { agentName: "Zion", persona: "Sales", tone: "consultative", language: "pt-BR", greeting: "Ola" },
      capabilities: { priceObjectionHandling: true, shippingObjectionHandling: true, trustReassurance: true, paymentFrictionGuidance: true, escalation: true, machineToMachineNegotiation: false },
      guardrails: { forbidUnauthorizedDiscounts: true, forbidUnauthorizedFreeShipping: true, forbidDeliveryPromisesWithoutSource: true, forbidStockPromisesWithoutSource: true, forbidPaymentStatusClaims: true, forbidLegalMedicalFinancialAdvice: true, forbidAbusivePressure: true, blockedPhrases: [], requiredDisclaimers: [], escalationTriggers: [] },
      checkout_settings: { agentMode: "proactive", openWidgetOnTrigger: true, cooldownSeconds: 60, maxInterventionsPerSession: 3, triggerPreferences: [], handoffEnabled: true },
      copy_constraints: []
    };
  }
}
class FakeConv implements ConversationPort {
  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    const stage = input.stage;
    const next = input.missingFields?.[0];
    const text = input.userMessage.toLowerCase();
    if (stage === "data_collection") {
      if (next === "nome") return { message: "Qual e o seu nome completo?", objection: "unknown" as const };
      if (next === "email") return { message: "Pode informar o seu melhor email?", objection: "unknown" as const };
      if (next === "CPF") return { message: "Qual o seu CPF?", objection: "unknown" as const };
      if (next === "telefone") return { message: "Qual o telefone com DDD?", objection: "unknown" as const };
      if (next?.includes("codigo")) return { message: "Codigo de verificacao enviado.", objection: "unknown" as const };
    }
    if (stage === "shipping") {
      if (next === "CEP") return { message: "Informe seu CEP.", objection: "unknown" as const };
      if (next?.includes("confirmar")) return { message: "Confirma o endereco?", objection: "unknown" as const };
      if (next?.includes("numero") || next?.includes("mero")) return { message: "Qual o numero?", objection: "unknown" as const };
      if (next === "frete") return { message: "Escolha uma opcao de frete.", objection: "unknown" as const };
    }
    if (stage === "payment") return { message: "Como prefere pagar, PIX ou cartao?", objection: "unknown" as const };
    return { message: "Ok!", objection: "unknown" as const };
  }
}

function buildFullStack(repo: InMemoryCheckoutRepository) {
  const payments = new InMemoryPaymentRepository();
  const purchaseHistoryRepo = new InMemoryBuyerPurchaseHistoryRepository();
  const purchaseHistoryPort = new BuyerPurchaseHistoryAdapter(new RecordCompletedPurchaseUseCase(purchaseHistoryRepo));
  const completeOrder = new CompleteOrderUseCase(repo, repo, repo, undefined, purchaseHistoryPort);
  const conv = new FakeConv();
  const custService = new CheckoutCustomerService(repo, undefined, new OtpService());
  const shipService = new CheckoutShippingService(repo, custService);
  const offerService = new CheckoutOfferService(repo);
  const merchantRepo = repo;
  // The real use case — in-memory provider + fake asaas/stripe
  const createPaymentIntent = new CreatePaymentIntentUseCase(
    repo, merchantRepo, payments, new FakePaymentProvider()
  );
  const chat = createSendChatUseCase(repo, {
    conversation: conv,
    customerService: custService,
    shippingService: shipService,
    offerService,
    agentContext: new FakeAgent(),
    merchantRepository: merchantRepo,
    createPaymentIntent
  });
  const ctrl = new CheckoutController(
    createStartCheckoutUseCase(repo, repo, { merchantRepository: repo }),
    new TrackCheckoutEventUseCase(repo, repo),
    new GetCheckoutSessionUseCase(repo),
    new GetDecisionUseCase(repo),
    chat,
    new EvaluateShippingUseCase(repo, repo, repo),
    new ApplyOfferUseCase(repo, repo, new FakeCommerceOffer(), new AcceptCheckoutOfferUseCase(repo, repo, repo)),
    completeOrder,
    new GetDashboardOverviewUseCase(repo),
    new GetMerchantRulesUseCase(repo),
    new UpdateMerchantRulesUseCase(repo)
  );
  return { ctrl, payments };
}
async function driveToPayment(repo: InMemoryCheckoutRepository, ctrl: any, sid: string) {
  const started = await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: undefined, cart: CART });
  const initial = repo.getSession(MERCHANT, sid)!;
  repo.saveSession({
    ...initial,
    customer: {
      fullName: "Maria Silva", email: "maria@example.test", email_verified: true,
      cpf: "52998224725", phone: "11987654321", phone_verified: true,
      address_verified: true,
      address: { zip: "01310100", street: "Avenida Paulista", number: "100", complement: "", city: "Sao Paulo", state: "SP" },
      asaasCustomerId: "cus_test",
    },
    shipping: { customerPrice: 10, realCost: 10, carrier: "Correios", method: "PAC", deliveryDays: 5 },
  });
  await repo.appendChatTurn(MERCHANT, sid, { role: "agent", text: started.experience.agent.greeting, occurredAt: new Date().toISOString() });
  const paymentStep = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "Quero finalizar" });
  assert.equal(paymentStep.stage, "payment", "Should reach payment stage");
}

test("FIX: buyer saying PIX keeps chat at the visual payment chooser", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, couponBoxEnabled: false, minimumMarginPercent: 10 });
  const { ctrl } = buildFullStack(repo);
  const sid = "fix_pix_1";
  await driveToPayment(repo, ctrl, sid);
  const pixRes = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "Vou pagar no PIX" });
  assert.equal(repo.getSession(MERCHANT, sid)?.paymentMethod, undefined);
  assert.equal(pixRes.experience?.payment_intent, undefined);
  assert.equal(pixRes.stage, "payment");
});

test("FIX: buyer saying card keeps chat at the visual payment chooser", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, couponBoxEnabled: false, minimumMarginPercent: 10 });
  const { ctrl } = buildFullStack(repo);
  const sid = "fix_card_1";
  await driveToPayment(repo, ctrl, sid);
  const cardRes = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "Prefiro pagar com cartao de credito" });
  assert.equal(repo.getSession(MERCHANT, sid)?.paymentMethod, undefined);
  assert.equal(cardRes.experience?.payment_intent, undefined);
  assert.equal(cardRes.stage, "payment");
});

test("REGRESSION: repeated payment text cannot lock the checkout session", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, couponBoxEnabled: false });
  const { ctrl } = buildFullStack(repo);
  const sid = "fix_idem_1";
  await driveToPayment(repo, ctrl, sid);
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "PIX" });
  const second = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "PIX mesmo" });
  assert.equal(second.stage, "payment");
  assert.equal(repo.getSession(MERCHANT, sid)?.paymentMethod, undefined);
});
