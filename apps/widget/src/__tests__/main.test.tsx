import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { CheckoutAgent, themeStyle, type WidgetConfig } from "../main.js";
import type {
  AgentContext,
  Cart,
  ChatAction,
  ChatMessageResponse,
  CheckoutSettingsContext,
  DashboardOverview,
  MerchantTheme,
  StartCheckoutResponse
} from "@aacp/shared-types";

// ── Stripe mocks (hoisted so they're available inside vi.mock factories) ──────
const { mockConfirmPaymentGlobal, mockLoadStripeGlobal } = vi.hoisted(() => ({
  mockConfirmPaymentGlobal: vi.fn(),
  mockLoadStripeGlobal: vi.fn()
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => ({ confirmPayment: mockConfirmPaymentGlobal }),
  useElements: () => ({})
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: mockLoadStripeGlobal
}));
// ─────────────────────────────────────────────────────────────────────────────

import { stripePromiseCache } from "../components/checkout/CreditCardForm.js";

const baseTheme: MerchantTheme = {
  accentColor: "#FF0066",
  textColor: "#0F172A",
  backgroundColor: "#F9FAFB",
  fontFamily: "Manrope, system-ui, sans-serif",
  logoUrl: "https://cdn.example.com/logo.png",
  surfaceColor: "#FFFFFF",
  surfaceElevatedColor: "#F8FAFC",
  borderColor: "#D9E2EC",
  mutedTextColor: "#64748B",
  fontDisplay: "Sora, Manrope, sans-serif",
  backgroundImageUrl: "https://cdn.example.com/bg.jpg",
  borderRadius: 10,
  density: "spacious",
  headerTitle: "Concierge Northstar",
  headerSubtitle: "Compra premium em andamento",
  agentName: "Aurora Concierge",
  trustBadges: ["Pagamento seguro", "Frete rastreavel"]
};

function buildConfig(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    mode: "embed",
    embedSessionToken: "tok.test",
    merchantId: "mrc_demo",
    apiBaseUrl: "http://localhost:3009",
    uiPresentation: "conversational",
    cart: {
      currency: "BRL",
      source: "storefront",
      total: 899.8,
      items: [
        {
          sku: "bag-001",
          name: "Bolsa Executiva",
          price: 449.9,
          cost: 210,
          quantity: 2
        }
      ]
    },
    ...overrides
  };
}

function buildStartResponse(theme: MerchantTheme): StartCheckoutResponse {
  return {
    conversation_id: "conv_1",
    session_id: "sess_1",
    global_user_id: "gu_abcdef123456",
    agent_enabled: true,
    initial_mode: "open",
    tracking_token: "trk_1",
    experience: {
      stage: "data_collection",
      brand: {
        merchant_id: "mrc_demo",
        name: "Northstar Atelier",
        subtitle: "Checkout premium",
        logo_url: theme.logoUrl,
        accent_color: theme.accentColor,
        support_label: "Sincronizado",
        theme
      },
      rules: { couponBoxEnabled: true },
      items: [
        {
          sku: "bag-001",
          name: "Bolsa Executiva",
          quantity: 2,
          unit_price: 449.9,
          line_total: 899.8
        }
      ],
      totals: {
        currency: "BRL",
        subtotal: 899.8,
        shipping: 29.9,
        discount: 0,
        total: 929.7
      },
      shipping: { customerPrice: 29.9, realCost: 22, carrier: "Correios", method: "PAC", deliveryDays: 7, region: "SP", destinationZip: "01310100" },
      agent: {
        name: "Aurora",
        greeting: "Olá! Sou a Aurora — posso te ajudar a fechar este pedido?",
        tone: "consultative",
        language: "pt-BR"
      },
      copy: {
        headline: "Resumo do seu pedido",
        subheadline: "Negocie frete ou cupom comigo.",
        trust_badges: ["Pagamento seguro"],
        quick_replies: [
          "Meu nome completo é…",
          "Como prefere me chamar?",
          "Posso usar nome social?"
        ]
      }
    }
  };
}

function buildChatResponse(
  message: string,
  stage: StartCheckoutResponse["experience"]["stage"] = "data_collection",
  overrides: {
    quickReplies?: string[];
    actions?: ChatAction[];
    authorizedOffer?: ChatMessageResponse["authorized_offer"] | null;
    experience?: Partial<StartCheckoutResponse["experience"]>;
    missingFields?: string[];
  } = {}
): ChatMessageResponse {
  const inferredMissingFields =
    stage === "shipping" && (overrides.experience?.shippingOptions?.length ?? 0) > 0
      ? ["frete"]
      : undefined;
  return {
    message,
    objection: "price",
    authorized_offer: overrides.authorizedOffer === null ? undefined : (overrides.authorizedOffer ?? {
      id: "off_1",
      merchantId: "mrc_demo",
      sessionId: "sess_1",
      type: "discount_percent",
      value: 5,
      approved: true,
      reason: "ok",
      marginAfterOffer: 0.42,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      discountCode: "AURORA5"
    }),
    actions: overrides.actions ?? [{ label: "Aplicar cupom AURORA5", type: "apply_offer", offer_id: "off_1" }],
    turns: [
      {
        role: "agent",
        text: "Olá! Sou a Aurora — posso te ajudar a fechar este pedido?",
        occurredAt: "2026-05-04T16:00:00Z"
      },
      { role: "buyer", text: "esta caro", occurredAt: "2026-05-04T16:00:30Z" },
      {
        role: "agent",
        text: message,
        occurredAt: new Date().toISOString(),
        authorizedOfferId: "off_1"
      }
    ],
    stage,
    missing_fields: overrides.missingFields ?? inferredMissingFields,
    experience: {
      stage,
      brand: {
        merchant_id: "mrc_demo",
        name: "Northstar Atelier",
        subtitle: "Checkout premium",
        logo_url: baseTheme.logoUrl,
        accent_color: baseTheme.accentColor,
        support_label: "Sincronizado",
        theme: baseTheme
      },
      rules: { couponBoxEnabled: true },
      items: [
        {
          sku: "bag-001",
          name: "Bolsa Executiva",
          quantity: 2,
          unit_price: 449.9,
          line_total: 899.8
        }
      ],
      totals: {
        currency: "BRL",
        subtotal: 899.8,
        shipping: 29.9,
        discount: 0,
        total: 929.7
      },
      shipping: { customerPrice: 29.9, realCost: 22, carrier: "Correios", method: "PAC", deliveryDays: 7, region: "SP", destinationZip: "01310100" },
      agent: {
        name: "Aurora",
        greeting: "Olá! Sou a Aurora — posso te ajudar a fechar este pedido?",
        tone: "consultative",
        language: "pt-BR"
      },
      copy: {
        headline: "Resumo do seu pedido",
        subheadline: "Negocie frete ou cupom comigo.",
        trust_badges: ["Pagamento seguro"],
        quick_replies:
          overrides.quickReplies ??
          [
            "Meu nome completo é…",
            "Como prefere me chamar?",
            "Posso usar nome social?"
          ]
      },
      ...overrides.experience
    }
  };
}

async function skipCouponGate(container: HTMLElement) {
  await waitFor(() => {
    expect(
      Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button")).some(
        (button) => button.textContent === "Não"
      )
    ).toBe(true);
  });

  const skipCoupon = Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button")).find(
    (button) => button.textContent === "Não"
  );
  expect(skipCoupon).not.toBeUndefined();
  await act(async () => {
    fireEvent.click(skipCoupon!);
  });
}

function mockOfferApplyOnCouponSkip(
  fetchMock: ReturnType<typeof vi.fn>,
  appliedDiscount = 79.9,
  appliedTotal = 850
): void {
  fetchMock.mockImplementationOnce(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    expect(url.endsWith("/embed/offers/apply")).toBe(true);
    const appliedExperience = buildChatResponse(
      "Oferta aplicada. Vamos seguir para o pagamento.",
      "payment",
      { quickReplies: ["Prefiro PIX", "Prefiro cartão"] }
    ).experience!;
    appliedExperience.totals.discount = appliedDiscount;
    appliedExperience.totals.total = appliedTotal;
    return new Response(
      JSON.stringify({
        success: true,
        discount_code: "AURORA5",
        new_total: appliedTotal,
        expires_at: new Date().toISOString(),
        experience: appliedExperience,
        agent_turn: {
          role: "agent",
          text: "Pronto! Apliquei 5% de desconto. Vamos para o pagamento — prefere PIX ou cartão de crédito?",
          occurredAt: new Date().toISOString(),
          authorizedOfferId: "off_1"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
}

function buildDashboardOverview(): DashboardOverview {
  return {
    merchant_id: "mrc_demo",
    conversations_started: 42,
    offers_viewed: 12,
    offers_accepted: 7,
    orders_completed: 9,
    conversion_rate_with_agent: 0.214,
    average_discount: 18.5,
    average_shipping_subsidy: 9.9,
    incremental_revenue: 3720.4,
    recent_sessions: [
      {
        merchantId: "mrc_demo",
        sessionId: "sess_recent_1",
        globalUserId: "gu_recent_1",
        conversationId: "conv_recent_1",
        cart: {
          currency: "BRL",
          total: 929.7,
          source: "storefront",
          items: [
            {
              sku: "bag-001",
              name: "Bolsa Executiva",
              price: 449.9,
              quantity: 2
            }
          ]
        },
        customer: { email: "buyer@example.com" },
        abandonmentScore: 0.22,
        triggerAgent: true,
        chatHistory: [],
        paymentMethod: "pix",
        createdAt: "2026-05-07T12:00:00Z",
        updatedAt: "2026-05-07T12:10:00Z"
      }
    ],
    recent_offers: []
  };
}

function buildCheckoutSettingsContext(): CheckoutSettingsContext {
  return {
    merchant_id: "mrc_demo",
    checkout_settings: {
      mode: "proactive",
      open_widget_on_trigger: true,
      minimum_abandonment_score: 0.55,
      cooldown_seconds: 90,
      max_interventions_per_session: 3,
      enabled_triggers: ["coupon_field_clicked", "shipping_objection_detected"],
      handoff_enabled: true
    },
    operational_constraints: ["API como fonte de verdade", "Sem desconto fora da politica"]
  };
}

function buildAgentContext(): AgentContext {
  return {
    merchant_id: "mrc_demo",
    agent_id: "agent_aurora",
    agent: {
      agentName: "Aurora",
      persona: "consultora premium de checkout",
      tone: "premium",
      language: "pt-BR",
      greeting: "Vamos fechar seu pedido com seguranca."
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
      requiredDisclaimers: [],
      escalationTriggers: ["chargeback", "pagamento recusado"]
    },
    checkout_settings: {
      agentMode: "proactive",
      openWidgetOnTrigger: true,
      cooldownSeconds: 90,
      maxInterventionsPerSession: 3,
      triggerPreferences: ["coupon_field_clicked"],
      handoffEnabled: true
    },
    copy_constraints: ["Nao expor metricas internas no checkout publico"]
  };
}

function buildHubResponse(url: string): Response | null {
  if (url.endsWith("/checkout/dashboard/overview/mrc_demo")) {
    return new Response(JSON.stringify(buildDashboardOverview()), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (url.endsWith("/merchants/me")) {
    return new Response(
      JSON.stringify({
        id: "mrc_demo",
        name: "Northstar Atelier",
        theme: baseTheme
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (url.endsWith("/merchants/me/theme")) {
    return new Response(JSON.stringify(baseTheme), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (url.endsWith("/checkout-settings/context")) {
    return new Response(JSON.stringify(buildCheckoutSettingsContext()), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (url.endsWith("/agent-rules/context")) {
    return new Response(JSON.stringify(buildAgentContext()), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return null;
}

describe("themeStyle", () => {
  it("maps merchant theme into CSS custom properties", () => {
    const style = themeStyle(baseTheme) as Record<string, string>;
    expect(style["--aacp-accent"]).toBe("#FF0066");
    expect(style["--aacp-fg"]).toBe("#0F172A");
    expect(style["--aacp-bg"]).toBe("#F9FAFB");
    expect(style["--aacp-font"]).toBe("Manrope, system-ui, sans-serif");
    expect(style["--aacp-surface"]).toBe("#FFFFFF");
    expect(style["--aacp-font-display"]).toBe("Sora, Manrope, sans-serif");
    expect(style["--aacp-radius"]).toBe("10px");
    expect(style["--aacp-density-scale"]).toBe("1.08");
    expect(style["--aacp-bg-image"]).toContain("bg.jpg");
  });

  it("applies dark palette when colorMode is dark", () => {
    const style = themeStyle(baseTheme, false, "dark") as Record<string, string>;
    expect(style["--aacp-surface"]).toBe("#111827");
    expect(style["--aacp-fg"]).toBe("#F1F5F9");
    expect(style["--aacp-bg"]).toBe("#0B1220");
  });
});

describe("CheckoutAgent (conversational)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubEnv("AACP_DISABLE_STREAMING", "1");
    stripePromiseCache.clear();
    mockConfirmPaymentGlobal.mockReset();
    mockLoadStripeGlobal.mockReset();
    mockLoadStripeGlobal.mockResolvedValue({ confirmPayment: mockConfirmPaymentGlobal });

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        return new Response(
          JSON.stringify(
            buildChatResponse("Posso aplicar 5% agora com o cupom AURORA5?", "payment", {
              quickReplies: ["Prefiro PIX", "Prefiro cartão", "Finalizar pedido"]
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("applies merchant theme variables and renders greeting + cart total", async () => {
    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-brand strong")?.textContent).toBe(
        "Northstar Atelier"
      );
    });

    expect(container.querySelector(".aacp-cart-title")?.textContent).toContain("Em andamento");
    expect(container.querySelector(".aacp-flow-rail")?.textContent).toContain("Cadastro");
    expect(container.querySelector(".aacp-hero")).toBeNull();
    expect(container.querySelector(".aacp-cart-intel")).toBeNull();
    expect(container.textContent).not.toContain("Receita IA");
    expect(container.textContent).not.toContain("Conversão");
    expect(container.textContent).not.toContain("Telemetria");
    expect(container.querySelector(".aacp-chat-intro")).toBeNull();

    const widget = container.querySelector(".aacp-widget--conversational") as HTMLElement;
    expect(widget.style.getPropertyValue("--aacp-accent")).toBe("#FF0066");
    expect(widget.style.getPropertyValue("--aacp-font")).toBe(
      "Manrope, system-ui, sans-serif"
    );
    expect(container.querySelector("img.aacp-cart-logo")?.getAttribute("src")).toBe(
      "https://cdn.example.com/logo.png"
    );

    await waitFor(() => {
      const bubble = container.querySelector(".aacp-chat-bubble--agent .aacp-chat-text");
      expect(bubble?.textContent ?? "").toContain("Aurora");
    });

    expect(
      container.querySelector(".aacp-cart-total dd")?.textContent
    ).toMatch(/929/);

    fireEvent.click(getByLabelText("Remover Bolsa Executiva"));

    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-empty")).not.toBeNull();
    });
    expect(container.querySelector(".aacp-cart-total")).toBeNull();
  });

  it("loads the cart from the configured product API before starting checkout", async () => {
    const productCart: Cart = {
      currency: "BRL",
      source: "platform_api",
      total: 259.8,
      items: [
        {
          sku: "wallet-001",
          name: "Carteira Minimalista RFID",
          price: 129.9,
          quantity: 2
        }
      ]
    };
    const calls: string[] = [];
    const startBodies: Array<{ cart?: Cart }> = [];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url.endsWith("/checkout-cart")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          items: [{ sku: "wallet-001", quantity: 2 }]
        });
        return new Response(JSON.stringify({ cart: productCart }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/start")) {
        startBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container } = render(
      <CheckoutAgent
        config={buildConfig({
          cart: { currency: "BRL", source: "storefront", total: 0, items: [] },
          productApiBaseUrl: "http://localhost:3010",
          productSelection: [{ sku: "wallet-001", quantity: 2 }]
        })}
      />
    );

    await waitFor(() => {
      expect(startBodies[0]?.cart?.items[0]?.sku).toBe("wallet-001");
    });

    expect(calls.findIndex((url) => url.endsWith("/checkout-cart"))).toBeLessThan(
      calls.findIndex((url) => url.endsWith("/embed/start"))
    );
    expect(container.textContent).toContain("Northstar Atelier");
  });

  it("renders the welcome message with configured discount without exposing coupon before payment", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        const response = buildStartResponse(baseTheme);
        response.experience.agent.greeting =
          "Ola! A loja autorizou ate 12% de desconto conforme a configuracao da empresa.";
        response.experience.copy.quick_replies = ["Tenho um cupom de desconto", "Quero finalizar agora"];
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")?.textContent).toContain(
        "12% de desconto"
      );
    });
    expect(container.textContent).not.toContain("Tenho um cupom de desconto");
  });

  it("sends message, shows typing, then renders agent reply from server turns", async () => {
    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    let resolveChat!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveChat = resolve;
        })
    );

    await waitFor(() => {
      expect(
        container.querySelector('input[aria-label="Mensagem para o assistente"]')
      ).not.toBeNull();
    });

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "esta caro" } });

    const submitBtn = getByLabelText("Enviar mensagem") as HTMLButtonElement;
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(container.querySelector(".aacp-typing")).not.toBeNull();
    });
    expect(
      container.querySelector(".aacp-chat-bubble--buyer .aacp-chat-text")?.textContent
    ).toBe("esta caro");

    await act(async () => {
      resolveChat(
        new Response(
          JSON.stringify(
            buildChatResponse("Posso aplicar 5% agora com o cupom AURORA5?", "payment", {
              quickReplies: ["Prefiro PIX", "Prefiro cartão", "Finalizar pedido"]
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    });

    await waitFor(() => {
      expect(container.querySelector(".aacp-typing")).toBeNull();
    });

    const texts = Array.from(container.querySelectorAll(".aacp-chat-text")).map((b) =>
      (b.textContent ?? "").trim()
    );
    expect(texts).toContain("esta caro");
    expect(texts.some((t) => t.includes("AURORA5"))).toBe(true);

    const quickReplyLabels = Array.from(
      container.querySelectorAll(".aacp-quick-replies--in-thread button")
    ).map((b) => b.textContent ?? "");
    expect(quickReplyLabels).toEqual(
      expect.arrayContaining(["Sim", "Não"])
    );
    expect(quickReplyLabels).not.toContain("Prefiro PIX");
    expect(container.querySelector(".aacp-flow-rail")?.textContent).toContain("Pagamento");

    expect(() => getByLabelText("Cupom de desconto")).toThrow();
  });

  it("renders payment confirmation and failure messages returned by the API", async () => {
    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    fetchMock.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify(
          buildChatResponse("Pagamento confirmado! Seu pedido foi registrado.", "completed", {
            actions: [],
            quickReplies: [],
            experience: { stage: "completed" }
          })
        ),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    fireEvent.change(getByLabelText("Mensagem para o assistente"), {
      target: { value: "Prefiro PIX" }
    });
    fireEvent.click(getByLabelText("Enviar mensagem"));

    await waitFor(() => {
      expect(container.textContent).toContain("Pagamento confirmado");
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        return new Response(
          JSON.stringify(buildChatResponse("Pagamento falhou. Voce pode tentar novamente.", "payment")),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const second = render(<CheckoutAgent config={buildConfig({ merchantId: "mrc_demo_2" })} />);
    await waitFor(() => {
      expect(second.container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });
    fireEvent.change(second.getByLabelText("Mensagem para o assistente"), {
      target: { value: "pagamento recusado" }
    });
    fireEvent.click(second.getByLabelText("Enviar mensagem"));

    await waitFor(() => {
      expect(second.container.textContent).toContain("Pagamento falhou");
    });
  });

  it("falls back to default quick replies before any chat round", async () => {
    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelectorAll(".aacp-quick-replies button").length).toBeGreaterThan(0);
    });

    const chips = Array.from(
      container.querySelectorAll(".aacp-quick-replies button")
    ).map((b) => b.textContent);
    expect(chips).toEqual([
      "Olá!",
      "Quero começar",
      "Meu nome completo é…",
      "Como prefere me chamar?",
      "Posso usar nome social?"
    ]);
  });

  it("executes apply_offer quick replies as backend offer applications", async () => {
    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    let resolveChat!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveChat = resolve;
        })
    );

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "esta caro" } });
    fireEvent.click(getByLabelText("Enviar mensagem"));

    await act(async () => {
      resolveChat(
        new Response(
          JSON.stringify(
            buildChatResponse("Posso aplicar a oferta autorizada agora?", "payment", {
              actions: [
                { label: "Aplicar oferta autorizada", type: "apply_offer", offer_id: "off_1" }
              ],
              quickReplies: ["Prefiro PIX", "Prefiro cartão"]
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    });

    mockOfferApplyOnCouponSkip(fetchMock);

    await skipCouponGate(container);

    await waitFor(() => {
      expect(container.querySelector(".aacp-offer-banner")).not.toBeNull();
    });
    expect(container.querySelector(".aacp-offer-banner")?.textContent).toContain("Oferta aplicada");
  });

  it("opens the phone login modal and keeps Google disabled until OAuth is enabled", async () => {
    const { container, getByText, getByPlaceholderText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-shell-header")).not.toBeNull();
    });

    const loginButton = container.querySelector(".aacp-google-login") as HTMLButtonElement;
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(getByText("Entrar com celular")).not.toBeNull();
    });

    const googleButton = getByText("Entrar com Google em breve").closest("button") as HTMLButtonElement;
    expect(googleButton.disabled).toBe(true);

    const sendCodeButton = getByText("Enviar codigo por SMS").closest("button") as HTMLButtonElement;
    expect(sendCodeButton.disabled).toBe(true);

    fireEvent.change(getByPlaceholderText("(11) 99999-9999"), {
      target: { value: "11999998888" }
    });

    expect(sendCodeButton.disabled).toBe(false);
    fireEvent.click(sendCodeButton);

    await waitFor(() => {
      expect(container.textContent).toContain("Codigo enviado para 11999998888");
    });

    const confirmButton = getByText("Confirmar codigo").closest("button") as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(getByPlaceholderText("000000"), {
      target: { value: "123456" }
    });

    expect(confirmButton.disabled).toBe(false);
  });

  it("opens the authenticated hub with history, account metrics and agent settings", async () => {
    window.localStorage.setItem(
      "aacp_global_auth_session",
      JSON.stringify({
        merchant_id: "mrc_demo",
        user_id: "usr_1",
        email: "global@example.com",
        access_token: "token_123",
        token_type: "Bearer",
        expires_in: 3600,
        // expires_at required by safeReadSession since ADR 0003 P2 fix.
        expires_at: Date.now() + 3600 * 1000
      })
    );

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      const hubResponse = buildHubResponse(url);
      if (hubResponse) return hubResponse;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container, getByText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(getByText("Minha conta")).not.toBeNull();
    });

    fireEvent.click(getByText("Minha conta"));

    await waitFor(() => {
      expect(container.querySelector(".aacp-hub-sheet")).not.toBeNull();
    });
    await waitFor(() => {
      expect(container.textContent).toContain("Northstar Atelier");
      expect(container.textContent).toContain("42 sessões");
    });

    fireEvent.click(getByText("Pedidos"));
    expect(container.textContent).toContain("sess_recent_1");
    expect(container.textContent).toContain("buyer@example.com");

    fireEvent.click(getByText("Métricas"));
    expect(container.textContent).toContain("Receita IA");

    fireEvent.click(getByText("Agente"));
    expect(container.textContent).toContain("consultora premium de checkout");
    expect(container.textContent).toContain("proactive");
  });

  it("covers full purchase journey, empty cart fallback, and login reflection", async () => {
    // 1. Initial configuration with custom fallback redirect url
    const config = buildConfig({
      emptyCartRedirectUrl: "https://minhaloja.com.br/fallback"
    });

    let lastSentMessage = "";
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        const response = buildStartResponse(baseTheme);
        response.experience.customer = {
          fullName: "Diego Costa",
          email_verified: false
        };
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        const body = JSON.parse(String(init?.body || "{}"));
        lastSentMessage = body.user_message || "";
        
        // Simulating the stages of checkout
        let nextStage: "data_collection" | "shipping" | "payment" | "completed" = "data_collection";
        let messageText = "Como posso ajudar?";
        let qrs: string[] = [];
        let expOver: any = {};
        let missingFields: string[] | undefined;

        if (lastSentMessage.includes("Diego")) {
          messageText = "Obrigado, Diego! Agora informe seu email.";
          qrs = ["costaadiego1989@gmail.com"];
        } else if (lastSentMessage.includes("@")) {
          messageText = "Obrigado, Diego! Informe o código de verificação enviado para o seu email.";
          qrs = ["898531"];
        } else if (lastSentMessage.includes("898531")) {
          messageText = "Perfeito, cadastro confirmado com sucesso! Qual o seu CPF?";
          qrs = ["051.781.787-00"];
          expOver = {
            customer: {
              fullName: "Diego Costa",
              email: "costaadiego1989@gmail.com",
              email_verified: true,
              cpf: "05178178700"
            }
          };
        } else if (lastSentMessage.includes("051.781.787-00") || lastSentMessage.includes("051781")) {
          messageText = "Obrigado! Qual seu telefone?";
          qrs = ["(21) 99300-1883"];
          nextStage = "shipping";
          expOver = {
            customer: {
              fullName: "Diego Costa",
              email: "costaadiego1989@gmail.com",
              email_verified: true,
              cpf: "05178178700",
              phone: "21993001883"
            }
          };
        } else if (lastSentMessage.includes("21993001883") || lastSentMessage.includes("2199300")) {
          messageText = "Qual o seu CEP?";
          qrs = ["25958180"];
          nextStage = "shipping";
        } else if (lastSentMessage.includes("25958180")) {
          messageText = "Qual o número e complemento?";
          qrs = ["95"];
          nextStage = "shipping";
        } else if (lastSentMessage.includes("95")) {
          messageText = "Tem complemento? Se nao tiver, responda Nao tem.";
          qrs = ["Nao tem", "Como informo o bloco?", "Moro em zona rural"];
          nextStage = "shipping";
          missingFields = ["complemento (ou responda que nao tem)"];
        } else if (/n[aã]o tem/i.test(lastSentMessage)) {
          messageText = "Escolha a entrega. Frete Grátis acima de R$500!";
          qrs = ["PAC (Grátis)", "Sedex (R$ 15,00)"];
          nextStage = "shipping";
          missingFields = ["frete"];
          expOver = {
            shippingOptions: [
              { customerPrice: 0, carrier: "Correios", method: "PAC", deliveryDays: 5 },
              { customerPrice: 15, carrier: "Correios", method: "Sedex", deliveryDays: 2 }
            ],
            totals: {
              currency: "BRL",
              subtotal: 899.8,
              shipping: 0,
              discount: 89.98,
              total: 809.82
            }
          };
        } else if (lastSentMessage.toLowerCase().includes("pac") || lastSentMessage.toLowerCase().includes("gratis")) {
          messageText = "Ótimo! Escolha um método de pagamento no quick reply.";
          qrs = ["Pagar com PIX", "Pagar com Cartão de Crédito"];
          nextStage = "payment";
          expOver = {
            totals: {
              currency: "BRL",
              subtotal: 899.8,
              shipping: 0,
              discount: 89.98,
              total: 809.82
            }
          };
        } else if (lastSentMessage.toLowerCase().includes("pix")) {
          messageText = "Perfeito. O código PIX está disponível. Deseja confirmar?";
          qrs = ["Confirmar Pagamento", "Simular Erro de Pagamento"];
          nextStage = "payment";
        } else if (lastSentMessage.includes("Confirmar Pagamento")) {
          messageText = "Pagamento confirmado com sucesso! Seu pedido foi concluído e enviamos um comprovante por WhatsApp.";
          nextStage = "completed";
          qrs = [];
        }

        return new Response(
          JSON.stringify(
            buildChatResponse(messageText, nextStage, {
              quickReplies: qrs,
              experience: expOver,
              actions: [],
              missingFields,
              authorizedOffer: nextStage === "payment" ? null : undefined
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/embed/payment/intents")) {
        return new Response(
          JSON.stringify({
            id: "pi_pix_1",
            status: "approved",
            amountCents: 80982,
            approvedAmountCents: 80982,
            currency: "BRL",
            buyerFacing: { qrCodeCopyPaste: "00020126pixcode" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    // Render Widget
    const { container, getByLabelText } = render(<CheckoutAgent config={config} />);

    // Wait for greeting
    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    // 2. Simulate Registration Flow (Diego -> Email -> OTP -> CPF -> Phone)
    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;

    // Send Name
    fireEvent.change(input, { target: { value: "Meu nome é Diego" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Diego");
    });

    // Send Email
    fireEvent.change(input, { target: { value: "costaadiego1989@gmail.com" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("código de verificação");
    });

    // Send OTP
    fireEvent.change(input, { target: { value: "O código é 898531" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("CPF");
    });

    // At this point, customer is verified! Check that the login button in header reflects verified client state
    await waitFor(() => {
      const loginBtn = container.querySelector("#aacp-login-btn");
      expect(loginBtn?.textContent).toContain("Olá, Diego");
      expect(loginBtn?.textContent).toContain("Cliente");
    });

    // Send CPF
    fireEvent.change(input, { target: { value: "Meu CPF é 051.781.787-00" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("telefone");
    });

    // Send Phone
    fireEvent.change(input, { target: { value: "21993001883" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("CEP");
    });

    // 3. Simulate Delivery Flow (CEP -> Number -> Complement -> Shipping option)
    fireEvent.change(input, { target: { value: "CEP é 25958180" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("número");
    });

    // Send Number
    fireEvent.change(input, { target: { value: "Número é 95" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Tem complemento");
      expect(container.textContent).not.toContain("PAC (Grátis)");
    });

    // Confirm no complement before showing shipping options
    fireEvent.change(input, { target: { value: "Nao tem" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Escolha a entrega");
    });

    // Choose PAC shipping option from quick reply
    await waitFor(() => {
      expect(container.textContent).toContain("PAC (Grátis)");
    });
    const pacQr = Array.from(container.querySelectorAll(".aacp-quick-replies button"))
      .find((b) => (b.textContent ?? "").includes("PAC (Grátis)"));
    expect(pacQr).not.toBeUndefined();
    fireEvent.click(pacQr!);

    // Check shipping policies and discounts in the UI
    await waitFor(() => {
      // Check totals are updated
      expect(container.querySelector(".aacp-cart-total dd")?.textContent).toContain("809,82");
    });

    // 4. Payment method selection in quick replies (discount already applied → skip coupon gate)
    await waitFor(() => {
      expect(container.textContent).toContain("PIX");
    });
    const pixQr = Array.from(container.querySelectorAll(".aacp-quick-replies button"))
      .find((b) => (b.textContent ?? "").includes("PIX"));
    expect(pixQr).not.toBeUndefined();
    fireEvent.click(pixQr!);

    // PIX intent approved by backend → order completed (no optimistic client confirm).
    await waitFor(() => {
      expect(container.textContent).toContain("Pagamento confirmado");
    });

    // 5. Completion clears the transactional cart and preserves the store fallback.
    await waitFor(() => {
      expect(container.querySelector("#aacp-empty-cart-redirect-btn")).not.toBeNull();
      expect(container.querySelector("#aacp-empty-cart-redirect-btn")?.getAttribute("href")).toBe(
        "https://minhaloja.com.br/fallback"
      );
    });
  });

  it("Card flow: quick reply 'Cartão' abre Stripe Elements; submit deixa pagamento pendente aguardando webhook (sem confirmação otimista, sem PAN/CVV)", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        return new Response(
          JSON.stringify(
            buildChatResponse("Escolha o método de pagamento", "payment", {
              authorizedOffer: null,
              quickReplies: ["Pagar com Cartão de Crédito", "Pagar com PIX"],
              actions: []
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/embed/payment/intents")) {
        return new Response(
          JSON.stringify({
            id: "pi_test_1",
            amountCents: 92970,
            currency: "BRL",
            status: "pending",
            buyerFacing: {
              clientSecret: "pi_test_secret_abc",
              stripePublishableKey: "pk_test_xyz"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    // Stripe client-side confirm succeeds, but that is NOT authoritative.
    mockConfirmPaymentGlobal.mockResolvedValue({ error: undefined });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Quero pagar" } });
    fireEvent.submit(container.querySelector("form.aacp-composer-form")!);

    await skipCouponGate(container);

    await waitFor(() => {
      expect(container.textContent).toContain("Cartão de crédito");
    });

    // Click card quick reply → showCardForm = true → CreditCardForm (Stripe) renders
    const cardQr = Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button"))
      .find((b) => (b.textContent ?? "").includes("Cartão"));
    expect(cardQr).not.toBeUndefined();

    await act(async () => { fireEvent.click(cardQr!); });

    // No raw PAN/CVV inputs are ever rendered — provider-side tokenization only.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="stripe-payment-element"]')).not.toBeNull();
    });
    expect(container.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-csc"]')).toBeNull();

    // Submit the Stripe form → client-side confirm succeeds.
    const stripeForm = container.querySelector("form");
    expect(stripeForm).not.toBeNull();
    await act(async () => { fireEvent.submit(stripeForm!); });

    expect(mockConfirmPaymentGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ redirect: "if_required" })
    );

    // Authoritative confirmation comes only via webhook → status. Until then the
    // widget stays pending and must NOT optimistically declare the order complete.
    await waitFor(() => {
      expect(container.textContent).toContain("aguardando a confirmacao");
    });
    expect(container.textContent).not.toContain("Pagamento confirmado");
    expect(container.textContent).not.toContain("Pedido confirmado");

    // No PAN/CVV ever sent to backend: no card body posted to the intents endpoint.
    const intentCall = fetchMock.mock.calls.find(([reqUrl]) =>
      (typeof reqUrl === "string" ? reqUrl : String(reqUrl)).endsWith("/embed/payment/intents")
    );
    expect(intentCall).not.toBeUndefined();
    const sentBody = intentCall?.[1]?.body ? String(intentCall[1].body) : "";
    expect(sentBody).not.toContain("credit_card");
    expect(sentBody.toLowerCase()).not.toContain("ccv");
    expect(sentBody.toLowerCase()).not.toContain("cvv");
  });

  it("supports dynamic client configuration for agent and copy from attributes and renders relocated Reset button", async () => {
    // Stub fetch to return the custom dynamic configurations
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        const payload = buildStartResponse(baseTheme);
        payload.experience.agent = {
          name: "Zion Assistente Inteligente",
          greeting: "Olá! Conectando com a loja para buscar seu pedido.",
          tone: "consultative",
          language: "pt-BR"
        };
        payload.experience.copy = {
          headline: "Checkout Exclusivo IA",
          subheadline: "Carregando o seu carrinho com segurança.",
          trust_badges: ["Conexão 100% Criptografada"],
          quick_replies: ["Iniciar Checkout", "Ver Promoções"]
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const customAgent = {
      name: "Zion Assistente Inteligente",
      greeting: "Olá! Conectando com a loja para buscar seu pedido.",
      tone: "consultative" as const,
      language: "pt-BR"
    };

    const customCopy = {
      headline: "Checkout Exclusivo IA",
      subheadline: "Carregando o seu carrinho com segurança.",
      trust_badges: ["Conexão 100% Criptografada"],
      quick_replies: ["Iniciar Checkout", "Ver Promoções"]
    };

    const config = buildConfig({
      agent: customAgent,
      copy: customCopy
    });

    const { container } = render(<CheckoutAgent config={config} />);

    // Verify initial copy configuration headline (rendered as brand subtitle or document metadata)
    await waitFor(() => {
      expect(container.textContent).toContain("Olá! Conectando com a loja para buscar seu pedido.");
    });

    // Check that custom quick replies are shown
    expect(container.textContent).toContain("Iniciar Checkout");
    expect(container.textContent).toContain("Ver Promoções");

    // Verify the DEV Reset button is rendered in the CartPanel header instead of CheckoutHeader
    const cartHeader = container.querySelector(".aacp-cart-brand");
    expect(cartHeader).not.toBeNull();
    
    // The Reset button should be located in the CartPanel near the brand header
    const resetButton = Array.from(container.querySelectorAll("button"))
      .find(btn => btn.textContent === "Reset");
    expect(resetButton).not.toBeNull();
  });

  it("Sedex shipping selection updates totals with shipping cost", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        const body = JSON.parse(String(init?.body || "{}"));
        const msg: string = body.user_message || "";
        if (msg.toLowerCase().includes("sedex")) {
          return new Response(
            JSON.stringify(
              buildChatResponse("Sedex selecionado! Escolha o pagamento.", "payment", {
                quickReplies: ["Pagar com PIX"],
                actions: [],
                experience: {
                  stage: "payment",
                  totals: {
                    currency: "BRL",
                    subtotal: 899.8,
                    shipping: 15,
                    discount: 0,
                    total: 914.8
                  }
                }
              })
            ),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify(
            buildChatResponse("Escolha a entrega.", "shipping", {
              quickReplies: ["PAC (Grátis)", "Sedex (R$ 15,00)"],
              actions: [],
              experience: {
                stage: "shipping",
                shippingOptions: [
                  { customerPrice: 0, carrier: "Correios", method: "PAC", deliveryDays: 5 },
                  { customerPrice: 15, carrier: "Correios", method: "Sedex", deliveryDays: 2 }
                ]
              }
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);
    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "calcular frete" } });
    fireEvent.submit(container.querySelector("form.aacp-composer-form")!);

    await waitFor(() => {
      expect(container.textContent).toContain("Sedex (R$ 15,00)");
    });

    const sedexQr = Array.from(container.querySelectorAll(".aacp-quick-replies button"))
      .find((b) => (b.textContent ?? "").includes("Sedex"));
    expect(sedexQr).not.toBeUndefined();
    fireEvent.click(sedexQr!);

    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-total dd")?.textContent).toContain("914,80");
    });
  });

  it("cart quantity increment and decrement update item count", async () => {
    const cartCalls: Array<{ sku: string; quantity: number }> = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/cart")) {
        const body = JSON.parse(String(init?.body || "{}")) as { items: Array<{ sku: string; quantity: number }> };
        cartCalls.push(...body.items);
        // Server reconciles: reflect requested quantity in the returned experience.
        const change = body.items[0]!;
        const experience = buildStartResponse(baseTheme).experience;
        const unitPrice = 449.9;
        experience.items =
          change.quantity === 0
            ? []
            : [{ sku: change.sku, name: "Bolsa Executiva", quantity: change.quantity, unit_price: unitPrice, line_total: unitPrice * change.quantity }];
        const subtotal = change.quantity * unitPrice;
        experience.totals = { currency: "BRL", subtotal, shipping: 0, discount: 0, total: subtotal };
        return new Response(
          JSON.stringify({ session_id: "sess_1", experience }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);
    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-brand strong")?.textContent).toBe("Northstar Atelier");
    });

    // Initial qty = 2
    const qtySpan = () => container.querySelector(".aacp-item-meta span");
    expect(qtySpan()?.textContent).toBe("2");

    fireEvent.click(getByLabelText("Aumentar quantidade de Bolsa Executiva"));
    await waitFor(() => {
      expect(qtySpan()?.textContent).toBe("3");
    });

    fireEvent.click(getByLabelText("Diminuir quantidade de Bolsa Executiva"));
    await waitFor(() => {
      expect(qtySpan()?.textContent).toBe("2");
    });

    // Decrement to 1 then 0 (removes item)
    fireEvent.click(getByLabelText("Diminuir quantidade de Bolsa Executiva"));
    await waitFor(() => { expect(qtySpan()?.textContent).toBe("1"); });
    fireEvent.click(getByLabelText("Diminuir quantidade de Bolsa Executiva"));
    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-empty")).not.toBeNull();
    });

    // Server is the authority: each mutation persisted with sku + quantity (never price).
    await waitFor(() => {
      expect(cartCalls.some((call) => call.quantity === 0)).toBe(true);
    });
    expect(cartCalls[0]).toMatchObject({ quantity: 3 });
    expect(cartCalls.every((call) => typeof call.sku === "string")).toBe(true);
  });

  it("coupon box: typing code and submitting calls coupon API endpoint", async () => {
    let couponApiCalled = false;
    let couponRequestBody: Record<string, unknown> = {};
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        return new Response(
          JSON.stringify(
            buildChatResponse("Escolha o pagamento.", "payment", {
              quickReplies: [],
              actions: []
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/embed/coupons/apply")) {
        couponApiCalled = true;
        couponRequestBody = JSON.parse(String(init?.body || "{}"));
        return new Response(
          JSON.stringify({ redemption_id: "r_123", discount_applied: 89.98, coupon: { code: "PROMO10" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);
    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    const chatInput = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(chatInput, { target: { value: "quero pagar" } });
    fireEvent.submit(container.querySelector("form.aacp-composer-form")!);

    const couponGate = await waitFor(() => {
      const button = Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button"))
        .find((candidate) => candidate.textContent === "Sim");
      expect(button).not.toBeUndefined();
      return button as HTMLButtonElement;
    });
    fireEvent.click(couponGate);

    await waitFor(() => {
      expect(getByLabelText("Cupom de desconto")).not.toBeNull();
    });

    const couponInput = getByLabelText("Cupom de desconto") as HTMLInputElement;
    fireEvent.change(couponInput, { target: { value: "PROMO10" } });
    expect(couponInput.value).toBe("PROMO10");

    fireEvent.submit(couponInput.closest("form")!);

    await waitFor(() => {
      expect(couponApiCalled).toBe(true);
    });
    expect(couponRequestBody.code).toBe("PROMO10");
    await waitFor(() => {
      expect(container.textContent).toContain("Cupom PROMO10 aplicado");
    });
  });

  it("coupon gate: asks before showing coupon input and releases payment methods when skipped", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        return new Response(
          JSON.stringify(
            buildChatResponse("Vamos finalizar. Voce tem cupom?", "payment", {
              authorizedOffer: null,
              quickReplies: ["PIX", "Cartao de credito"],
              actions: []
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);
    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    const chatInput = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(chatInput, { target: { value: "quero pagar" } });
    fireEvent.submit(container.querySelector("form.aacp-composer-form")!);

    await waitFor(() => {
      const labels = Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button")).map((b) => b.textContent ?? "");
      expect(labels).toContain("Sim");
      expect(labels).toContain("Não");
      expect(labels).not.toContain("PIX");
    });
    expect(container.querySelector("input[aria-label='Cupom de desconto']")).toBeNull();

    const skipCoupon = Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button"))
      .find((button) => button.textContent === "Não");
    fireEvent.click(skipCoupon!);

    await waitFor(() => {
      const labels = Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button")).map((b) => b.textContent ?? "");
      expect(labels).toContain("PIX");
      expect(labels).toContain("Cartão de crédito");
    });
  });

  it("Card declined: Stripe Elements exibe erro quando confirmPayment é recusado (sem confirmação, sem PAN/CVV)", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        return new Response(
          JSON.stringify(
            buildChatResponse("Escolha o método de pagamento", "payment", {
              authorizedOffer: null,
              quickReplies: ["Pagar com Cartão de Crédito"],
              actions: []
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/embed/payment/intents")) {
        return new Response(
          JSON.stringify({
            id: "pi_test_2",
            amountCents: 92970,
            currency: "BRL",
            status: "pending",
            buyerFacing: {
              clientSecret: "pi_test_secret_abc",
              stripePublishableKey: "pk_test_xyz"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    // Stripe declines the card client-side.
    mockConfirmPaymentGlobal.mockResolvedValue({
      error: { message: "Seu cartão foi recusado." }
    });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);
    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Quero pagar com cartão" } });
    fireEvent.submit(container.querySelector("form.aacp-composer-form")!);

    await skipCouponGate(container);

    await waitFor(() => {
      expect(container.textContent).toContain("Cartão de crédito");
    });

    const cardQr = Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button"))
      .find((b) => (b.textContent ?? "").includes("Cartão"));
    await act(async () => { fireEvent.click(cardQr!); });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="stripe-payment-element"]')).not.toBeNull();
    });
    expect(container.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-csc"]')).toBeNull();

    const stripeForm = container.querySelector("form");
    await act(async () => { fireEvent.submit(stripeForm!); });

    await waitFor(() => {
      expect(container.textContent).toContain("Seu cartão foi recusado.");
    });
    expect(container.textContent).not.toContain("Pagamento confirmado");
    expect(container.textContent).not.toContain("Pedido confirmado");
  });

  it("validates email, OTP, and phone with success and error cases", async () => {
    let lastSentMessage = "";
    let attemptCount = 0;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        const body = JSON.parse(String(init?.body || "{}"));
        lastSentMessage = body.user_message || "";
        attemptCount++;

        let messageText = "Como posso ajudar?";
        let qrs: string[] = [];

        // Name validation (always success)
        if (lastSentMessage.includes("João")) {
          messageText = "Obrigado, João! Agora informe seu email.";
          qrs = ["joao@email.com"];
        }
        // Email validation - test invalid email
        else if (lastSentMessage === "email-invalido") {
          messageText = "Email inválido. Por favor, informe um email válido.";
          qrs = ["joao@email.com"];
        }
        // Email validation - success case
        else if (lastSentMessage.includes("@") && !lastSentMessage.includes("invalido")) {
          messageText = "Obrigado! Informe o código de verificação enviado para seu email.";
          qrs = ["123456"];
        }
        // OTP validation - test wrong OTP
        else if (lastSentMessage === "otp-errado") {
          messageText = "Código incorreto. Tente novamente ou solicite um novo código.";
          qrs = ["Reenviar código", "123456"];
        }
        // OTP validation - success case
        else if (lastSentMessage === "123456") {
          messageText = "Email verificado com sucesso! Qual o seu CPF?";
          qrs = ["123.456.789-00"];
        }
        // CPF validation - success
        else if (lastSentMessage.includes("123.456.789-00")) {
          messageText = "Obrigado! Qual seu telefone?";
          qrs = ["(11) 99999-9999"];
        }
        // Phone validation - test invalid phone
        else if (lastSentMessage === "telefone-invalido") {
          messageText = "Número de telefone inválido. Use o formato (11) 99999-9999.";
          qrs = ["(11) 99999-9999"];
        }
        // Phone validation - success
        else if (lastSentMessage.includes("(11) 99999-9999")) {
          messageText = "Telefone verificado! Cadastro completo.";
          qrs = [];
        }

        return new Response(
          JSON.stringify(
            buildChatResponse(messageText, "data_collection", {
              quickReplies: qrs,
              experience: {},
              actions: []
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;

    // 1. Send valid name
    fireEvent.change(input, { target: { value: "Meu nome é João" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("João");
    });

    // 2. Test invalid email
    fireEvent.change(input, { target: { value: "email-invalido" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Email inválido");
    });

    // 3. Send valid email
    fireEvent.change(input, { target: { value: "joao@email.com" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("código de verificação");
    });

    // 4. Test wrong OTP
    fireEvent.change(input, { target: { value: "otp-errado" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Código incorreto");
    });

    // 5. Send correct OTP
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Email verificado");
    });

    // 6. Send CPF
    fireEvent.change(input, { target: { value: "123.456.789-00" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("telefone");
    });

    // 7. Test invalid phone
    fireEvent.change(input, { target: { value: "telefone-invalido" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Número de telefone inválido");
    });

    // 8. Send valid phone
    fireEvent.change(input, { target: { value: "(11) 99999-9999" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => {
      expect(container.textContent).toContain("Telefone verificado");
    });
  });

  it("cross-sell: banner renders when experience returns suggestedProducts", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        const response = buildStartResponse(baseTheme);
        response.experience.suggestedProducts = [
          { sku: "wallet-001", name: "Carteira Slim RFID", unit_price: 129.9, image_url: "https://cdn.example.com/wallet.jpg" },
          { sku: "belt-002", name: "Cinto de Couro Genuíno", unit_price: 89.9 }
        ];
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Você também pode gostar");
    });
    expect(container.textContent).toContain("Carteira Slim RFID");
    expect(container.textContent).toContain("Cinto de Couro Genuíno");
    expect(container.querySelectorAll(".aacp-cross-sell-card")).toHaveLength(2);
  });

  it("cross-sell: clicking Adicionar sends 'Quero adicionar: {name}' to chat API", async () => {
    const capturedMessages: string[] = [];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        const response = buildStartResponse(baseTheme);
        response.experience.suggestedProducts = [
          { sku: "wallet-001", name: "Carteira Slim RFID", unit_price: 129.9 }
        ];
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        const body = JSON.parse(String(init?.body || "{}"));
        capturedMessages.push(body.user_message || "");
        return new Response(
          JSON.stringify(buildChatResponse("Produto adicionado ao seu pedido!", "data_collection", { actions: [], quickReplies: [] })),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-cross-sell-card")).not.toBeNull();
    });

    const addBtn = Array.from(container.querySelectorAll(".aacp-cross-sell-card button"))
      .find((b) => (b.textContent ?? "").includes("Adicionar"));
    expect(addBtn).not.toBeUndefined();

    await act(async () => {
      fireEvent.click(addBtn!);
    });

    await waitFor(() => {
      expect(capturedMessages).toContain("Quero adicionar: Carteira Slim RFID");
    });
  });

  it("cross-sell: after add, cart total updates with new item from API response", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        const response = buildStartResponse(baseTheme);
        response.experience.suggestedProducts = [
          { suggestion_id: "sug_1", sku: "wallet-001", name: "Carteira Slim RFID", unit_price: 129.9 }
        ];
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/cross-sell/accept")) {
        const body = JSON.parse(String(init?.body || "{}"));
        expect(body.accepted_skus).toEqual(["wallet-001"]);
        const experience = buildStartResponse(baseTheme).experience;
        return new Response(
          JSON.stringify(
            {
              suggestion: { id: "sug_1", status: "accepted" },
              agent_turn: {
                role: "agent",
                text: "Adicionei a Carteira Slim RFID ao seu pedido!",
                occurredAt: new Date().toISOString()
              },
              experience: {
                ...experience,
                suggestedProducts: [],
                items: [
                  { sku: "bag-001", name: "Bolsa Executiva", quantity: 2, unit_price: 449.9, line_total: 899.8 },
                  { sku: "wallet-001", name: "Carteira Slim RFID", quantity: 1, unit_price: 129.9, line_total: 129.9 }
                ],
                totals: {
                  currency: "BRL",
                  subtotal: 1029.7,
                  shipping: 29.9,
                  discount: 0,
                  total: 1059.6
                }
              }
            }
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-total dd")?.textContent).toMatch(/929/);
    });

    await waitFor(() => {
      expect(container.querySelector(".aacp-cross-sell-card")).not.toBeNull();
    });

    const addBtn = Array.from(container.querySelectorAll(".aacp-cross-sell-card button"))
      .find((b) => (b.textContent ?? "").includes("Adicionar"));

    await act(async () => {
      fireEvent.click(addBtn!);
    });

    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-total dd")?.textContent).toContain("1.059,60");
    });
    expect(container.textContent).toContain("Carteira Slim RFID");
    expect(container.querySelectorAll(".aacp-item")).toHaveLength(2);
  });

  it("cross-sell: banner renders when chat response delivers suggestedProducts at payment step", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat")) {
        const body = JSON.parse(String(init?.body || "{}"));
        const msg: string = (body.user_message || "").toLowerCase();
        if (msg.includes("sedex")) {
          // Reaching payment is where the API attaches cross-sell suggestions.
          return new Response(
            JSON.stringify(
              buildChatResponse("Sedex selecionado! Antes de pagar, veja estes complementos.", "payment", {
                quickReplies: [],
                actions: [],
                experience: {
                  stage: "payment",
                  suggestedProducts: [
                    { sku: "wallet-001", name: "Carteira Slim RFID", unit_price: 129.9 },
                    { sku: "belt-002", name: "Cinto de Couro Genuíno", unit_price: 89.9 }
                  ]
                }
              })
            ),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify(
            buildChatResponse("Escolha a entrega.", "shipping", {
              quickReplies: ["PAC (Grátis)", "Sedex (R$ 15,00)"],
              actions: [],
              experience: {
                stage: "shipping",
                shippingOptions: [
                  { customerPrice: 0, carrier: "Correios", method: "PAC", deliveryDays: 5 },
                  { customerPrice: 15, carrier: "Correios", method: "Sedex", deliveryDays: 2 }
                ]
              }
            })
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const { container, getByLabelText } = render(<CheckoutAgent config={buildConfig()} />);
    await waitFor(() => {
      expect(container.querySelector(".aacp-chat-bubble--agent")).not.toBeNull();
    });

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "calcular frete" } });
    fireEvent.submit(container.querySelector("form.aacp-composer-form")!);

    await waitFor(() => {
      expect(container.textContent).toContain("Sedex (R$ 15,00)");
    });

    const sedexQr = Array.from(container.querySelectorAll(".aacp-quick-replies button"))
      .find((b) => (b.textContent ?? "").includes("Sedex"));
    fireEvent.click(sedexQr!);

    await waitFor(() => {
      expect(container.querySelector(".aacp-cross-sell")).not.toBeNull();
    });
    expect(container.textContent).toContain("Você também pode gostar");
    expect(container.querySelectorAll(".aacp-cross-sell-card")).toHaveLength(2);
  });
});
