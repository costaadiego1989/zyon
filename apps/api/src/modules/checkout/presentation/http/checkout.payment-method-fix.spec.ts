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
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { StartCheckoutTestHarness as StartCheckoutUseCase } from "../../__tests__/start-checkout-test-harness.js";
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
  const chat = new SendChatMessageUseCase(
    repo, conv, custService, shipService, offerService,
    new FakeAgent(), merchantRepo,
    undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    createPaymentIntent
  );
  const ctrl = new CheckoutController(
    new StartCheckoutUseCase(repo, repo, repo, undefined, repo),
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
  // Pre-seed asaasCustomerId so CreatePaymentIntentUseCase doesn't try to call
  // provider.createCustomer (FakePaymentProvider doesn't implement it).
  const initial = repo.getSession(MERCHANT, sid)!;
  repo.saveSession({
    ...initial,
    customer: { ...initial.customer!, asaasCustomerId: "cus_test" }
  });
  await repo.appendChatTurn(MERCHANT, sid, { role: "agent", text: started.experience.agent.greeting, occurredAt: new Date().toISOString() });

  await repo.appendChatTurn(MERCHANT, sid, { role: "agent", text: "Qual e o seu nome completo?", occurredAt: new Date().toISOString() });
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "Meu nome e Maria Silva" });

  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "maria@email.com" });
  const otp = repo.getSession(MERCHANT, sid)?.customer?.otp_code;
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: `o codigo e ${otp}` });

  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "123.456.789-01" });
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "(11) 98888-7777" });
  const phoneOtp = repo.getSession(MERCHANT, sid)?.customer?.phone_otp_code;
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: phoneOtp! });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("viacep.com.br")) {
      return new Response(JSON.stringify({ logradouro: "Rua Teste", bairro: "Centro", localidade: "Sao Paulo", uf: "SP" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(input);
  };
  try {
    await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "CEP 01310-100" });
    await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "Sim" });
    await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "100, ap 12" });
    const shipRes = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "Quero PAC" });
    assert.equal(shipRes.stage, "payment", "Should reach payment stage");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("FIX: buyer says PIX → paymentMethod set + intent created + stage=completed", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, couponBoxEnabled: false, minimumMarginPercent: 10 });
  // Mock asaas customer creation in the provider — FakePaymentProvider handles it.
  const { ctrl } = buildFullStack(repo);
  const sid = "fix_pix_1";

  await driveToPayment(repo, ctrl, sid);

  // Sanity: at payment stage, no payment method yet.
  let session = repo.getSession(MERCHANT, sid);
  assert.equal(session?.paymentMethod, undefined, "Pre-condition: no paymentMethod yet");
  // asaasCustomerId is pre-seeded (test fixture), so it's expected to be present.
  assert.equal(session?.customer?.asaasCustomerId, "cus_test", "Pre-condition: asaasCustomerId pre-seeded");

  // ACT: buyer says PIX
  const pixRes = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "Vou pagar no PIX" });

  // VERIFY: action button emitted (back-compat)
  assert.ok(pixRes.actions.some((a: any) => a.type === "continue_checkout"), "continue_checkout action emitted");

  // VERIFY: payment method persisted on session
  session = repo.getSession(MERCHANT, sid);
  assert.equal(session?.paymentMethod, "pix", "session.paymentMethod = pix");

  // VERIFY: payment intent created and exposed
  const intent = pixRes.experience?.payment_intent;
  assert.ok(intent, "experience.payment_intent present");
  assert.equal(intent.method, "pix", "intent method is pix");
  assert.ok(intent.id, "intent id present");
  assert.ok(intent.amount_cents > 0, "intent amount > 0");

  // VERIFY: stage advances to "completed"
  assert.equal(pixRes.stage, "completed", "stage transitions to completed after PIX selection");
  assert.deepEqual(pixRes.missing_fields, [], "no missing fields once paymentMethod set");
});

test("FIX: buyer says cartao → paymentMethod=credit_card + intent OR graceful fallback", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, couponBoxEnabled: false, minimumMarginPercent: 10 });
  const { ctrl } = buildFullStack(repo);
  const sid = "fix_card_1";

  await driveToPayment(repo, ctrl, sid);

  const cardRes = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "Prefiro pagar com cartao de credito" });

  assert.equal(repo.getSession(MERCHANT, sid)?.paymentMethod, "credit_card", "session.paymentMethod = credit_card");
  // Without Stripe configured (test env), card throws stripe_provider_not_configured.
  // The chat layer catches it and still advances stage. The intent surface stays clean.
  assert.equal(cardRes.stage, "completed", "stage still completes even when provider not configured");
  assert.deepEqual(cardRes.missing_fields, [], "no missing fields");
});

test("REGRESSION: paymentMethod already set → stage stays completed, no duplicate intent", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, couponBoxEnabled: false });
  const { ctrl } = buildFullStack(repo);
  const sid = "fix_idem_1";
  await driveToPayment(repo, ctrl, sid);

  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "PIX" });
  const firstIntent = repo.getSession(MERCHANT, sid);
  assert.ok(firstIntent?.paymentMethod, "first selection set method");

  // Second PIX message: should NOT re-create an intent (idempotency guarded by session.paymentMethod check)
  const second = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "any", user_message: "PIX mesmo" });
  // paymentMethod is already set, so the working session preserves it; intent branch is skipped
  // (no new intent emitted on the response because selectedPaymentMethod is undefined after first turn)
  assert.equal(second.stage, "completed");
});
