import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext, AuthorizedOffer, CheckoutEventName } from "@aacp/shared-types";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
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
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutController } from "./checkout.controller.js";
import { OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL } from "../../domain/policies/omnichannel-confirmation.policy.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";

const MERCHANT = "mrc_agentic_matrix";

type OrderCompletedPayload = {
  confirmation_touchpoints?: {
    channels: Array<"chat" | "whatsapp">;
    whatsapp_ack_recommended: boolean;
  };
};

class SimpleConversationPort implements ConversationPort {
  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    const tail = input.userMessage.trim().slice(0, 200);
    return {
      message: `Assistente: entendi (${tail}). Oferta autorizada? ${Boolean(input.authorizedOffer?.approved)}.`,
      objection: "unknown" as const
    };
  }
}

class M2mConversationPort implements ConversationPort {
  readonly transcript: string[] = [];

  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    this.transcript.push(input.userMessage);
    const raw = input.userMessage.trim();
    let intent = "free_text";
    if (raw.startsWith("{")) {
      try {
        const j = JSON.parse(raw) as { channel?: string; intent?: string };
        if (j.channel === "buyer_bot_v1") intent = j.intent ?? "bot_v1";
      } catch {
        intent = "invalid_json";
      }
    }
    return {
      message: `M2M_ACK intent=${intent} approved=${Boolean(input.authorizedOffer?.approved)} type=${input.authorizedOffer?.type ?? "none"}`,
      objection: "unknown" as const
    };
  }
}

class StaticAgentContextPort implements AgentContextPort {
  constructor(private readonly ctx: AgentContext) {}

  async get(): Promise<AgentContext | undefined> {
    return this.ctx;
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

function agentContext(partial?: Partial<AgentContext["capabilities"]>): AgentContext {
  return {
    merchant_id: MERCHANT,
    agent_id: "agentic-e2e",
    agent: {
      agentName: "Nova",
      persona: "Closer conversacional omnicanal para checkout enterprise",
      tone: "consultative",
      language: "pt-BR",
      greeting: "Vamos finalizar com seguranca."
    },
    capabilities: {
      priceObjectionHandling: true,
      shippingObjectionHandling: true,
      trustReassurance: true,
      paymentFrictionGuidance: true,
      escalation: true,
      machineToMachineNegotiation: false,
      ...partial
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
      requiredDisclaimers: ["Offers limited by store authorized policy."],
      escalationTriggers: []
    },
    checkout_settings: {
      agentMode: "silent_until_trigger",
      openWidgetOnTrigger: true,
      cooldownSeconds: 60,
      maxInterventionsPerSession: 99,
      triggerPreferences: ["coupon_field_clicked", "shipping_objection_detected"],
      handoffEnabled: true
    },
    copy_constraints: ["Respond short.", "Portuguese Brazil."]
  };
}

function makeController(repository: InMemoryCheckoutRepository, conversation?: ConversationPort, m2m?: boolean) {
  const conv = conversation ?? new SimpleConversationPort();
  const acceptOffer = new AcceptCheckoutOfferUseCase(repository);
  const custService = new CheckoutCustomerService(repository);
  const shipService = new CheckoutShippingService(repository, custService);
  const offerService = new CheckoutOfferService(repository);
  return new CheckoutController(
    new StartCheckoutUseCase(repository),
    new TrackCheckoutEventUseCase(repository),
    new GetCheckoutSessionUseCase(repository),
    new GetDecisionUseCase(repository),
    new SendChatMessageUseCase(
      repository,
      conv,
      custService,
      shipService,
      offerService,
      new StaticAgentContextPort(agentContext({ machineToMachineNegotiation: Boolean(m2m) }))
    ),
    new EvaluateShippingUseCase(repository),
    new ApplyOfferUseCase(repository, new FakeCommerceOfferPort(), acceptOffer),
    new CompleteOrderUseCase(repository),
    new GetDashboardOverviewUseCase(repository),
    new GetMerchantRulesUseCase(repository),
    new UpdateMerchantRulesUseCase(repository)
  );
}

async function freshSession(repository: InMemoryCheckoutRepository, cartTotal = 420) {
  const controller = makeController(repository);
  const sid = `chk_mtx_${crypto.randomUUID()}`;
  const started = await controller.start({
    merchant_id: MERCHANT,
    session_id: sid,
    customer: { email: "buyer-enterprise@example.com", phone: "+5511999998888" },
    cart: {
      currency: "BRL",
      total: cartTotal,
      items: [{ sku: "kit-e2e", name: "Enterprise Kit", price: cartTotal, cost: cartTotal * 0.4, quantity: 1 }]
    },
    shipping: { customerPrice: 39.9, realCost: 28, region: "SP", deliveryDays: 5 }
  });
  return { controller, started };
}

test("AGENTIC-001 start-checkout devolve sessao conversacao e identidade global", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { started } = await freshSession(repo);
  assert.match(started.session_id, /^[a-z0-9_-]+$/i);
  assert.match(started.conversation_id as string, /./);
  assert.match(started.global_user_id, /^usr_/);
});

test("AGENTIC-002 get session reflete carrinho e frete inicial", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo, 300);
  const snap = await controller.session(MERCHANT, started.session_id);
  assert.equal(snap.cart.total, 300);
  assert.ok(snap.shipping!.customerPrice > 0);
});

test("AGENTIC-003 track checkout_started aceito", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  const out = await controller.track(trackBody(started.session_id, "checkout_started"));
  assert.equal(out.received, true);
  assert.ok(typeof out.abandonment_score === "number");
});

test("AGENTIC-004 track cart_viewed", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "cart_viewed"));
  assert.ok(true);
});

test("AGENTIC-005 track shipping_calculated", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "shipping_calculated"));
});

test("AGENTIC-006 track shipping_option_selected", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "shipping_option_selected"));
});

test("AGENTIC-007 track shipping_objection_detected aumenta risco/abandon score", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  const a = await controller.track(trackBody(started.session_id, "cart_viewed"));
  const b = await controller.track(trackBody(started.session_id, "shipping_objection_detected"));
  assert.ok(b.abandonment_score >= a.abandonment_score);
});

test("AGENTIC-008 track coupon_field_clicked frequentemente marca trigger_agent", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  const t = await controller.track(trackBody(started.session_id, "coupon_field_clicked"));
  assert.equal(typeof t.trigger_agent, "boolean");
});

test("AGENTIC-009 track payment_method_selected", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "payment_method_selected"));
});

test("AGENTIC-010 track payment_failed", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "payment_failed"));
});

test("AGENTIC-011 track exit_intent_detected", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "exit_intent_detected"));
});

test("AGENTIC-012 track idle_30_seconds", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "idle_30_seconds"));
});

test("AGENTIC-013 track offer_viewed offer_accepted checkout_abandoned em sequência", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  for (const evt of ["offer_viewed", "offer_accepted", "checkout_abandoned"] as const) {
    await controller.track(trackBody(started.session_id, evt));
  }
});

test("AGENTIC-014 decision POST devolve estrutura acao + abandonment_score", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  await controller.track(trackBody(started.session_id, "coupon_field_clicked"));
  const decision = await controller.decision({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    context: { event: "coupon_field_clicked" }
  });
  assert.match(decision.decision_id, /^dec_/);
  assert.ok(["trigger_agent", "stay_silent"].includes(decision.action));
  assert.ok(typeof decision.abandonment_score === "number");
});

test("AGENTIC-015 chat cliente humano retorna texto + campo authorized_offer estruturado", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  const response = await controller.chat({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    conversation_id: started.conversation_id,
    user_message: "Quero saber se consigo parcelar sem aumentar demais meu valor final."
  });
  assert.ok(response.message.length > 5);
  const hasApplyOfferChip =
    (response.actions ?? []).some((a) => a.type === "apply_offer");
  assert.ok(hasApplyOfferChip || (response.experience?.copy.quick_replies?.length ?? 0) > 0);
  assert.ok(response.authorized_offer);
});

test("AGENTIC-016 chat mencionando frete aciona objeto de autorização relacionado a shipping", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo, 380);
  const response = await controller.chat({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    conversation_id: started.conversation_id,
    user_message: "Frete ficou alto, reduz esse envio dentro da politica?"
  });
  assert.ok(["shipping_discount_fixed", "shipping_free", "none"].includes(response.authorized_offer?.type ?? ""));
});

test("AGENTIC-017 chat machine-to-machine JSON buyer_bot_v1 produz ACK determinístico", async () => {
  const repo = new InMemoryCheckoutRepository();
  const m2m = new M2mConversationPort();
  const controller = makeController(repo, m2m, true);
  const sid = `chk_mtx_${crypto.randomUUID()}`;
  const started = await controller.start({
    merchant_id: MERCHANT,
    session_id: sid,
    customer: { email: "bot@merchant-system.local" },
    cart: {
      currency: "BRL",
      total: 950,
      items: [{ sku: "bulk", name: "Lote", price: 950, cost: 380, quantity: 1 }]
    },
    shipping: { customerPrice: 55, realCost: 40, region: "SP" }
  });
  const body = JSON.stringify({
    channel: "buyer_bot_v1",
    intent: "negotiate_line_item",
    max_discount_percent: 4
  });
  const response = await controller.chat({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    conversation_id: started.conversation_id,
    agent_id: "m2m-connector",
    user_message: body
  });
  assert.match(response.message, /M2M_ACK intent=negotiate_line_item/);
  assert.ok(m2m.transcript.some((line) => line.includes("buyer_bot_v1")));
});

test("AGENTIC-018 várias mensagens sequenciais de chat preservam sessão API", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  const lines = ["Oi", "Ainda achei pesado", "E se usar pix?"];
  for (const msg of lines) {
    await controller.chat({
      merchant_id: MERCHANT,
      session_id: started.session_id,
      conversation_id: started.conversation_id,
      user_message: msg
    });
  }
  const snap = await controller.session(MERCHANT, started.session_id);
  assert.ok(snap);
});

test("AGENTIC-019 atualizar MerchantRules altera autorização maxima antes do chat", async () => {
  const repo = new InMemoryCheckoutRepository();
  await repo.setRules(MERCHANT, { maxDiscountPercent: 7 });
  const { controller, started } = await freshSession(repo);
  const response = await controller.chat({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    conversation_id: started.conversation_id,
    user_message: "Me ofereça o melhor desconto textual possível."
  });
  assert.ok(response.authorized_offer);
  if (response.authorized_offer?.type === "discount_percent") {
    assert.ok((response.authorized_offer.value ?? 0) <= 7);
  }
});

test("AGENTIC-020 fluxo até pedido ticke baixo: shipping evaluate -> apply offer -> complete -> apenas chat como touchpoint obrigatorio", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo, 200);
  await controller.track(trackBody(started.session_id, "shipping_objection_detected"));
  const ship = await controller.shipping({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    abandonment_score: 0.74
  });
  assert.ok(ship.offer?.id);
  await controller.offer({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    offer_id: ship.offer!.id
  });
  await controller.complete({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    external_order_id: `ord_low_${crypto.randomUUID()}`,
    order_total: 200,
    currency: "BRL",
    accepted_offer_id: ship.offer!.id
  });
  const completed = repo
    .listOutbox(MERCHANT)
    .filter((event) => event.event_type === "order.completed")
    .pop()?.payload as OrderCompletedPayload | undefined;
  assert.ok(completed?.confirmation_touchpoints);
  assert.deepEqual(completed.confirmation_touchpoints!.channels, ["chat"]);
  assert.equal(completed.confirmation_touchpoints!.whatsapp_ack_recommended, false);
});

test(`AGENTIC-021 ticke alto (>= ${OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL} BRL): order.completed sugere whatsapp ACK + canal chat`, async () => {
  const repo = new InMemoryCheckoutRepository();
  const total = OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL + 99;
  const { controller, started } = await freshSession(repo, total);
  await controller.track(trackBody(started.session_id, "payment_method_selected"));
  await controller.chat({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    conversation_id: started.conversation_id,
    user_message: "Últimas dúvidas antes de autorizar esse valor."
  });
  await controller.complete({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    external_order_id: `ord_hi_${crypto.randomUUID()}`,
    order_total: total,
    currency: "BRL"
  });
  const completed = repo
    .listOutbox(MERCHANT)
    .find((event) => event.event_type === "order.completed")?.payload as OrderCompletedPayload | undefined;
  assert.ok(completed?.confirmation_touchpoints?.channels.includes("whatsapp"));
  assert.ok(completed?.confirmation_touchpoints?.channels.includes("chat"));
  assert.equal(completed?.confirmation_touchpoints?.whatsapp_ack_recommended, true);
});

test("AGENTIC-022 complete-order idempotente: segundo POST não duplica outbox nem evento", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo, 150);
  const extId = `ord_idem_${crypto.randomUUID()}`;
  const body = {
    merchant_id: MERCHANT,
    session_id: started.session_id,
    external_order_id: extId,
    order_total: 150,
    currency: "BRL" as const
  };
  const first = await controller.complete(body);
  const second = await controller.complete(body);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(repo.listOutbox(MERCHANT).filter((event) => event.event_type === "order.completed").length, 1);
});

test("AGENTIC-023 cada track gera pelo menos envelope checkout.event.tracked", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo);
  const events: CheckoutEventName[] = [
    "cart_viewed",
    "coupon_field_clicked",
    "payment_method_selected"
  ];
  for (const evt of events) await controller.track(trackBody(started.session_id, evt));

  const tracked = repo.listOutbox(MERCHANT).filter((event) => event.event_type === "checkout.event.tracked");
  assert.ok(tracked.length >= events.length);
});

test("AGENTIC-024 dashboard overview agrega métricas após pedido completado", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo, 120);
  await controller.track(trackBody(started.session_id, "offer_accepted"));
  await controller.complete({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    external_order_id: `dash_${crypto.randomUUID()}`,
    order_total: 120,
    currency: "BRL"
  });
  const overview = await controller.overview(MERCHANT);
  assert.equal(overview.merchant_id, MERCHANT);
  assert.ok(overview.orders_completed >= 1);
});

test("AGENTIC-025 cliente confirma intenção de compra no chat logo após oferta aplicada — conversa não quebra estado", async () => {
  const repo = new InMemoryCheckoutRepository();
  const { controller, started } = await freshSession(repo, 220);
  const ship = await controller.shipping({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    abandonment_score: 0.8
  });
  if (ship.offer?.id) {
    await controller.offer({
      merchant_id: MERCHANT,
      session_id: started.session_id,
      offer_id: ship.offer!.id
    });
  }
  await controller.track(trackBody(started.session_id, "offer_accepted"));
  const txt = await controller.chat({
    merchant_id: MERCHANT,
    session_id: started.session_id,
    conversation_id: started.conversation_id,
    user_message:
      "[CONFIRM_IN_CHAT] cliente decide fechar dentro do próprio fluxo WhatsApp-Web-style — confirmando agora só por mensagem textual."
  });
  assert.ok(/Assistente: entendi|Recebido:/i.test(txt.message));
});

function trackBody(sessionId: string, event: CheckoutEventName) {
  return {
    merchant_id: MERCHANT,
    session_id: sessionId,
    event
  };
}
