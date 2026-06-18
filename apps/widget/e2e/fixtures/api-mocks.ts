/**
 * E2E API Mock Helpers
 * Intercepts all widget→API calls via Playwright page.route()
 * and returns controlled responses for each checkout stage.
 */
import type { Page, Route } from "@playwright/test";

// ─── Types (mirrors @aacp/shared-types) ───────────────────────────────────────

export interface ShippingQuote {
  customerPrice: number;
  realCost?: number;
  carrier: string;
  method: string;
  deliveryDays: number;
  region: string;
}

export interface CheckoutExperienceSnapshot {
  brand: {
    merchant_id: string;
    name: string;
    subtitle: string;
    support_label: string;
    theme: Record<string, string>;
  };
  stage?: string;
  rules?: { couponBoxEnabled: boolean };
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    image_url: string;
    product_url: string;
    category: string;
    variant: string;
  }>;
  totals: {
    currency: string;
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
  };
  shipping?: ShippingQuote;
  shippingOptions?: ShippingQuote[];
  customer?: {
    email?: string;
    email_verified?: boolean;
    recognized_buyer?: boolean;
    isReturning?: boolean;
    fullName?: string;
    cpf?: string;
    phone?: string;
    phone_verified?: boolean;
    address_verified?: boolean;
    address?: {
      zip?: string;
      street?: string;
      number?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
    };
  };
  agent: { name: string; greeting: string; tone: string; language: string };
  copy: {
    headline: string;
    subheadline: string;
    trust_badges: string[];
    quick_replies: string[];
    focus_input?: boolean;
    expected_input_type?: string;
  };
}

// ─── Base data ────────────────────────────────────────────────────────────────

const BRAND = {
  merchant_id: "mrc_demo",
  name: "Northstar Atelier",
  subtitle: "Bolsa executiva premium",
  support_label: "Suporte",
  theme: {
    accentColor: "#a855f7",
    fontFamily: "IBM Plex Sans, sans-serif",
    textColor: "#1e293b",
    backgroundColor: "#ffffff",
  },
};

const AGENT = {
  name: "Clara Mendes",
  greeting: "Olá! Sou a Clara, vou te ajudar a finalizar sua compra.",
  tone: "consultative",
  language: "pt-BR",
};

const ITEMS = [
  {
    sku: "bag-001",
    name: "Bolsa Executiva Couro Safiano",
    quantity: 2,
    unit_price: 449.9,
    line_total: 899.8,
    image_url: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=640",
    product_url: "https://loja.example.com/bolsa-executiva-couro-safiano",
    category: "Bolsas",
    variant: "Preta",
  },
];

const BASE_TOTALS = {
  currency: "BRL",
  subtotal: 899.8,
  shipping: 0,
  discount: 0,
  total: 899.8,
};

const BASE_COPY = {
  headline: "Checkout assistido por IA",
  subheadline: "Finalize sua compra com ajuda da Clara.",
  trust_badges: ["Pagamento seguro", "Entrega garantida", "Suporte 24h"],
  quick_replies: ["Olá!", "Quero finalizar agora"],
  expected_input_type: "text" as const,
};

export const SHIPPING_OPTIONS: ShippingQuote[] = [
  { customerPrice: 19.9, realCost: 15.0, carrier: "Correios", method: "PAC", deliveryDays: 7, region: "SP" },
  { customerPrice: 29.9, realCost: 22.0, carrier: "Correios", method: "Sedex", deliveryDays: 3, region: "SP" },
];

// ─── Experience builders ──────────────────────────────────────────────────────

export function buildExperience(overrides: Partial<CheckoutExperienceSnapshot> = {}): CheckoutExperienceSnapshot {
  return {
    brand: BRAND,
    stage: "data_collection",
    rules: { couponBoxEnabled: true },
    items: ITEMS,
    totals: BASE_TOTALS,
    agent: AGENT,
    copy: BASE_COPY,
    ...overrides,
  };
}

export function dataCollectionExperience(quickReplies?: string[]): CheckoutExperienceSnapshot {
  return buildExperience({
    stage: "data_collection",
    copy: { ...BASE_COPY, quick_replies: quickReplies ?? ["Olá!", "Quero finalizar agora"] },
  });
}

export function shippingExperience(opts?: { withOptions?: boolean; selected?: ShippingQuote }): CheckoutExperienceSnapshot {
  const shipping = opts?.selected ?? undefined;
  const shippingCost = shipping?.customerPrice ?? 0;
  return buildExperience({
    stage: "shipping",
    shipping,
    shippingOptions: opts?.withOptions ? SHIPPING_OPTIONS : undefined,
    totals: { ...BASE_TOTALS, shipping: shippingCost, total: BASE_TOTALS.subtotal + shippingCost },
    copy: { ...BASE_COPY, quick_replies: [] },
  });
}

export function paymentExperience(discount = 0): CheckoutExperienceSnapshot {
  const shippingCost = 19.9;
  return buildExperience({
    stage: "payment",
    shipping: SHIPPING_OPTIONS[0],
    totals: {
      ...BASE_TOTALS,
      shipping: shippingCost,
      discount,
      total: BASE_TOTALS.subtotal + shippingCost - discount,
    },
    copy: { ...BASE_COPY, quick_replies: ["Cartão de crédito", "PIX", "Tenho um cupom"] },
  });
}

export function completedExperience(): CheckoutExperienceSnapshot {
  return buildExperience({
    stage: "completed",
    shipping: SHIPPING_OPTIONS[0],
    totals: { ...BASE_TOTALS, shipping: 19.9, total: BASE_TOTALS.subtotal + 19.9 },
    copy: { ...BASE_COPY, quick_replies: [] },
  });
}

export function recognizedBuyerShippingExperience(): CheckoutExperienceSnapshot {
  return buildExperience({
    stage: "shipping",
    shippingOptions: SHIPPING_OPTIONS,
    customer: {
      email: "costaadiego1989@gmail.com",
      email_verified: true,
      recognized_buyer: true,
      isReturning: true,
      fullName: "Diego Costa",
      cpf: "05178178700",
      phone: "21993001883",
      phone_verified: true,
      address_verified: true,
      address: {
        zip: "25958180",
        street: "Rua Paulo Lossio",
        number: "95",
        complement: "",
        neighborhood: "Araras",
        city: "Teresopolis",
        state: "RJ",
      },
    },
    copy: { ...BASE_COPY, quick_replies: ["Correios PAC (7 dias) - R$ 19,90", "Correios Sedex (3 dias) - R$ 29,90"] },
  });
}

// ─── Response builders ────────────────────────────────────────────────────────

export function startCheckoutResponse(experience?: CheckoutExperienceSnapshot) {
  return {
    conversation_id: "conv_test_001",
    session_id: "sess_test_001",
    global_user_id: "guser_test_001",
    agent_enabled: true,
    initial_mode: "open",
    tracking_token: "tk_test_001",
    experience: experience ?? dataCollectionExperience(),
    turns: [
      { role: "agent", text: AGENT.greeting, occurredAt: new Date().toISOString() },
      { role: "agent", text: "Para começar, qual é o seu nome completo?", occurredAt: new Date().toISOString() },
    ],
  };
}

export function chatResponse(opts: {
  message: string;
  experience: CheckoutExperienceSnapshot;
  stage: string;
  missingFields?: string[];
  actions?: Array<{ type: string; payload?: unknown }>;
  authorizedOffer?: { approved: boolean; discountCode?: string; discountPercent?: number };
}) {
  return {
    message: opts.message,
    objection: "unknown",
    authorized_offer: opts.authorizedOffer,
    actions: opts.actions ?? [],
    turns: [
      { role: "agent", text: opts.message, occurredAt: new Date().toISOString() },
    ],
    experience: opts.experience,
    stage: opts.stage,
    missing_fields: opts.missingFields ?? [],
    expected_input_type: "text",
  };
}

export function trackEventResponse() {
  return { received: true, abandonment_score: 0.2, trigger_agent: false };
}

export function pixPaymentResponse() {
  return {
    id: "pi_test_001",
    merchantId: "mrc_demo",
    sessionId: "sess_test_001",
    idempotencyKey: "idem_test_001",
    amountCents: 91970,
    currency: "BRL",
    method: "pix",
    status: "pending",
    buyerFacing: {
      qrCodeCopyPaste: "00020126580014br.gov.bcb.pix0136a1b2c3d4e5f67890abcdef123456789052040000530398",
      encodedQrImage: null,
    },
    statusHistory: [{ status: "pending", at: new Date().toISOString() }],
  };
}

export function cardPaymentResponse() {
  return {
    id: "pi_3RCardAacpTest",
    merchantId: "mrc_demo",
    sessionId: "sess_test_001",
    idempotencyKey: "idem_card_test_001",
    amountCents: 91970,
    currency: "BRL",
    method: "card",
    status: "requires_payment_method",
    buyerFacing: {
      clientSecret: "pi_3RCardAacpTest_secret_mockSecret123",
      stripePublishableKey: "pk_test_aacp_playwright",
    },
    statusHistory: [{ status: "requires_payment_method", at: new Date().toISOString() }],
  };
}

export function approvedPixPaymentResponse() {
  return {
    id: "pi_test_approved_001",
    merchantId: "mrc_demo",
    sessionId: "sess_test_001",
    idempotencyKey: "idem_pix_approved_001",
    amountCents: 91970,
    approvedAmountCents: 91970,
    currency: "BRL",
    method: "pix",
    status: "approved",
    buyerFacing: {
      qrCodeCopyPaste: "00020126580014br.gov.bcb.pix0136a1b2c3d4e5f67890abcdef123456789052040000530398",
      encodedQrImage: null,
    },
    statusHistory: [
      { status: "pending", at: new Date().toISOString() },
      { status: "approved", at: new Date().toISOString() },
    ],
    order_id: "ord_e2e_12345",
    receipt_url: "https://pay.example.com/receipt/e2e",
  };
}

export function approvedCardPaymentResponse() {
  return {
    id: "pi_test_card_approved_001",
    merchantId: "mrc_demo",
    sessionId: "sess_test_001",
    idempotencyKey: "idem_card_approved_001",
    amountCents: 91970,
    approvedAmountCents: 91970,
    currency: "BRL",
    method: "card",
    status: "approved",
    buyerFacing: {
      clientSecret: "pi_3RCardAacpTest_secret_mockSecret123",
      stripePublishableKey: "pk_test_aacp_playwright",
    },
    statusHistory: [
      { status: "requires_payment_method", at: new Date().toISOString() },
      { status: "approved", at: new Date().toISOString() },
    ],
    order_id: "ord_e2e_card_12345",
    receipt_url: "https://pay.example.com/receipt/card-e2e",
  };
}

export function paymentStatusApprovedResponse() {
  return {
    status: "approved",
    amount_cents: 91970,
    approved_amount_cents: 91970,
    currency: "BRL",
    order_id: "ord_e2e_12345",
    receipt_url: "https://pay.example.com/receipt/e2e",
  };
}

function paymentIntentResponseFor(
  route: Route,
  opts: { pixInstantApproval?: boolean; cardInstantApproval?: boolean } = {},
) {
  let method: string | undefined;
  try {
    method = (route.request().postDataJSON() as { method?: string } | null)?.method;
  } catch {
    method = undefined;
  }
  if (method === "card") {
    return opts.cardInstantApproval ? approvedCardPaymentResponse() : cardPaymentResponse();
  }
  if (opts.pixInstantApproval && method === "pix") return approvedPixPaymentResponse();
  return pixPaymentResponse();
}

export function couponApplyResponse() {
  return {
    redemption_id: "red_test_001",
    discount_applied: 89.98,
    coupon: { code: "DESCONTO10" },
    experience: paymentExperience(89.98),
  };
}

// ─── Conversation flow sequences ─────────────────────────────────────────────

export type FlowStep =
  | "greeting"
  | "ask_name"
  | "ask_email"
  | "ask_cpf"
  | "ask_phone"
  | "ask_cep"
  | "existing_buyer_otp_sent"
  | "existing_buyer_shipping_options"
  | "confirm_address"
  | "ask_number"
  | "show_shipping_options"
  | "shipping_selected"
  | "payment_options"
  | "card_form"
  | "pix"
  | "coupon_applied"
  | "completed";

const FLOW_RESPONSES: Record<FlowStep, () => ReturnType<typeof chatResponse>> = {
  greeting: () => chatResponse({
    message: AGENT.greeting,
    experience: dataCollectionExperience(),
    stage: "data_collection",
    missingFields: ["customer.fullName"],
  }),
  ask_name: () => chatResponse({
    message: "Para começar, qual é o seu nome completo?",
    experience: dataCollectionExperience(),
    stage: "data_collection",
    missingFields: ["customer.fullName"],
  }),
  ask_email: () => chatResponse({
    message: "Obrigada! Agora preciso do seu e-mail para enviar a confirmação.",
    experience: dataCollectionExperience(),
    stage: "data_collection",
    missingFields: ["customer.email"],
  }),
  ask_cpf: () => chatResponse({
    message: "Perfeito! Qual é o seu CPF? Precisamos para a nota fiscal.",
    experience: dataCollectionExperience(),
    stage: "data_collection",
    missingFields: ["customer.cpf"],
  }),
  ask_phone: () => chatResponse({
    message: "Agora preciso do seu telefone para contato sobre a entrega.",
    experience: dataCollectionExperience(),
    stage: "data_collection",
    missingFields: ["customer.phone"],
  }),
  ask_cep: () => chatResponse({
    message: "Ótimo! Agora vamos calcular o frete. Qual é o seu CEP?",
    experience: shippingExperience(),
    stage: "shipping",
    missingFields: ["shipping.address.zipCode"],
  }),
  existing_buyer_otp_sent: () => chatResponse({
    message: "Reconheci seu cadastro. Informe o codigo enviado para seu e-mail para continuar.",
    experience: dataCollectionExperience(),
    stage: "data_collection",
    missingFields: ["codigo de verificacao"],
  }),
  existing_buyer_shipping_options: () => chatResponse({
    message: "Bem-vindo de volta, Diego. Ja tenho seu endereco salvo. Escolha a opcao de frete:",
    experience: recognizedBuyerShippingExperience(),
    stage: "shipping",
    missingFields: ["frete"],
  }),
  confirm_address: () => chatResponse({
    message: "Encontrei o endereço: Rua das Flores, 123 - Jardim Primavera, São Paulo/SP. Está correto?",
    experience: shippingExperience(),
    stage: "shipping",
    missingFields: ["shipping.address.confirmation"],
  }),
  ask_number: () => chatResponse({
    message: "Qual o número e complemento do endereço?",
    experience: shippingExperience(),
    stage: "shipping",
    missingFields: ["shipping.address.number"],
  }),
  show_shipping_options: () => chatResponse({
    message: "Endereço confirmado! Escolha a opção de frete:",
    experience: shippingExperience({ withOptions: true }),
    stage: "shipping",
    missingFields: ["frete"],
  }),
  shipping_selected: () => chatResponse({
    message: "Frete selecionado! Agora vamos ao pagamento. Como deseja pagar?",
    experience: paymentExperience(),
    stage: "payment",
    missingFields: [],
  }),
  payment_options: () => chatResponse({
    message: "Como deseja pagar? Cartão de crédito, PIX ou tem um cupom de desconto?",
    experience: paymentExperience(),
    stage: "payment",
    missingFields: [],
  }),
  card_form: () => chatResponse({
    message: "Preencha os dados do seu cartão abaixo. Seus dados são criptografados e transmitidos com segurança.",
    experience: paymentExperience(),
    stage: "payment",
    missingFields: [],
  }),
  pix: () => chatResponse({
    message: "Gerando código PIX para pagamento...",
    experience: paymentExperience(),
    stage: "payment",
    missingFields: [],
  }),
  coupon_applied: () => chatResponse({
    message: "Cupom aplicado com sucesso! Você ganhou 10% de desconto.",
    experience: paymentExperience(89.98),
    stage: "payment",
    missingFields: [],
    authorizedOffer: { approved: true, discountCode: "DESCONTO10", discountPercent: 10 },
  }),
  completed: () => chatResponse({
    message: "Pedido confirmado! Seu pedido #12345 foi processado com sucesso. Você receberá um e-mail com os detalhes.",
    experience: completedExperience(),
    stage: "completed",
    missingFields: [],
  }),
};

export function getFlowResponse(step: FlowStep) {
  return FLOW_RESPONSES[step]();
}

// ─── Route interceptor ───────────────────────────────────────────────────────

export interface MockApiOptions {
  /** Sequence of chat responses to return in order. Each call to /chat/message pops the next. */
  chatSequence: FlowStep[];
  /** Override start-checkout response */
  startResponse?: ReturnType<typeof startCheckoutResponse>;
  /** Simulate network error on Nth chat call (1-indexed) */
  failOnChatCall?: number;
  /** PIX intent returns approved immediately (skips polling) */
  pixInstantApproval?: boolean;
  /** Card intent returns approved immediately (skips Stripe UI) */
  cardInstantApproval?: boolean;
  /** Payment intent POST returns HTTP error */
  failPaymentIntent?: boolean;
  /** Coupon apply returns invalid code error */
  rejectCoupon?: boolean;
  /** Buyer login-from-session returns 401 (invalid OTP) */
  rejectBuyerLogin?: boolean;
}

export async function setupApiMocks(page: Page, options: MockApiOptions): Promise<void> {
  let chatCallIndex = 0;
  const chatSequence = [...options.chatSequence];

  // Intercept all API calls to localhost:3009
  await page.route("**/start-checkout", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.startResponse ?? startCheckoutResponse()),
    });
  });

  await page.route("**/embed/start", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.startResponse ?? startCheckoutResponse()),
    });
  });

  await page.route("**/chat/message", async (route: Route) => {
    chatCallIndex++;
    if (options.failOnChatCall === chatCallIndex) {
      await route.abort("connectionrefused");
      return;
    }
    const step = chatSequence.shift() ?? "greeting";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getFlowResponse(step)),
    });
  });

  await page.route("**/embed/chat", async (route: Route) => {
    chatCallIndex++;
    if (options.failOnChatCall === chatCallIndex) {
      await route.abort("connectionrefused");
      return;
    }
    const step = chatSequence.shift() ?? "greeting";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getFlowResponse(step)),
    });
  });

  await page.route("**/track-event", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(trackEventResponse()),
    });
  });

  await page.route("**/embed/track", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(trackEventResponse()),
    });
  });

  await page.route("**/payment/intents", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    if (options.failPaymentIntent) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ message: "payment_gateway_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        paymentIntentResponseFor(route, {
          pixInstantApproval: options.pixInstantApproval,
          cardInstantApproval: options.cardInstantApproval,
        }),
      ),
    });
  });

  await page.route("**/embed/payment/intents", async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    if (options.failPaymentIntent) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ message: "payment_gateway_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        paymentIntentResponseFor(route, {
          pixInstantApproval: options.pixInstantApproval,
          cardInstantApproval: options.cardInstantApproval,
        }),
      ),
    });
  });

  await page.route("**/payment/intents/*/status**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(paymentStatusApprovedResponse()),
    });
  });

  await page.route("**/embed/payment/intents/*/status**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(paymentStatusApprovedResponse()),
    });
  });

  await page.route("**/buyer/login-from-session", async (route: Route) => {
    if (options.rejectBuyerLogin) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "invalid_otp" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        global_user_id: "buyer_existing_e2e",
        email: "costaadiego1989@gmail.com",
        access_token: "tok_existing_buyer_e2e",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    });
  });

  await page.route("**/support/faq**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ faqItems: [] }),
    });
  });

  await page.route("**/support/chat", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Para dúvidas sobre frete e prazo, consulte o rastreamento no e-mail de confirmação do pedido.",
        safe: true,
      }),
    });
  });

  await page.route("**/offers/apply", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getFlowResponse("coupon_applied")),
    });
  });

  await page.route("**/embed/offers/apply", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(getFlowResponse("coupon_applied")),
    });
  });

  await page.route("**/coupons/apply", async (route: Route) => {
    if (options.rejectCoupon) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Cupom inválido ou expirado." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(couponApplyResponse()),
    });
  });

  await page.route("**/embed/coupons/apply", async (route: Route) => {
    if (options.rejectCoupon) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Cupom inválido ou expirado." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(couponApplyResponse()),
    });
  });
}
