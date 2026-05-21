import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCheckoutChat } from "../hooks/use-checkout-chat.js";
import type { WidgetConfig } from "../lib/widget-types.js";
import type { CheckoutSessionState } from "../hooks/use-checkout-session.js";

vi.mock("../lib/embed-client.js", () => ({
  normalizeApiBase: (v: string) => v,
  checkoutJson: vi.fn(),
  CHECKOUT_EMBED_PATHS: {
    chatMessage: "/embed/chat",
    trackEvent: "/embed/track",
    paymentIntents: "/embed/payment/intents",
    startCheckout: "/embed/start",
    offers: "/embed/offers/apply"
  },
  CHECKOUT_LEGACY_PATHS: {
    chatMessage: "/chat/message",
    trackEvent: "/track-event",
    paymentIntents: "/payment/intents",
    startCheckout: "/start-checkout",
    offers: "/offers/apply"
  }
}));

const { checkoutJson } = await import("../lib/embed-client.js");
const mockCheckoutJson = checkoutJson as ReturnType<typeof vi.fn>;

function buildConfig(): WidgetConfig {
  return {
    mode: "embed",
    embedSessionToken: "tok.test",
    merchantId: "mrc_test",
    apiBaseUrl: "http://localhost:3001",
    uiPresentation: "conversational",
    cart: { currency: "BRL", total: 300, items: [] }
  };
}

function buildActiveExperience() {
  return {
    stage: "data_collection",
    brand: {
      merchant_id: "mrc_test",
      name: "Test",
      subtitle: "",
      support_label: "",
      theme: {} as any
    },
    items: [],
    totals: { currency: "BRL", subtotal: 300, shipping: 0, discount: 0, total: 300 },
    agent: { name: "Bot", greeting: "Ola", tone: "consultative", language: "pt-BR" },
    copy: { headline: "", subheadline: "", trust_badges: [], quick_replies: [] }
  };
}

function buildSessionState(overrides: Partial<CheckoutSessionState> = {}): CheckoutSessionState {
  return {
    session: {
      session_id: "sess_test",
      conversation_id: "conv_test",
      global_user_id: "gu_test",
      agent_enabled: true,
      initial_mode: "open",
      tracking_token: "trk_test",
      experience: buildActiveExperience()
    },
    apiOrigin: "http://localhost:3001",
    embedOpts: { embedToken: "tok.test" },
    activeExperience: buildActiveExperience() as any,
    networkError: null,
    startedEvent: null,
    startErrorTs: null,
    setNetworkError: vi.fn(),
    syncExperience: vi.fn(),
    track: vi.fn(),
    retryStartCheckout: vi.fn(),
    ...overrides
  } as unknown as CheckoutSessionState;
}

function buildChatResponse(overrides: Record<string, unknown> = {}) {
  return {
    message: "Olá! Como posso ajudar?",
    objection: "unknown",
    authorized_offer: null,
    actions: [],
    turns: [
      { role: "agent", text: "Olá! Como posso ajudar?", occurredAt: new Date().toISOString() }
    ],
    experience: buildActiveExperience(),
    stage: "data_collection",
    missing_fields: [],
    expected_input_type: "text",
    ...overrides
  };
}

beforeEach(() => {
  mockCheckoutJson.mockReset();
});

describe("useCheckoutChat", () => {
  it("initial state: empty turns, not busy, no lastChat", () => {
    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState())
    );
    expect(result.current.turns).toHaveLength(0);
    expect(result.current.busy).toBe(false);
    expect(result.current.lastChat).toBeNull();
  });

  it("sendMessageWithOverride: does nothing when session is null", async () => {
    const sessionState = buildSessionState({ session: null });
    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), sessionState)
    );

    await act(async () => {
      await result.current.sendMessageWithOverride("Olá");
    });

    expect(mockCheckoutJson).not.toHaveBeenCalled();
    expect(result.current.turns).toHaveLength(0);
  });

  it("sendMessageWithOverride: turns list is populated after response", async () => {
    mockCheckoutJson.mockResolvedValue(buildChatResponse({
      turns: [
        { role: "buyer", text: "Quero finalizar", occurredAt: new Date().toISOString() },
        { role: "agent", text: "Olá! Como posso ajudar?", occurredAt: new Date().toISOString() }
      ]
    }));

    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState())
    );

    await act(async () => {
      await result.current.sendMessageWithOverride("Quero finalizar");
    });

    expect(result.current.turns.length).toBeGreaterThan(0);
    const buyerTurn = result.current.turns.find((t) => t.role === "buyer");
    expect(buyerTurn?.text).toBe("Quero finalizar");
  });

  it("sendMessageWithOverride: adds agent turns from response", async () => {
    mockCheckoutJson.mockResolvedValue(buildChatResponse({
      turns: [{ role: "agent", text: "Agente respondeu", occurredAt: new Date().toISOString() }]
    }));

    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState())
    );

    await act(async () => {
      await result.current.sendMessageWithOverride("Oi");
    });

    const agentTurn = result.current.turns.find((t) => t.role === "agent");
    expect(agentTurn?.text).toBe("Agente respondeu");
  });

  it("sendMessageWithOverride: sets lastChat with stage from response", async () => {
    mockCheckoutJson.mockResolvedValue(buildChatResponse({ stage: "payment" }));

    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState())
    );

    await act(async () => {
      await result.current.sendMessageWithOverride("Pagar");
    });

    expect(result.current.lastChat?.stage).toBe("payment");
  });

  it("sendMessageWithOverride: busy=false after successful response", async () => {
    mockCheckoutJson.mockResolvedValue(buildChatResponse());
    const setNetworkError = vi.fn();

    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState({ setNetworkError }))
    );

    await act(async () => {
      await result.current.sendMessageWithOverride("Oi");
    });

    expect(result.current.busy).toBe(false);
    expect(setNetworkError).toHaveBeenCalledWith(null);
  });

  it("appendAgentTurn: adds an agent turn to the turns list", () => {
    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState())
    );

    act(() => {
      result.current.appendAgentTurn("Mensagem do agente");
    });

    expect(result.current.turns.some((t) =>
      t.text === "Mensagem do agente" && t.role === "agent"
    )).toBe(true);
  });

  it("retryChat: clears turns and lastChat", async () => {
    mockCheckoutJson.mockResolvedValue(buildChatResponse());

    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState())
    );

    await act(async () => {
      await result.current.sendMessageWithOverride("Oi");
    });
    expect(result.current.turns.length).toBeGreaterThan(0);

    act(() => { result.current.retryChat(); });

    expect(result.current.turns).toHaveLength(0);
    expect(result.current.lastChat).toBeNull();
  });

  it("network error: busy resets to false and setNetworkError called", async () => {
    mockCheckoutJson.mockRejectedValue(new Error("Network failure"));
    const setNetworkError = vi.fn();
    const sessionState = buildSessionState({ setNetworkError });

    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), sessionState)
    );

    await act(async () => {
      await result.current.sendMessageWithOverride("Oi");
    });

    expect(result.current.busy).toBe(false);
    expect(setNetworkError).toHaveBeenCalled();
  });

  it("composerLocked=false when not busy and no networkError", () => {
    const { result } = renderHook(() =>
      useCheckoutChat(buildConfig(), buildSessionState())
    );
    expect(result.current.composerLocked).toBe(false);
  });
});
