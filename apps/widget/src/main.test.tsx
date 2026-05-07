import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { CheckoutAgent, themeStyle, type WidgetConfig } from "./main";
import type {
  ChatAction,
  ChatMessageResponse,
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
    apiBaseUrl: "http://localhost:3000",
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("applies merchant theme variables and renders greeting + cart total", async () => {
    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-cart-brand strong")?.textContent).toBe(
        "Northstar Atelier"
      );
    });

    expect(container.querySelector(".aacp-stage-card")?.textContent).toContain("Cadastro");

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
    expect(container.querySelector(".aacp-stage-card")?.textContent).toContain("Pagamento");
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

  it("opens the global auth modal and authenticates against the real auth route", async () => {
    const { container, getByText, getByPlaceholderText } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-shell-header")).not.toBeNull();
    });

    fireEvent.click(getByText("Entrar com Google"));

    await waitFor(() => {
      expect(getByText("Entrar na aplicação global")).not.toBeNull();
    });

    fireEvent.change(getByPlaceholderText("voce@empresa.com"), {
      target: { value: "global@example.com" }
    });
    fireEvent.change(getByPlaceholderText("••••••••"), {
      target: { value: "super-secret-123" }
    });

    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url.endsWith("/auth/login")).toBe(true);
      return new Response(
        JSON.stringify({
          merchant_id: "mrc_demo",
          user_id: "usr_1",
          email: "global@example.com",
          access_token: "token_123",
          token_type: "Bearer",
          expires_in: 3600
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    fireEvent.click(getByText("Entrar na conta global"));

    await waitFor(() => {
      expect(container.querySelector(".aacp-auth-modal")).toBeNull();
    });

    expect(container.querySelector(".aacp-google-login strong")?.textContent).toBe("Conta global");
    expect(window.localStorage.getItem("aacp_global_auth_session")).toContain("global@example.com");
  });
});
