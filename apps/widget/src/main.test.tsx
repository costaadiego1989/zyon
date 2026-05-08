import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { CheckoutAgent, themeStyle, type WidgetConfig } from "./main";
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

const baseTheme: MerchantTheme = {
  accentColor: "#FF0066",
  textColor: "#0F172A",
  backgroundColor: "#F9FAFB",
  fontFamily: "Manrope, system-ui, sans-serif",
  logoUrl: "https://cdn.example.com/logo.png"
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
    experience?: Partial<StartCheckoutResponse["experience"]>;
  } = {}
): ChatMessageResponse {
  return {
    message,
    objection: "price",
    authorized_offer: {
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
    },
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
        occurredAt: "2026-05-04T16:00:31Z",
        authorizedOfferId: "off_1"
      }
    ],
    stage,
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
  });
});

describe("CheckoutAgent (conversational)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubEnv("AACP_DISABLE_STREAMING", "1");

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

    expect(container.querySelector(".aacp-cart-title")?.textContent).toContain("Seu pedido agora");
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
    expect(container.querySelector(".aacp-cart-total dd")?.textContent).toMatch(/29/);
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

  it("renders the welcome message with configured discount from the checkout API", async () => {
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
    expect(container.textContent).toContain("Tenho um cupom de desconto");
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
      expect.arrayContaining(["Aplicar cupom AURORA5", "Prefiro PIX", "Prefiro cartão", "Finalizar pedido"])
    );
    expect(container.querySelector(".aacp-flow-rail")?.textContent).toContain("Pagamento");
    expect(getByLabelText("Cupom de desconto")).not.toBeNull();
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

    await waitFor(() => {
      expect(
        Array.from(container.querySelectorAll(".aacp-quick-replies--in-thread button")).some((button) =>
          (button.textContent ?? "").includes("Aplicar oferta autorizada")
        )
      ).toBe(true);
    });

    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url.endsWith("/embed/offers/apply")).toBe(true);
      const appliedExperience = buildChatResponse(
        "Oferta aplicada. Vamos seguir para o pagamento.",
        "payment",
        {
          quickReplies: ["Prefiro PIX", "Prefiro cartão"]
        }
      ).experience!;
      appliedExperience.totals.discount = 79.9;
      appliedExperience.totals.total = 850;
      return new Response(
        JSON.stringify({
          success: true,
          discount_code: "AURORA5",
          new_total: 850,
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

    const quickReplyButton = Array.from(
      container.querySelectorAll(".aacp-quick-replies--in-thread button")
    ).find((button) => (button.textContent ?? "").includes("Aplicar oferta autorizada"));
    expect(quickReplyButton).not.toBeUndefined();
    fireEvent.click(quickReplyButton!);

    await waitFor(() => {
      expect(container.querySelector(".aacp-offer-banner")).not.toBeNull();
    });
    expect(container.querySelector(".aacp-offer-banner")?.textContent).toContain("novo total");
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
        expires_in: 3600
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
});
