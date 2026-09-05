import test from "node:test";
import assert from "node:assert/strict";
import type { AgentContext } from "@zyon/shared-types";
import type { AgentContextPort } from "../domain/ports/agent-context.port.js";
import type { ConversationPort } from "../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { MerchantTheme } from "../../merchant/domain/merchant.types.js";
import type { BuyerEmailCapturePayload } from "../infrastructure/brevo-buyer-email.notifier.js";
import {
  checkoutSession,
  merchantRules,
  startCheckoutRequest,
  completeOrderRequest
} from "./checkout-test-fixtures.js";
import { StartCheckoutTestHarness as StartCheckoutUseCase } from "./start-checkout-test-harness.js";
import { SendChatMessageUseCase } from "../application/use-cases/send-chat-message.use-case.js";
import { BrevoBuyerEmailNotifier } from "../infrastructure/brevo-buyer-email.notifier.js";
import { CompleteOrderUseCase } from "../application/use-cases/complete-order.use-case.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../application/services/checkout-offer.service.js";
import { OtpService } from "../application/services/otp.service.js";
import { BuyerRecognitionService } from "../application/services/buyer-recognition.service.js";
import { BuyerAccountPersistenceService } from "../application/services/buyer-account-persistence.service.js";
import { InMemoryBuyerAccountRepository } from "../../buyer-account/infrastructure/in-memory-buyer-account.repository.js";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";

function createTestUseCase(
  repository: InMemoryCheckoutRepository,
  conversation: ConversationPort,
  agentContext?: AgentContextPort,
  merchantRepo?: MerchantRepository,
  brevoNotifier?: BrevoBuyerEmailNotifier,
  crossSellUseCase?: { execute(input: unknown): Promise<unknown[]> },
  buyerAccounts?: InMemoryBuyerAccountRepository
) {
  const otpService = new OtpService();
  const recognitionService = new BuyerRecognitionService(repository, buyerAccounts);
  const persistenceService = new BuyerAccountPersistenceService(buyerAccounts);
  const custService = new CheckoutCustomerService(repository, brevoNotifier, otpService, recognitionService, persistenceService);
  const shipService = new CheckoutShippingService(repository, custService);
  const offerService = new CheckoutOfferService(repository);
  return new SendChatMessageUseCase(
    repository,
    conversation,
    custService,
    shipService,
    offerService,
    agentContext,
    merchantRepo,
    crossSellUseCase as never
  );
}

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

  constructor(private readonly context?: AgentContext) { }

  async get(input: Parameters<AgentContextPort["get"]>[0]) {
    this.calls.push(input);
    return this.context;
  }
}

test("SendChatMessageUseCase passes merchant agent context to conversation without authorizing from capabilities", async () => {
  const repository = new InMemoryCheckoutRepository();
  const started = await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_1" }));
  const conversation = new RecordingConversationPort();
  const agentContext = new FakeAgentContextPort(testAgentContext());
  const useCase = createTestUseCase(repository, conversation, agentContext);

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
  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_1" }));
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    conversation_id: "conv_1",
    user_message: "frete caro"
  });

  assert.equal(conversation.calls[0]?.agentContext, undefined);
  assert.equal(conversation.calls[0]?.authorizedOffer instanceof Object, true);
});

test("SendChatMessageUseCase extracts email/CPF/phone/CEP and patches session.customer", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_extract", customer: undefined, shipping: undefined })
  );
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_extract",
    conversation_id: "conv_x",
    user_message: "Meu email é JOAO@ex.com, CPF 123.456.789-09, fone (11) 98888-7777, CEP 01001-000"
  });

  const session = await repository.getSession("mrc_1", "chk_extract");
  assert.equal(session?.customer?.email, "joao@ex.com");
  assert.equal(session?.customer?.cpf, "12345678909");
  assert.equal(session?.customer?.phone, "11988887777");
  assert.equal(session?.customer?.address?.zip, "01001000");
  assert.equal(conversation.calls[0]?.stage, "data_collection");
});

test("SendChatMessageUseCase captures fullName when previous agent turn asked for the name", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_name", customer: undefined })
  );
  await repository.appendChatTurn("mrc_1", "chk_name", {
    role: "agent",
    text: "Antes de continuar, posso saber seu nome completo?",
    occurredAt: new Date().toISOString()
  });
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_name",
    conversation_id: "conv_name",
    user_message: "Joao Silva"
  });

  const session = await repository.getSession("mrc_1", "chk_name");
  assert.equal(session?.customer?.fullName, "Joao Silva");
});

test("SendChatMessageUseCase generates email OTP when embed prefilled email and user starts registration", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({
      session_id: "chk_prefill",
      customer: { email: "embed@aacp.io", isReturning: false }
    })
  );
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_prefill",
    conversation_id: "conv_prefill",
    user_message: "Iniciar cadastro"
  });

  const session = await repository.getSession("mrc_1", "chk_prefill");
  assert.equal(session?.customer?.email, "embed@aacp.io");
  assert.ok(session?.customer?.otp_code, "gera OTP mesmo com e-mail já na sessão");
});

test("SendChatMessageUseCase requires current OTP for a complete account hinted by embed", async () => {
  const repository = new InMemoryCheckoutRepository();
  const buyerAccounts = new InMemoryBuyerAccountRepository();
  await buyerAccounts.save(new BuyerAccount({
    globalUserId: "buyer_embed_prefill",
    email: "costaadiego1989@gmail.com",
    passwordHash: "hash",
    displayName: "Diego Costa",
    phone: "21993001883",
    cpf: "05178178700",
    address: {
      zip: "25958180",
      street: "Rua Paulo Lossio",
      number: "95",
      complement: "",
      neighborhood: "Araras",
      city: "Teresopolis",
      state: "RJ"
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  const otpService = new OtpService();
  const recognitionService = new BuyerRecognitionService(repository, buyerAccounts);
  const persistenceService = new BuyerAccountPersistenceService(buyerAccounts);
  const customerService = new CheckoutCustomerService(repository, undefined, otpService, recognitionService, persistenceService);
  await new StartCheckoutUseCase(
    repository,
    repository,
    repository,
    undefined,
    undefined,
    undefined,
    undefined,
    customerService
  ).execute(
    startCheckoutRequest({
      session_id: "chk_embed_account",
      customer: { email: "costaadiego1989@gmail.com", isReturning: false },
      shipping: undefined
    })
  );
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation, undefined, undefined, undefined, undefined, buyerAccounts);

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_embed_account",
    conversation_id: "conv_embed_account",
    user_message: "costaadiego1989@gmail.com"
  });

  const session = await repository.getSession("mrc_1", "chk_embed_account");
  assert.equal(session?.customer?.recognized_buyer, undefined);
  assert.equal(session?.customer?.email_verified, undefined);
  assert.equal(session?.customer?.fullName, undefined);
  assert.ok(session?.customer?.otp_code);
  assert.notEqual(session?.globalUserId, "buyer_embed_prefill");
  assert.equal(res.stage, "data_collection");
  assert.equal(res.missing_fields?.[0], "código de verificação");
  const verified = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_embed_account", conversation_id: "conv_embed_account", user_message: session!.customer!.otp_code! });
  assert.equal(repository.getSession("mrc_1", "chk_embed_account")?.customer?.recognized_buyer, true);
  assert.equal(verified.stage, "shipping");
});

test("SendChatMessageUseCase returns refreshed experience snapshot with stage and missing fields", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_exp", customer: undefined })
  );
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_exp",
    conversation_id: "conv_exp",
    user_message: "joao@ex.com"
  });

  assert.ok(response.experience, "experience snapshot returned");
  assert.equal(response.experience?.totals.currency, "BRL");
  assert.equal(response.experience?.customer?.email, "joao@ex.com");
  assert.equal(response.experience?.customer?.otp_code, undefined, "experience does not expose email OTP");
  assert.equal(response.stage, "data_collection");
  assert.ok(response.missing_fields && response.missing_fields.length > 0);
});

test("SendChatMessageUseCase appends buyer + agent turns and forwards history", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_h" }));
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  const first = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_h",
    conversation_id: "conv_1",
    user_message: "esta caro"
  });
  const second = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_h",
    conversation_id: "conv_1",
    user_message: "ainda caro"
  });

  assert.equal(first.turns.length, 2, "first call: buyer + agent turn appended");
  assert.equal(first.turns[0]?.role, "buyer");
  assert.equal(first.turns[1]?.role, "agent");
  assert.equal(second.turns.length, 4);
  assert.equal(conversation.calls[1]?.history?.length, 2, "second call gets history of previous round");
  assert.ok(conversation.calls[1]?.cart, "cart forwarded to engine");
});

test("SendChatMessageUseCase jornada cadastro → ViaCEP mock → número → frete estimado → etapa pagamento e complete-order", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_full_journey", customer: undefined, shipping: undefined })
  );

  await repository.appendChatTurn("mrc_1", "chk_full_journey", {
    role: "agent",
    text: "Antes de continuar, qual é o seu nome completo?",
    occurredAt: new Date().toISOString()
  });

  const conversation = new RecordingConversationPort();
  const merchantRepo: MerchantRepository = {
    async getProfile(id) {
      return { id, name: "Loja E2E Journey", plan: "BOTH" };
    },
    async getRules() {
      return merchantRules();
    },
    async updateRules(mid, patch) {
      void mid;
      return { ...merchantRules(), ...patch };
    },
    async updateTheme(mid, theme) {
      void mid;
      return theme as MerchantTheme;
    },
    async getStripeConnectAccountId() {
      return undefined;
    },
    async setStripeConnectAccountId() {},
    async updateStoreCategory() {},
    async getStoreSettings() { return {}; },
    async updateStoreSettings(_mid: string, s: any) { return s; }
  };

  const brevoCaptured: BuyerEmailCapturePayload[] = [];
  const brevoNotifier = {
    notifyCaptured(p: BuyerEmailCapturePayload) {
      brevoCaptured.push(p);
    },
    async sendOtpCode() { }
  } as unknown as BrevoBuyerEmailNotifier;

  const useCase = createTestUseCase(repository, conversation, undefined, merchantRepo, brevoNotifier);

  const baseReq = {
    merchant_id: "mrc_1",
    session_id: "chk_full_journey",
    conversation_id: "conv_j_full"
  } as const;

  await useCase.execute({ ...baseReq, user_message: "meuemail.journey@test.com" });
  assert.equal(brevoCaptured.length, 1);
  assert.equal(brevoCaptured[0]?.buyerEmail, "meuemail.journey@test.com");

  const afterEmail = await repository.getSession("mrc_1", "chk_full_journey");
  const otpCode = afterEmail?.customer?.otp_code;
  assert.ok(otpCode, "gerou codigo de verificacao por e-mail");
  const afterEmailOtp = await useCase.execute({ ...baseReq, user_message: otpCode! });
  assert.equal(afterEmailOtp.experience?.customer?.otp_code, undefined, "experience nao expoe OTP apos validar email");

  await useCase.execute({ ...baseReq, user_message: "Maria Silva Santos" });
  assert.equal(brevoCaptured[0]?.buyerFirstNameHint, undefined);

  await useCase.execute({ ...baseReq, user_message: "529.982.247-25" });
  await useCase.execute({ ...baseReq, user_message: "(21) 99300-1883" });

  const afterPhone = await repository.getSession("mrc_1", "chk_full_journey");
  const phoneOtpCode = afterPhone?.customer?.phone_otp_code;
  assert.ok(phoneOtpCode, "gerou codigo de verificacao por sms");
  const afterPhoneOtp = await useCase.execute({ ...baseReq, user_message: phoneOtpCode! });
  assert.equal(afterPhoneOtp.experience?.customer?.phone_otp_code, undefined, "experience nao expoe OTP apos validar celular");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("viacep.com.br")) {
      return new Response(
        JSON.stringify({
          logradouro: "Avenida Paulista",
          bairro: "Bela Vista",
          localidade: "São Paulo",
          uf: "SP"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return originalFetch(input, init);
  };

  try {
    const afterCep = await useCase.execute({ ...baseReq, user_message: "CEP de entrega 01310-100" });
    assert.equal(afterCep.stage, "shipping");
    assert.ok(
      (afterCep.missing_fields ?? []).some((f) => f.includes("número") || f.includes("complemento") || f.includes("confirmar")),
      "após ViaCEP ainda falta confirmação/número/complemento"
    );
    assert.ok((afterCep.experience?.copy.quick_replies?.length ?? 0) > 0);

    // Confirm address returned by ViaCEP
    await useCase.execute({ ...baseReq, user_message: "Sim" });

    const afterNumber = await useCase.execute({ ...baseReq, user_message: "1500" });
    assert.equal(afterNumber.stage, "shipping");
    assert.ok((afterNumber.missing_fields ?? [])[0]?.includes("complemento"));
    assert.equal(afterNumber.experience?.shippingOptions?.length ?? 0, 0);

    const afterComplementQuestion = await useCase.execute({ ...baseReq, user_message: "Como informo o bloco?" });
    assert.equal(afterComplementQuestion.stage, "shipping");
    assert.ok((afterComplementQuestion.missing_fields ?? [])[0]?.includes("complemento"));
    assert.equal(afterComplementQuestion.experience?.shippingOptions?.length ?? 0, 0);
    assert.match(afterComplementQuestion.message, /bloco|apto|complemento|default reply/i);

    const afterAddr = await useCase.execute({ ...baseReq, user_message: "apartamento 42" });

    assert.equal(afterAddr.stage, "shipping");
    assert.equal(afterAddr.missing_fields?.[0], "frete");
    assert.equal(afterAddr.experience?.shippingOptions?.length, 3);
    assert.ok((afterAddr.experience?.copy.quick_replies ?? []).some((reply) => reply.includes("PAC")));
    assert.ok((afterAddr.experience?.copy.quick_replies ?? []).some((reply) => reply.includes("Sedex")));
    assert.ok((afterAddr.experience?.copy.quick_replies ?? []).some((reply) => reply.includes("Transportadora")));

    const afterFrete = await useCase.execute({ ...baseReq, user_message: "Quero PAC" });

    assert.equal(afterFrete.stage, "payment");
    assert.ok((afterFrete.experience?.copy.quick_replies ?? []).includes("PIX"));

    const session = await repository.getSession("mrc_1", "chk_full_journey");
    assert.ok(session?.shipping?.customerPrice && session.shipping.customerPrice > 0);
    assert.equal(session?.shipping?.method, "PAC");
    assert.equal(session?.shippingOptions?.length, 3);
    assert.ok(session.customer?.address?.street?.includes("Paulista"));

    const completed = await new CompleteOrderUseCase(repository, repository, repository).execute(
      completeOrderRequest({
        session_id: "chk_full_journey",
        external_order_id: "ord_full_journey_1",
        order_total: session.cart.total + (session.shipping?.customerPrice ?? 0),
        currency: "BRL"
      })
    );
    assert.equal(completed.recorded, true);
    assert.ok(completed.idempotent === false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SendChatMessageUseCase exposes cross-sell through experience instead of invalid chat action", async () => {
  const repository = new InMemoryCheckoutRepository();
  await repository.saveSession(checkoutSession({
    merchantId: "mrc_1",
    sessionId: "chk_cross_sell",
    conversationId: "conv_cross_sell",
    shipping: undefined,
    customer: {
      fullName: "Diego Costa",
      email: "diego@example.com",
      email_verified: true,
      cpf: "12345678901",
      phone: "21999999999",
      phone_verified: true,
      address_verified: true,
      address: {
        zip: "01310100",
        street: "Avenida Paulista",
        number: "1000",
        complement: "",
        neighborhood: "Bela Vista",
        city: "Sao Paulo",
        state: "SP"
      }
    },
    shippingOptions: [
      { carrier: "Correios", method: "PAC", customerPrice: 19.9, deliveryDays: 7, destinationZip: "01310100" },
      { carrier: "Correios", method: "Sedex", customerPrice: 29.9, deliveryDays: 3, destinationZip: "01310100" }
    ]
  }));

  const crossSellUseCase = {
    async execute() {
      return [{
        id: "sug_1",
        session_id: "chk_cross_sell",
        merchant_id: "mrc_1",
        promo_id: "promo_1",
        ranked_items: ["CART-COE-01"],
        agent_copy: "",
        computed_discount: 0,
        status: "pending",
        suggested_at: new Date().toISOString(),
        resolved_at: null
      }];
    }
  };
  const useCase = createTestUseCase(
    repository,
    new RecordingConversationPort(),
    undefined,
    undefined,
    undefined,
    crossSellUseCase
  );

  const response = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_cross_sell",
    conversation_id: "conv_cross_sell",
    user_message: "Quero PAC"
  });

  assert.equal(response.stage, "payment");
  assert.ok(response.actions.every((action) => action.type !== ("cross_sell" as never)));
  assert.equal(response.experience?.suggestedProducts?.[0]?.suggestion_id, "sug_1");
  assert.equal(response.experience?.suggestedProducts?.[0]?.sku, "CART-COE-01");
  assert.equal(response.experience?.suggestedProducts?.[0]?.name, "Carteira Slim RFID");
});

test("SendChatMessageUseCase gera quick_replies dinâmicas customizadas de acordo com guardrails (CRUD lojista)", async () => {
  const repository = new InMemoryCheckoutRepository();
  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_qr", customer: undefined, shipping: undefined })
  );

  const customRules = merchantRules();
  customRules.quickReplies = {
    data_collection: {
      telefone: ["Ligar no fixo", "Chamar no zap"]
    },
    payment: ["Quero pagar com Crypto", "Tenho um cupom"]
  };
  customRules.maxDiscountPercent = 0; // Lojista proibiu cupom
  customRules.couponBoxEnabled = false;
  repository.setRules("mrc_1", customRules);

  const merchantRepo: MerchantRepository = {
    async getProfile(id) {
      return { id, name: "QR Store" };
    },
    async getRules() {
      return customRules;
    },
    async updateRules() {
      return customRules;
    },
    async updateTheme(mid, theme) {
      return theme as MerchantTheme;
    },
    async getStripeConnectAccountId() {
      return undefined;
    },
    async setStripeConnectAccountId() {},
    async updateStoreCategory() {},
    async getStoreSettings() { return {}; },
    async updateStoreSettings(_mid: string, s: any) { return s; }
  };

  const useCase = createTestUseCase(repository, new RecordingConversationPort(), undefined, merchantRepo);

  const sessionTel = await repository.getSession("mrc_1", "chk_qr");
  if (sessionTel) {
    sessionTel.customer = {
      fullName: "Teste Nome",
      email: "teste@teste.com",
      email_verified: true,
      cpf: "05178178700"
    };
    await repository.saveSession(sessionTel);
  }

  const resTel = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_qr",
    conversation_id: "c1",
    user_message: "esse é meu cpf"
  });

  assert.equal(resTel.stage, "data_collection");
  const qrTel = resTel.experience?.copy.quick_replies ?? [];
  assert.equal(qrTel.includes("Chamar no zap"), true, "Retornou o custom reply aninhado para telefone");
  assert.equal(resTel.experience?.copy.expected_input_type, "tel");
  assert.equal(resTel.experience?.copy.focus_input, true);

  // Força o preenchimento da sessão para etapa de pagamento
  const session = await repository.getSession("mrc_1", "chk_qr");
  if (session) {
    session.customer = {
      fullName: "Teste Nome",
      email: "teste@teste.com",
      email_verified: true,
      cpf: "05178178700",
      phone: "21993001883",
      phone_verified: true,
      address_verified: true,
      address: {
        zip: "01310100",
        city: "SP",
        state: "SP",
        street: "Av",
        number: "100",
        complement: ""
      }
    };
    session.shipping = {
      customerPrice: 10,
      realCost: 10,
      carrier: "Correios",
      deliveryDays: 5
    };
    await repository.saveSession(session);
  }

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_qr",
    conversation_id: "c1",
    user_message: "E o frete?"
  });

  assert.equal(res.stage, "payment");
  const qr = res.experience?.copy.quick_replies ?? [];
  assert.equal(qr.includes("Quero pagar com Crypto"), true, "Retornou o custom reply do lojista");
  assert.equal(qr.includes("Tenho um cupom"), false, "Filtrou a menção de cupom porque maxDiscount=0 e couponBoxEnabled=false");
});

test.skip("SendChatMessageUseCase blocks duplicate email registration and returns chat error turn", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  // Setup session 1 with registered email
  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_1" }));
  const session1 = await repository.getSession("mrc_1", "chk_1");
  if (session1) {
    session1.customer = { email: "duplicado@aacp.io", fullName: "Comprador Um" };
    await repository.saveSession(session1);
  }

  // Setup session 2
  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_2" }));
  const session2 = await repository.getSession("mrc_1", "chk_2");
  if (session2) {
    session2.customer = { fullName: "Comprador Dois" };
    await repository.saveSession(session2);
  }

  // Try to register session 2 with duplicate email
  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_2",
    conversation_id: "conv_2",
    user_message: "Meu email é duplicado@aacp.io"
  });

  assert.equal(res.message.includes("Não é possível cadastrar com este e-mail"), true, "Retornou mensagem amigável de e-mail duplicado");
  const session2After = await repository.getSession("mrc_1", "chk_2");
  assert.notEqual(session2After?.customer?.email, "duplicado@aacp.io", "Não salvou o e-mail duplicado");
});

test("SendChatMessageUseCase recognizes existing buyer email and continues after verification", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const buyerAccounts = new InMemoryBuyerAccountRepository();
  await buyerAccounts.save(new BuyerAccount({
    globalUserId: "buyer_existing_1",
    email: "duplicado@aacp.io",
    passwordHash: "hash",
    displayName: "Comprador Existente",
    phone: "21999998888",
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  const useCase = createTestUseCase(repository, conversation, undefined, undefined, undefined, undefined, buyerAccounts);

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_prev" }));
  const previousSession = await repository.getSession("mrc_1", "chk_prev");
  if (previousSession) {
    previousSession.globalUserId = "buyer_existing_1";
    previousSession.customer = {
      email: "duplicado@aacp.io",
      email_verified: true,
      fullName: "Comprador Um",
      cpf: "12345678900",
      phone: "21999998888",
      phone_verified: true,
      address_verified: true,
      address: {
        zip: "01310100",
        street: "Avenida Paulista",
        number: "1000",
        complement: "",
        city: "Sao Paulo",
        state: "SP"
      }
    };
    await repository.saveSession(previousSession);
  }

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_2" }));
  const currentSession = await repository.getSession("mrc_1", "chk_2");
  if (currentSession) {
    currentSession.customer = { fullName: "Comprador Dois" };
    await repository.saveSession(currentSession);
  }

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_2",
    conversation_id: "conv_2",
    user_message: "Meu email Ã© duplicado@aacp.io"
  });

  const pending = await repository.getSession("mrc_1", "chk_2");
  assert.equal(pending?.customer?.email_verified, undefined);
  assert.equal(pending?.customer?.address, undefined);
  assert.notEqual(pending?.globalUserId, "buyer_existing_1");
  assert.ok(pending?.customer?.otp_code);
  await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_2", conversation_id: "conv_2", user_message: pending!.customer!.otp_code! });
  const sessionAfterEmail = await repository.getSession("mrc_1", "chk_2");
  assert.equal(sessionAfterEmail?.customer?.email, "duplicado@aacp.io");
  assert.equal(sessionAfterEmail?.customer?.recognized_buyer, true);
  assert.equal(sessionAfterEmail?.globalUserId, "buyer_existing_1");
  assert.equal(sessionAfterEmail?.customer?.email_verified, true);
  assert.equal(sessionAfterEmail?.customer?.phone, "21999998888");
  assert.equal(sessionAfterEmail?.customer?.cpf, "12345678900");
  assert.equal(sessionAfterEmail?.customer?.address?.street, "Avenida Paulista");
  assert.notEqual(res.missing_fields?.[0], "email");
});

test("SendChatMessageUseCase logs recognized buyer after email OTP and skips to shipping selection when profile is complete", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const buyerAccounts = new InMemoryBuyerAccountRepository();
  await buyerAccounts.save(new BuyerAccount({
    globalUserId: "buyer_account_only",
    email: "costaadiego1989@gmail.com",
    passwordHash: "hash",
    displayName: "Diego Costa",
    phone: "21993001883",
    cpf: "05178178700",
    address: {
      zip: "25958180",
      street: "Rua Paulo Lossio",
      number: "95",
      complement: "",
      neighborhood: "Araras",
      city: "Teresopolis",
      state: "RJ"
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  const useCase = createTestUseCase(repository, conversation, undefined, undefined, undefined, undefined, buyerAccounts);

  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_account_only", customer: undefined, shipping: undefined })
  );

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_account_only",
    conversation_id: "conv_account_only",
    user_message: "costaadiego1989@gmail.com"
  });

  const pending = await repository.getSession("mrc_1", "chk_account_only");
  assert.equal(pending?.customer?.email_verified, undefined);
  assert.equal(pending?.customer?.fullName, undefined);
  assert.notEqual(pending?.globalUserId, "buyer_account_only");
  assert.ok(pending?.customer?.otp_code);
  const verified = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_account_only", conversation_id: "conv_account_only", user_message: pending!.customer!.otp_code! });
  const afterEmail = await repository.getSession("mrc_1", "chk_account_only");
  assert.equal(afterEmail?.customer?.recognized_buyer, true);
  assert.equal(afterEmail?.globalUserId, "buyer_account_only");
  assert.equal(afterEmail?.customer?.email_verified, true);
  assert.equal(afterEmail?.customer?.fullName, "Diego Costa");
  assert.equal(afterEmail?.customer?.cpf, "05178178700");
  assert.equal(afterEmail?.customer?.phone, "21993001883");
  assert.equal(afterEmail?.customer?.phone_verified, true);
  assert.equal(afterEmail?.customer?.address?.number, "95");
  assert.equal(verified.stage, "shipping");
  assert.equal(verified.missing_fields?.[0], "frete");
  assert.equal(verified.experience?.shippingOptions?.length, 3);
});

test("SendChatMessageUseCase skips cadastro after OTP when older session has complete profile", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_old_complete", customer: undefined, shipping: undefined })
  );
  const oldSession = await repository.getSession("mrc_1", "chk_old_complete");
  if (oldSession) {
    oldSession.customer = {
      email: "costaadiego1989@gmail.com",
      email_verified: true,
      fullName: "Diego Costa",
      cpf: "05178178700",
      phone: "21993001883",
      phone_verified: true,
      address_verified: true,
      address: {
        zip: "22460000",
        street: "Rua Jardim Botanico",
        number: "1024",
        complement: "",
        neighborhood: "Jardim Botanico",
        city: "Rio de Janeiro",
        state: "RJ"
      }
    };
    oldSession.updatedAt = "2026-05-01T10:00:00.000Z";
    await repository.saveSession(oldSession);
  }

  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_new_returning", customer: undefined, shipping: undefined })
  );
  const newSession = await repository.getSession("mrc_1", "chk_new_returning");
  if (newSession) {
    newSession.customer = {
      email: "costaadiego1989@gmail.com",
      otp_code: "778899",
      email_verified: false
    };
    newSession.updatedAt = "2026-06-01T10:00:00.000Z";
    await repository.saveSession(newSession);
  }

  const verified = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_new_returning",
    conversation_id: "conv_new_returning",
    user_message: "778899"
  });

  const afterOtp = await repository.getSession("mrc_1", "chk_new_returning");
  assert.equal(afterOtp?.customer?.fullName, "Diego Costa");
  assert.equal(afterOtp?.customer?.cpf, "05178178700");
  assert.equal(afterOtp?.customer?.phone_verified, true);
  assert.equal(verified.stage, "shipping");
  assert.equal(verified.missing_fields?.[0], "frete");
  assert.notEqual(verified.missing_fields?.[0], "nome");
});

test("SendChatMessageUseCase rechecks existing buyer after OTP even when email turn was not flagged as recognized", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const buyerAccounts = new InMemoryBuyerAccountRepository();
  await buyerAccounts.save(new BuyerAccount({
    globalUserId: "buyer_rechecked_after_otp",
    email: "costaadiego1989@gmail.com",
    passwordHash: "hash",
    displayName: "Diego Costa",
    phone: "21993001883",
    cpf: "05178178700",
    address: {
      zip: "25958180",
      street: "Rua Paulo Lossio",
      number: "95",
      complement: "",
      neighborhood: "Araras",
      city: "Teresopolis",
      state: "RJ"
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  const useCase = createTestUseCase(repository, conversation, undefined, undefined, undefined, undefined, buyerAccounts);

  await new StartCheckoutUseCase(repository, repository, repository).execute(
    startCheckoutRequest({ session_id: "chk_otp_recheck", customer: undefined, shipping: undefined })
  );
  const session = await repository.getSession("mrc_1", "chk_otp_recheck");
  if (session) {
    session.customer = {
      fullName: "Diego Costa",
      email: "costaadiego1989@gmail.com",
      otp_code: "410597",
      email_verified: false
    };
    await repository.saveSession(session);
  }

  const verified = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_otp_recheck",
    conversation_id: "conv_otp_recheck",
    user_message: "410597"
  });

  const afterOtp = await repository.getSession("mrc_1", "chk_otp_recheck");
  assert.equal(afterOtp?.customer?.recognized_buyer, true);
  assert.equal(afterOtp?.globalUserId, "buyer_rechecked_after_otp");
  assert.equal(afterOtp?.customer?.cpf, "05178178700");
  assert.equal(afterOtp?.customer?.phone, "21993001883");
  assert.equal(afterOtp?.customer?.address?.number, "95");
  assert.equal(verified.stage, "shipping");
  assert.equal(verified.missing_fields?.[0], "frete");
  assert.equal(verified.experience?.shippingOptions?.length, 3);
});

test("SendChatMessageUseCase blocks mismatched email OTP validation and returns chat error turn", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_otp" }));
  const session = await repository.getSession("mrc_1", "chk_otp");
  if (session) {
    session.customer = { email: "user@aacp.io", fullName: "User Test", otp_code: "123456", email_verified: false };
    await repository.saveSession(session);
  }

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_otp",
    conversation_id: "conv_otp",
    user_message: "654321" // Incorrect OTP
  });

  assert.equal(res.message.includes("Código de verificação inválido"), true, "Retornou mensagem de erro de OTP");
  const sessionAfter = await repository.getSession("mrc_1", "chk_otp");
  assert.equal(sessionAfter?.customer?.email_verified, false, "E-mail permaneceu como não verificado");
});

test("SendChatMessageUseCase does not treat a non-code reply as invalid email OTP", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_otp_text" }));
  const session = await repository.getSession("mrc_1", "chk_otp_text");
  if (session) {
    session.customer = { email: "user@aacp.io", otp_code: "123456", email_verified: false };
    await repository.saveSession(session);
  }
  await repository.appendChatTurn("mrc_1", "chk_otp_text", {
    role: "agent",
    text: "Antes de continuar, posso saber seu nome completo?",
    occurredAt: new Date().toISOString()
  });

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_otp_text",
    conversation_id: "conv_otp_text",
    user_message: "diego costa"
  });

  const sessionAfter = await repository.getSession("mrc_1", "chk_otp_text");
  assert.equal(sessionAfter?.customer?.email_verified, false);
  assert.equal(sessionAfter?.customer?.fullName, "Diego Costa");
  assert.ok(res.missing_fields?.[0]?.includes("verifica"));
  assert.equal(res.message.toLowerCase().includes("inv"), false);
});

test("SendChatMessageUseCase keeps email OTP error active even when phone was already verified", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_otp_phone_verified" }));
  const session = await repository.getSession("mrc_1", "chk_otp_phone_verified");
  if (session) {
    session.customer = {
      email: "recognized@aacp.io",
      fullName: "User Test",
      otp_code: "123456",
      email_verified: false,
      phone: "21999998888",
      phone_verified: true
    };
    await repository.saveSession(session);
  }

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_otp_phone_verified",
    conversation_id: "conv_otp_phone_verified",
    user_message: "654321"
  });

  assert.equal(res.message.includes("Código de verificação inválido"), true);
  assert.equal(res.stage, "data_collection");
  assert.equal(res.missing_fields?.[0], "código de verificação");
});

test("SendChatMessageUseCase accepts an email OTP pasted with surrounding text", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_otp_log" }));
  const session = await repository.getSession("mrc_1", "chk_otp_log");
  if (session) {
    session.customer = { email: "user@aacp.io", fullName: "User Test", otp_code: "776655", email_verified: false };
    await repository.saveSession(session);
  }

  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_otp_log",
    conversation_id: "conv_otp_log",
    user_message: "Meu código de verificação é 776655"
  });

  const sessionAfter = await repository.getSession("mrc_1", "chk_otp_log");
  assert.equal(sessionAfter?.customer?.email_verified, true, "E-mail foi verificado mesmo com metadados do log");
  assert.equal(sessionAfter?.customer?.otp_code, "", "Codigo de OTP foi limpo apos validar");
  assert.equal(res.missing_fields?.[0], "telefone");
});

test("SendChatMessageUseCase handles phone input, SMS OTP generation, and validation", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_phone" }));
  const session = await repository.getSession("mrc_1", "chk_phone");
  if (session) {
    session.customer = {
      fullName: "Thiago Silva",
      email: "thiago@aacp.io",
      email_verified: true,
      cpf: "11122233344"
    };
    await repository.saveSession(session);
  }

  // 1. Enter phone number
  const res1 = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_phone",
    conversation_id: "conv_phone",
    user_message: "21988887777"
  });

  const sessionAfterPhone = await repository.getSession("mrc_1", "chk_phone");
  assert.equal(sessionAfterPhone?.customer?.phone, "21988887777");
  assert.ok(sessionAfterPhone?.customer?.phone_otp_code, "Gerou phone_otp_code");
  assert.equal(sessionAfterPhone?.customer?.phone_verified ?? false, false);

  const otp = sessionAfterPhone?.customer?.phone_otp_code!;

  // 2. Validate with incorrect SMS OTP
  const res2 = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_phone",
    conversation_id: "conv_phone",
    user_message: "000000" // Wrong code
  });
  assert.equal(res2.message.includes("Código de verificação do celular inválido"), true, "Retornou erro para SMS OTP errado");
  
  // 3. Validate with correct SMS OTP
  await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_phone",
    conversation_id: "conv_phone",
    user_message: otp
  });
  const sessionVerified = await repository.getSession("mrc_1", "chk_phone");
  assert.equal(sessionVerified?.customer?.phone_verified, true, "Celular foi verificado com sucesso");
});

test("SendChatMessageUseCase handles address rejection 'Não', clearing fields and asking for CEP again", async () => {
  const repository = new InMemoryCheckoutRepository();
  const conversation = new RecordingConversationPort();
  const useCase = createTestUseCase(repository, conversation);

  await new StartCheckoutUseCase(repository, repository, repository).execute(startCheckoutRequest({ session_id: "chk_addr" }));
  const session = await repository.getSession("mrc_1", "chk_addr");
  if (session) {
    session.customer = {
      fullName: "Ana Cruz",
      email: "ana@aacp.io",
      email_verified: true,
      cpf: "22233344455",
      phone: "21977776666",
      phone_verified: true,
      address: {
        zip: "25958180",
        street: "Rua Paulo Lóssio",
        city: "Teresópolis",
        state: "RJ"
      }
    };
    await repository.saveSession(session);
  }

  // Address needs confirmation (address_verified is falsy)
  const res = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_addr",
    conversation_id: "conv_addr",
    user_message: "Não"
  });

  const sessionAfter = await repository.getSession("mrc_1", "chk_addr");
  assert.equal(sessionAfter?.customer?.address?.zip, undefined, "Limpou o CEP após rejeição");
  assert.equal(sessionAfter?.customer?.address?.street, undefined, "Limpou o logradouro");
  assert.equal(sessionAfter?.customer?.address_verified, false, "Setou address_verified para false");
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
