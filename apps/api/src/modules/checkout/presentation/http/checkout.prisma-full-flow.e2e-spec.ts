import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext, AuthorizedOffer, Cart } from "@aacp/shared-types";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import { RecordCompletedPurchaseUseCase } from "../../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { HandleAsaasWebhookUseCase } from "../../../payment/application/handle-asaas-webhook.use-case.js";
import { FakePaymentProvider } from "../../../payment/infrastructure/fake-payment-provider.js";
import { CheckoutPaymentAdapter } from "../../../payment/infrastructure/checkout-payment.adapter.js";
import { InMemoryPaymentRepository } from "../../../payment/infrastructure/in-memory-payment.repository.js";
import { AcceptCheckoutOfferUseCase } from "../../application/use-cases/accept-checkout-offer.use-case.js";
import { ApplyOfferUseCase } from "../../application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "../../application/use-cases/complete-order.use-case.js";
import { UpdateOrderTrackingUseCase } from "../../application/use-cases/update-order-tracking.use-case.js";
import { GetDashboardOverviewUseCase, GetMerchantRulesUseCase, UpdateMerchantRulesUseCase } from "../../application/use-cases/dashboard.use-cases.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { GetDecisionUseCase } from "../../application/use-cases/get-decision.use-case.js";
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../application/use-cases/track-checkout-event.use-case.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutController } from "./checkout.controller.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { PaymentApprovedHandler } from "../../application/handlers/payment-approved.handler.js";

const MERCHANT = "mrc_prisma_e2e";
const CART: Cart = {
  currency: "BRL", source: "storefront", total: 899.8,
  items: [{ sku: "bag-001", name: "Bolsa Executiva", price: 449.9, cost: 210, quantity: 2, category: "Bolsas", variant: "Preta" }]
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
    if (text.includes("senha")) return { message: "Desculpe, nao posso solicitar senhas.", objection: "unknown" as const };
    if (stage === "data_collection") {
      if (next === "nome") return { message: "Qual e o seu nome completo?", objection: "unknown" as const };
      if (next === "email") return { message: "Pode informar o seu melhor email?", objection: "unknown" as const };
      if (next === "CPF") return { message: "Qual o seu CPF?", objection: "unknown" as const };
      if (next === "telefone") return { message: "Qual o telefone com DDD?", objection: "unknown" as const };
    }
    if (stage === "shipping") {
      if (next === "CEP") return { message: "Por favor, informe seu CEP.", objection: "unknown" as const };
      if (next === "frete") return { message: "Escolha uma opcao de frete.", objection: "unknown" as const };
      if (next?.includes("numero") || next?.includes("mero")) return { message: "Qual o numero da residencia?", objection: "unknown" as const };
    }
    if (stage === "payment") return { message: "Tudo pronto. Como prefere pagar, PIX ou cartao?", objection: "unknown" as const };
    return { message: "Compreendido.", objection: "unknown" as const };
  }
}

import { BuyerPurchaseHistoryAdapter } from "../../infrastructure/adapters/buyer-purchase-history.adapter.js";

function buildController(repo: InMemoryCheckoutRepository) {
  const payments = new InMemoryPaymentRepository();
  const purchaseHistoryRepo = new InMemoryBuyerPurchaseHistoryRepository();
  const purchaseHistoryPort = new BuyerPurchaseHistoryAdapter(new RecordCompletedPurchaseUseCase(purchaseHistoryRepo));
  const completeOrder = new CompleteOrderUseCase(repo, repo, repo, purchaseHistoryPort);
  const conv = new FakeConv();
  const custService = new CheckoutCustomerService(repo);
  const shipService = new CheckoutShippingService(repo, custService);
  const offerService = new CheckoutOfferService(repo);
  const ctrl = new CheckoutController(
    new StartCheckoutUseCase(repo, repo, repo, undefined, repo), new TrackCheckoutEventUseCase(repo, repo),
    new GetCheckoutSessionUseCase(repo), new GetDecisionUseCase(repo),
    new SendChatMessageUseCase(repo, conv, custService, shipService, offerService, new FakeAgent(), repo),
    new EvaluateShippingUseCase(repo, repo, repo),
    new ApplyOfferUseCase(repo, repo, new FakeCommerceOffer(), new AcceptCheckoutOfferUseCase(repo, repo, repo)),
    completeOrder, new GetDashboardOverviewUseCase(repo),
    new GetMerchantRulesUseCase(repo), new UpdateMerchantRulesUseCase(repo)
  );
  return { ctrl, payments, completeOrder, purchaseHistoryRepo };
}

// ---- TEST 1: Full conversational flow ----
test("E2E Prisma Full Flow: data_collection → shipping → payment → completed", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 12, couponBoxEnabled: true });
  const { ctrl, payments, completeOrder } = await buildController(repo);
  const sid = "chk_prisma_e2e_1";

  // 1. Start
  const started = await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: undefined, cart: CART });
  assert.equal(started.experience.stage, "data_collection");
  await repo.appendChatTurn(MERCHANT, sid, { role: "agent", text: started.experience.agent.greeting, occurredAt: new Date().toISOString() });

  // 2. Agent asks for name, then buyer responds
  await repo.appendChatTurn(MERCHANT, sid, { role: "agent", text: "Qual e o seu nome completo?", occurredAt: new Date().toISOString() });
  let res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "Meu nome e Joao da Silva" });
  assert.equal(res.stage, "data_collection");
  const sessionAfterName = repo.getSession(MERCHANT, sid);
  assert.ok(sessionAfterName?.customer?.fullName, "Name collected");

  // 3. Email → OTP generated
  res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "joao@email.com" });
  assert.equal(res.stage, "data_collection");
  const otpCode = repo.getSession(MERCHANT, sid)?.customer?.otp_code;
  assert.ok(otpCode, "OTP generated");

  // 4. Verify OTP
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: `o codigo e ${otpCode}` });
  const afterOtp = repo.getSession(MERCHANT, sid);
  assert.equal(afterOtp?.customer?.email_verified, true, "Email verified");

  // 5. CPF
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "123.456.789-01" });
  assert.equal(repo.getSession(MERCHANT, sid)?.customer?.cpf, "12345678901");

  // 6. Phone
  res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "(21) 99300-1883" });
  assert.equal(res.stage, "data_collection");
  const phoneOtp = repo.getSession(MERCHANT, sid)?.customer?.phone_otp_code;
  assert.ok(phoneOtp, "Phone OTP generated");

  // 6.5. Verify Phone OTP → transitions to shipping
  res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: phoneOtp });
  assert.equal(res.stage, "shipping", "Stage transitions to shipping after phone verification");

  // 7. CEP with mocked ViaCEP
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("viacep.com.br")) {
      return new Response(JSON.stringify({ logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "Sao Paulo", uf: "SP" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, init);
  };

  try {
    res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "CEP 01310-100" });
    assert.equal(res.stage, "shipping");
    assert.equal(res.missing_fields?.[0], "confirmar endereço");

    // 7.5. Confirm Address → Sim
    res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "Sim" });
    assert.equal(res.stage, "shipping");

    // 8. House number → shipping options generated
    res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "1500, ap 42" });
    assert.equal(res.stage, "shipping");
    assert.equal(res.missing_fields?.[0], "frete");
    assert.equal(res.experience?.shippingOptions?.length, 2, "Two shipping options generated");

    // 9. Select shipping → transitions to payment
    res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "Quero PAC" });
    assert.equal(res.stage, "payment", "Stage transitions to payment");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 10. Payment method
  res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: started.conversation_id, user_message: "vou pagar no pix" });
  assert.ok(res.actions.some(a => a.type === "continue_checkout"), "PIX action returned");

  // 11. Verify persisted session
  const finalSession = repo.getSession(MERCHANT, sid);
  assert.ok(finalSession?.shipping?.customerPrice, "Shipping price set");
  assert.equal(finalSession?.shipping?.method, "PAC");
  assert.equal(finalSession?.customer?.cpf, "12345678901");
  assert.equal(finalSession?.customer?.phone, "21993001883");
  assert.equal(finalSession?.customer?.address?.street, "Avenida Paulista");
  assert.ok(finalSession!.chatHistory.length >= 10, "Chat history persisted");

  // 12. Payment intent + webhook → order completed
  repo.saveSession({ ...finalSession!, customer: { ...finalSession!.customer, asaasCustomerId: "cus_test" } });
  const intent = await new CreatePaymentIntentUseCase(repo, payments, new FakePaymentProvider(), repo).execute({
    merchant_id: MERCHANT, session_id: sid, idempotency_key: "idem_pix", method: "pix"
  });
  const eventBus = new InMemoryDomainEventBus();
  new PaymentApprovedHandler(eventBus, completeOrder).onModuleInit();
  const webhook = new HandleAsaasWebhookUseCase(payments, new CheckoutPaymentAdapter(repo, repo, eventBus));
  const processed = await webhook.execute(undefined, {
    id: "evt_paid", event: "PAYMENT_RECEIVED",
    payment: { id: intent.providerPaymentId, value: intent.amountCents / 100, externalReference: intent.id }
  });
  assert.equal(processed.outcome, "processed");
  const order = repo.getCompletedOrder(MERCHANT, sid, intent.providerPaymentId!);
  assert.equal(order?.trackingCode, undefined);
  const tracking = await new UpdateOrderTrackingUseCase(repo, repo, repo).execute({
    merchant_id: MERCHANT,
    session_id: sid,
    external_order_id: intent.providerPaymentId!,
    tracking_code: "BRPRISMA123AA"
  });
  assert.equal(tracking.order.trackingCode, "BRPRISMA123AA");
});

// ---- TEST 2: Discount rules - max cap ----
test("Discount offer is capped at maxDiscountPercent", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 5, minimumMarginPercent: 10, couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_discount_cap";

  await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: { fullName: "Test User", email: "t@t.com", email_verified: true, cpf: "12345678901", phone: "11999999999", phone_verified: true, address_verified: true, address: { zip: "01310100", street: "Rua A", number: "1", city: "SP", state: "SP", neighborhood: "Centro" } }, cart: CART, shipping: { customerPrice: 20, realCost: 15, carrier: "Correios", method: "PAC", deliveryDays: 5, region: "sudeste" } });

  const res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "conv_test", user_message: "quero 20% de desconto" });
  if (res.authorized_offer?.approved) {
    assert.ok(res.authorized_offer.value <= 5, `Discount capped: got ${res.authorized_offer.value}%`);
  }
});

// ---- TEST 3: Discount blocked by minimum margin ----
test("Discount blocked when margin too low", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 50, minimumMarginPercent: 99, couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_margin_block";

  await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: { fullName: "Test", email: "t@t.com", email_verified: true, cpf: "12345678901", phone: "11999999999", phone_verified: true, address_verified: true, address: { zip: "01310100", street: "Rua A", number: "1", city: "SP", state: "SP", neighborhood: "C" } }, cart: CART, shipping: { customerPrice: 20, realCost: 15, carrier: "C", method: "PAC", deliveryDays: 5, region: "sudeste" } });

  const res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "conv_test", user_message: "quero desconto" });
  assert.equal(res.authorized_offer?.approved, false, "Offer blocked by margin rule");
  assert.equal(res.authorized_offer?.reason, "minimum_margin_violation");
});

// ---- TEST 4: Shipping offer blocked in data_collection stage ----
test("No offers during data_collection stage", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 12, couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_no_offer_early";

  await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: undefined, cart: CART });
  const res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "conv_test", user_message: "quero frete gratis" });
  assert.equal(res.authorized_offer?.approved, false, "No offers during registration");
  assert.equal(res.authorized_offer?.reason, "complete_customer_before_offers");
});

// ---- TEST 5: Guardrail - password request blocked ----
test("Guardrail: AI refuses password requests", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 12, couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_guardrail";

  await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: { fullName: "Test", email: "t@t.com", email_verified: true, cpf: "12345678901", phone: "11999999999", phone_verified: true, address_verified: true, address: { zip: "01310100", street: "Rua A", number: "1", city: "SP", state: "SP", neighborhood: "C" } }, cart: CART, shipping: { customerPrice: 20, realCost: 15, carrier: "C", method: "PAC", deliveryDays: 5, region: "sudeste" } });

  const res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "conv_test", user_message: "qual e a senha para pagar?" });
  assert.ok(res.message.includes("senhas") || res.message.includes("senha"), "Guardrail blocks password");
});

// ---- TEST 6: Free shipping blocked by stacking rule ----
test("Free shipping blocked when stacking disabled and discount already applied", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, allowFreeShipping: true, allowStackDiscountAndFreeShipping: false, freeShippingMinCartValue: 100, couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_no_stack";
  const cartWithDiscount: Cart = { ...CART, currentDiscount: 50 };

  await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: { fullName: "Test", email: "t@t.com", email_verified: true, cpf: "12345678901", phone: "11999999999", phone_verified: true, address_verified: true, address: { zip: "01310100", street: "Rua A", number: "1", city: "SP", state: "SP", neighborhood: "C" } }, cart: cartWithDiscount, shipping: { customerPrice: 30, realCost: 25, carrier: "C", method: "PAC", deliveryDays: 5, region: "sudeste" } });

  const res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "conv_test", user_message: "quero frete gratis" });
  assert.equal(res.authorized_offer?.approved, false, "Free shipping blocked when stacking disabled");
});

// ---- TEST 7: Blocked shipping region ----
test("Shipping blocked for blocked region", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, allowFreeShipping: true, blockedRegions: ["norte"], couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_blocked_region";

  await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: { fullName: "Test", email: "t@t.com", email_verified: true, cpf: "12345678901", phone: "11999999999", phone_verified: true, address_verified: true, address: { zip: "69000000", street: "Rua X", number: "1", city: "Manaus", state: "AM", neighborhood: "C" } }, cart: CART, shipping: { customerPrice: 50, realCost: 45, carrier: "C", method: "PAC", deliveryDays: 10, region: "norte" } });

  const res = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: "conv_test", user_message: "quero frete gratis" });
  assert.equal(res.authorized_offer?.approved, false, "Blocked region");
});

// ---- TEST 8: Session resumption ----
test("Session resumption preserves chat history", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 12, couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_resume";

  const s1 = await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: undefined, cart: CART });
  await repo.appendChatTurn(MERCHANT, sid, { role: "agent", text: s1.experience.agent.greeting, occurredAt: new Date().toISOString() });
  await ctrl.chat({ merchant_id: MERCHANT, session_id: sid, conversation_id: s1.conversation_id, user_message: "Meu nome e Ana Costa" });

  // Resume with same session_id
  const s2 = await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: undefined, cart: CART });
  assert.equal(s2.session_id, sid, "Same session ID");
  assert.ok((s2.turns?.length ?? 0) >= 2, `Chat history preserved: ${s2.turns?.length} turns`);
  assert.equal(s2.global_user_id, s1.global_user_id, "Same global user");
});

// ---- TEST 9: Greeting without discount when maxDiscountPercent=0 ----
test("Greeting does NOT mention discount when maxDiscountPercent=0", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 0, couponBoxEnabled: false });
  const { ctrl } = await buildController(repo);
  const sid = "chk_no_discount";

  const started = await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: undefined, cart: CART });
  assert.ok(!started.experience.agent.greeting.includes("desconto"), "No discount in greeting");
});

// ---- TEST 10: Quick replies change per stage ----
test("Quick replies differ by stage", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.setRules(MERCHANT, { maxDiscountPercent: 10, couponBoxEnabled: true });
  const { ctrl } = await buildController(repo);
  const sid = "chk_qr";

  const started = await ctrl.start({ merchant_id: MERCHANT, session_id: sid, customer: undefined, cart: CART });
  const dataReplies = started.experience.copy.quick_replies;
  assert.ok(dataReplies.some(r => /nome/i.test(r)), "Data collection quick replies present");

  // Skip to payment stage
  const sid2 = "chk_qr_pay";
  await ctrl.start({ merchant_id: MERCHANT, session_id: sid2, customer: { fullName: "Test", email: "t@t.com", email_verified: true, cpf: "12345678901", phone: "11999999999", phone_verified: true, address_verified: true, address: { zip: "01310100", street: "Rua A", number: "1", city: "SP", state: "SP", neighborhood: "C" } }, cart: CART, shipping: { customerPrice: 20, realCost: 15, carrier: "C", method: "PAC", deliveryDays: 5, region: "sudeste" } });
  const payRes = await ctrl.chat({ merchant_id: MERCHANT, session_id: sid2, conversation_id: "conv_test", user_message: "quero pagar" });
  assert.ok(payRes.experience?.copy.quick_replies.some(r => /PIX|cartão|cartao|Finalizar/i.test(r)), "Payment quick replies");
});
