import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { CheckoutAgent, themeStyle, type WidgetConfig } from "./main";
import type {
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
    apiBaseUrl: "http://localhost:3001",
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
      brand: {
        merchant_id: "mrc_demo",
        name: "Northstar Atelier",
        subtitle: "Checkout premium",
        logo_url: theme.logoUrl,
        accent_color: theme.accentColor,
        support_label: "Sincronizado",
        theme
      },
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
        quick_replies: ["Tem cupom?", "Frete fica caro"]
      }
    }
  };
}

function buildChatResponse(message: string): ChatMessageResponse {
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
    actions: [
      { label: "Aplicar cupom AURORA5", type: "apply_offer", offer_id: "off_1" },
      { label: "Continuar checkout", type: "continue_checkout" }
    ],
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
    ]
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

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/embed/start")) {
        return new Response(JSON.stringify(buildStartResponse(baseTheme)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/embed/chat/messages")) {
        return new Response(
          JSON.stringify(buildChatResponse("Posso aplicar 5% agora com o cupom AURORA5?")),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies merchant theme variables and renders greeting + summary", async () => {
    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelector(".aacp-brand-meta strong")?.textContent).toBe(
        "Northstar Atelier"
      );
    });

    const widget = container.querySelector(".aacp-widget--conversational") as HTMLElement;
    expect(widget.style.getPropertyValue("--aacp-accent")).toBe("#FF0066");
    expect(widget.style.getPropertyValue("--aacp-font")).toBe(
      "Manrope, system-ui, sans-serif"
    );
    expect(container.querySelector("img.aacp-brand-logo")?.getAttribute("src")).toBe(
      "https://cdn.example.com/logo.png"
    );

    const bubbles = container.querySelectorAll(".aacp-chat-bubble--agent");
    expect(bubbles.length).toBeGreaterThan(0);
    expect(bubbles[0]?.textContent).toContain("Aurora");

    expect(
      container.querySelector(".aacp-summary-row.total span:last-child")?.textContent
    ).toContain("929");
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

    const input = getByLabelText("Mensagem para o assistente") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "esta caro" } });

    const submitBtn = getByLabelText("Enviar mensagem") as HTMLButtonElement;
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(container.querySelector(".aacp-typing")).not.toBeNull();
    });
    expect(container.querySelector(".aacp-chat-bubble--buyer")?.textContent).toBe(
      "esta caro"
    );

    await act(async () => {
      resolveChat(
        new Response(
          JSON.stringify(buildChatResponse("Posso aplicar 5% agora com o cupom AURORA5?")),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    });

    await waitFor(() => {
      expect(container.querySelector(".aacp-typing")).toBeNull();
    });

    const bubbles = Array.from(container.querySelectorAll(".aacp-chat-bubble"));
    const texts = bubbles.map((b) => b.textContent ?? "");
    expect(texts).toContain("esta caro");
    expect(texts.some((t) => t.includes("AURORA5"))).toBe(true);

    expect(container.querySelector(".aacp-offer")?.textContent).toContain(
      "Aplicar oferta"
    );
  });

  it("falls back to default quick replies before any chat round", async () => {
    const { container } = render(<CheckoutAgent config={buildConfig()} />);

    await waitFor(() => {
      expect(container.querySelectorAll(".aacp-quick-replies button").length).toBeGreaterThan(
        0
      );
    });

    const chips = Array.from(
      container.querySelectorAll(".aacp-quick-replies button")
    ).map((b) => b.textContent);
    expect(chips).toEqual(["Tem cupom?", "Frete fica caro"]);
  });
});
