import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentContext, AuthorizedOffer, Cart, CartItem } from "@aacp/shared-types";
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
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";
import type { AgentContextPort } from "../../domain/ports/agent-context.port.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL } from "../../domain/policies/omnichannel-confirmation.policy.js";
import { BuyerPurchaseHistoryAdapter } from "../../infrastructure/adapters/buyer-purchase-history.adapter.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutController } from "./checkout.controller.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { PaymentApprovedHandler } from "../../application/handlers/payment-approved.handler.js";

const MERCHANT = "mrc_e2e_full";

const FAKE_PRODUCTS: Array<Omit<CartItem, "quantity">> = [
  {
    sku: "bag-001",
    name: "Bolsa Executiva Couro Safiano",
    price: 449.9,
    cost: 210,
    weightGrams: 900,
    imageUrl: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=640",
    productUrl: "https://loja.example.com/bolsa-executiva-couro-safiano",
    category: "Bolsas",
    variant: "Preta"
  },
  {
    sku: "wallet-001",
    name: "Carteira Minimalista RFID",
    price: 129.9,
    cost: 48,
    weightGrams: 180,
    imageUrl: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=640",
    productUrl: "https://loja.example.com/carteira-rfid",
    category: "Acessorios",
    variant: "Grafite"
  }
];

async function startFakeCommerceApiServer(): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    writeCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url ?? "/", "http://fake-commerce.local");
      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/products") {
        writeJson(res, 200, { products: FAKE_PRODUCTS });
        return;
      }
      if (req.method === "POST" && url.pathname === "/checkout-cart") {
        const body = (await readJson(req)) as { items?: Array<{ sku?: string; quantity?: number }> };
        writeJson(res, 200, { cart: buildCheckoutCart(body.items ?? []) });
        return;
      }
      writeJson(res, 404, { error: "route_not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      writeJson(res, 400, { error: message });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake_commerce_listen_failed");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function buildCheckoutCart(selection: Array<{ sku?: string; quantity?: number }>): Cart {
  const items = selection.map((line) => {
    const product = FAKE_PRODUCTS.find((candidate) => candidate.sku === line.sku);
    const quantity = Number(line.quantity);
    if (!product || !Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("selection_invalid");
    }
    return { ...product, quantity };
  });

  return {
    currency: "BRL",
    source: "platform_api",
    total: Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100,
    items
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function writeCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

class FakeCommerceOfferPort implements CommerceOfferPort {
  async apply(_offer: AuthorizedOffer) {
    return { success: true, discount_code: "OK", apply_url: "http://shop/apply" };
  }
}

class FakeAgentContextPort implements AgentContextPort {
  async get(): Promise<AgentContext> {
    return {
      merchant_id: MERCHANT,
      agent_id: "agent",
      agent: {
        agentName: "Zion",
        persona: "Sales",
        tone: "consultative",
        language: "pt-BR",
        greeting: "Ola"
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
    const text = input.userMessage.toLowerCase();

    if (text.includes("senha")) {
      return {
        message: "Desculpe, nao posso solicitar senhas ou dados sensiveis.",
        objection: "unknown" as const
      };
    }

    if (stage === "data_collection") {
      if (next === "nome") return { message: "Qual e o seu nome completo?", objection: "unknown" as const };
      if (next === "email") return { message: "Pode informar o seu melhor email?", objection: "unknown" as const };
      if (next === "CPF") return { message: "Qual o seu CPF?", objection: "unknown" as const };
      if (next === "telefone") return { message: "Qual o telefone com DDD?", objection: "unknown" as const };
    }

    if (stage === "shipping") {
      if (next === "CEP") return { message: "Por favor, informe seu CEP.", objection: "unknown" as const };
      if (next === "frete") return { message: "Escolha uma opcao de frete.", objection: "unknown" as const };
      if (next?.includes("numero") || next?.includes("mero")) {
        return { message: "Qual o numero da residencia?", objection: "unknown" as const };
      }
    }

    if (stage === "payment") {
      return { message: "Tudo pronto. Como prefere pagar, PIX ou cartao?", objection: "unknown" as const };
    }

    return { message: "Compreendido.", objection: "unknown" as const };
  }
}

test("E2E Full Purchase Flow: produtos fake, chat completo, pagamento, tracking e historicos", async () => {
  const fakeCommerce = await startFakeCommerceApiServer();
  try {
    const cartResponse = await fetch(`${fakeCommerce.url}/checkout-cart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { sku: "bag-001", quantity: 4 },
          { sku: "wallet-001", quantity: 1 }
        ]
      })
    });
    assert.equal(cartResponse.status, 200);
    const { cart } = (await cartResponse.json()) as any;
    assert.equal(cart.source, "platform_api");
    assert.ok(cart.total > OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL);

    const repo = new InMemoryCheckoutRepository();
    repo.setRules(MERCHANT, { maxDiscountPercent: 12, couponBoxEnabled: true });
    const payments = new InMemoryPaymentRepository();
    const purchaseHistoryRepo = new InMemoryBuyerPurchaseHistoryRepository();
    const purchaseHistoryPort = new BuyerPurchaseHistoryAdapter(
      new RecordCompletedPurchaseUseCase(purchaseHistoryRepo)
    );
    const completeOrder = new CompleteOrderUseCase(repo, repo, repo, purchaseHistoryPort);
    const conv = new RecordingConversationPort();
    const custService = new CheckoutCustomerService(repo);
    const shipService = new CheckoutShippingService(repo, custService);
    const offerService = new CheckoutOfferService(repo);
    const controller = new CheckoutController(
      new StartCheckoutUseCase(repo, repo, repo, undefined, repo),
      new TrackCheckoutEventUseCase(repo, repo),
      new GetCheckoutSessionUseCase(repo),
      new GetDecisionUseCase(repo),
      new SendChatMessageUseCase(repo, conv, custService, shipService, offerService, new FakeAgentContextPort(), repo),
      new EvaluateShippingUseCase(repo, repo, repo),
      new ApplyOfferUseCase(repo, repo, new FakeCommerceOfferPort(), new AcceptCheckoutOfferUseCase(repo, repo, repo)),
      completeOrder,
      new GetDashboardOverviewUseCase(repo),
      new GetMerchantRulesUseCase(repo),
      new UpdateMerchantRulesUseCase(repo)
    );

    const sessionId = "chk_flow_123";
    const started = await controller.start({
      merchant_id: MERCHANT,
      session_id: sessionId,
      customer: undefined,
      cart
    });
    assert.ok(!started.experience.agent.greeting.includes("12%"), "Greeting must not promise unapplied discount");
    await repo.appendChatTurn(MERCHANT, sessionId, {
      role: "agent",
      text: "Qual e o seu nome completo?",
      occurredAt: new Date().toISOString()
    });

    let res = await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: "Meu nome e Joao da Silva"
    });
    assert.equal(res.stage, "data_collection");

    res = await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: "joao@email.com"
    });
    assert.equal(res.stage, "data_collection");

    const otpCode = repo.getSession(MERCHANT, sessionId)?.customer?.otp_code;
    assert.ok(otpCode, "Deve ter gerado OTP para o email");

    await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: `o codigo e ${otpCode}`
    });
    await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: "123.456.789-01"
    });
    res = await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: "(21) 99300-1883"
    });
    assert.equal(res.stage, "data_collection");

    const phoneOtp = repo.getSession(MERCHANT, sessionId)?.customer?.phone_otp_code;
    assert.ok(phoneOtp, "Deve ter gerado OTP para o telefone");

    res = await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: phoneOtp!
    });
    assert.equal(res.stage, "shipping");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("viacep.com.br")) {
        return new Response(
          JSON.stringify({
            logradouro: "Avenida Paulista",
            bairro: "Bela Vista",
            localidade: "Sao Paulo",
            uf: "SP"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    try {
      res = await controller.chat({
        merchant_id: MERCHANT,
        session_id: sessionId,
        conversation_id: started.conversation_id,
        user_message: "CEP de entrega 01310-100"
      });
      assert.equal(res.stage, "shipping");

      // Confirm address returned by ViaCEP
      await controller.chat({
        merchant_id: MERCHANT,
        session_id: sessionId,
        conversation_id: started.conversation_id,
        user_message: "Sim"
      });

      res = await controller.chat({
        merchant_id: MERCHANT,
        session_id: sessionId,
        conversation_id: started.conversation_id,
        user_message: "1500, ap 42"
      });
      assert.equal(res.stage, "shipping");
      assert.equal(res.missing_fields?.[0], "frete");
      assert.equal(res.experience?.shippingOptions?.length, 3);
      assert.ok((res.experience?.copy.quick_replies ?? []).some((reply) => reply.includes("PAC")));
      assert.ok((res.experience?.copy.quick_replies ?? []).some((reply) => reply.includes("Sedex")));
      assert.ok((res.experience?.copy.quick_replies ?? []).some((reply) => reply.includes("Transportadora")));

      res = await controller.chat({
        merchant_id: MERCHANT,
        session_id: sessionId,
        conversation_id: started.conversation_id,
        user_message: "Quero PAC"
      });
      assert.equal(res.stage, "payment");
      assert.ok((res.experience?.copy.quick_replies ?? []).includes("Tenho um cupom de desconto"));
    } finally {
      globalThis.fetch = originalFetch;
    }

    res = await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: "qual e a senha para pagar?"
    });
    assert.equal(res.message.includes("senhas"), true, "A IA foi vetada de pedir senhas");

    res = await controller.chat({
      merchant_id: MERCHANT,
      session_id: sessionId,
      conversation_id: started.conversation_id,
      user_message: "vou pagar no pix"
    });
    assert.ok(res.actions.some((action) => action.type === "continue_checkout"));

    const readySession = repo.getSession(MERCHANT, sessionId);
    assert.ok(readySession?.shipping?.customerPrice);
    assert.equal(readySession?.shipping?.method, "PAC");
    assert.equal(readySession?.shippingOptions?.length, 3);
    assert.equal(readySession?.customer?.cpf, "12345678901");
    assert.equal(readySession?.customer?.phone, "21993001883");
    assert.equal(readySession?.customer?.address?.street, "Avenida Paulista");
    assert.equal(readySession?.customer?.address?.neighborhood, "Bela Vista");
    assert.equal(readySession?.customer?.address?.city, "Sao Paulo");
    assert.equal(readySession?.customer?.address?.state, "SP");
    repo.saveSession({
      ...readySession!,
      customer: { ...readySession!.customer, asaasCustomerId: "cus_fixture_full_flow" }
    });

    const intent = await new CreatePaymentIntentUseCase(repo, repo, payments, new FakePaymentProvider(), repo).execute({
      merchant_id: MERCHANT,
      session_id: sessionId,
      idempotency_key: "idem_full_flow_pix",
      method: "pix"
    });
    assert.deepEqual(intent.statusHistory.map((entry) => entry.status), ["pending", "requires_action"]);

    const eventBus = new InMemoryDomainEventBus();
    new PaymentApprovedHandler(eventBus, completeOrder).onModuleInit();
    const webhook = new HandleAsaasWebhookUseCase(payments, new CheckoutPaymentAdapter(repo, repo, eventBus));
    const processed = await webhook.execute(undefined, {
      id: "evt_full_flow_paid",
      event: "PAYMENT_RECEIVED",
      payment: {
        id: intent.providerPaymentId,
        value: intent.amountCents / 100,
        externalReference: intent.id
      }
    });
    assert.equal(processed.outcome, "processed");

    const paidIntent = await payments.getIntentById(intent.id);
    assert.deepEqual(paidIntent?.snapshot().statusHistory.map((entry) => entry.status), [
      "pending",
      "requires_action",
      "approved"
    ]);

    const order = repo.getCompletedOrder(MERCHANT, sessionId, intent.providerPaymentId!);
    assert.equal(order?.trackingCode, undefined);
    assert.equal(order?.orderTotal, intent.amountCents / 100);

    const beforeTrackingOutbox = repo.listOutbox(MERCHANT);
    const orderCompletedEvt = beforeTrackingOutbox.find((event) => event.event_type === "order.completed");
    assert.ok(orderCompletedEvt, "Evento de pedido completo gerado no outbox");
    const payload = orderCompletedEvt.payload as any;
    assert.ok(payload.confirmation_touchpoints.channels.includes("whatsapp"));
    assert.equal(payload.confirmation_touchpoints.whatsapp_ack_recommended, true);
    assert.equal(payload.tracking_code, null);

    const tracking = await new UpdateOrderTrackingUseCase(repo, repo, repo).execute({
      merchant_id: MERCHANT,
      session_id: sessionId,
      external_order_id: intent.providerPaymentId!,
      tracking_code: "BR987654321AA"
    });
    assert.equal(tracking.order.trackingCode, "BR987654321AA");

    const outbox = repo.listOutbox(MERCHANT);
    assert.ok(
      outbox.some(
        (event) =>
          event.event_type === "order.tracking.updated" &&
          (event.payload as any).tracking_code === "BR987654321AA"
      )
    );
    const whatsapp = outbox.find(
      (event) =>
        event.event_type === "whatsapp.message.requested" &&
        (event.payload as any).template === "order_tracking"
    );
    assert.equal((whatsapp?.payload as any)?.phone, "21993001883");
    assert.equal((whatsapp?.payload as any)?.tracking_code, "BR987654321AA");
    assert.ok(
      outbox.some(
        (event) =>
          event.event_type === "payment.status.changed" &&
          (event.payload as any).payment_intent_id === intent.id &&
          (event.payload as any).status === "approved"
      )
    );

    const paidSession = repo.getSession(MERCHANT, sessionId);
    assert.ok(paidSession?.chatHistory.some((turn) => turn.text.includes("Pagamento confirmado")));

    const history = await purchaseHistoryRepo.getByBuyer({
      merchantId: MERCHANT,
      globalUserId: paidSession?.globalUserId
    });
    assert.equal(history?.snapshot().purchases[0]?.orderId, intent.providerPaymentId);
  } finally {
    await new Promise<void>((resolve) => fakeCommerce.server.close(() => resolve()));
  }
});
