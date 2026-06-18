/**
 * Regression tests for use-order-completion bugs documented in ADR 0006.
 *
 * P2a: postMessage must use storeUrl origin as targetOrigin, not "*".
 * P2b: orderCompletionHandled ref must re-arm after stage leaves "completed".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOrderCompletion } from "../hooks/use-order-completion.js";
import type { CheckoutExperienceSnapshot, CurrencyCode } from "@aacp/shared-types";

function buildExperience(stage = "payment"): CheckoutExperienceSnapshot {
  return {
    stage: stage as CheckoutExperienceSnapshot["stage"],
    brand: {
      merchant_id: "mrc_test",
      name: "Loja Test",
      subtitle: "",
      logo_url: "",
      accent_color: "#000",
      support_label: "",
      theme: {} as never
    },
    rules: { couponBoxEnabled: true },
    items: [],
    totals: { currency: "BRL" as CurrencyCode, subtotal: 100, shipping: 0, discount: 0, total: 100 },
    agent: { name: "Bot", greeting: "Ola", tone: "consultive" as never, language: "pt-BR" },
    copy: {
      headline: "",
      subheadline: "",
      trust_badges: [],
      quick_replies: [],
      focus_input: false
    }
  };
}

function buildInput(overrides: Partial<Parameters<typeof useOrderCompletion>[0]> = {}) {
  return {
    checkoutStage: "payment",
    sessionId: "sess_1",
    merchantId: "mrc_test",
    storeUrl: "https://mystore.example.com",
    activeExperience: buildExperience(),
    currency: "BRL" as CurrencyCode,
    visibleItems: [],
    visibleTotals: { currency: "BRL" as CurrencyCode, subtotal: 100, shipping: 0, discount: 0, total: 100 },
    isBuyerSession: false,
    syncExperience: vi.fn(),
    resetCart: vi.fn(),
    resetChat: vi.fn(),
    resetPanels: vi.fn(),
    resetPrePayment: vi.fn(),
    clearPersistedSession: vi.fn(),
    loginFromCheckout: vi.fn().mockResolvedValue(true),
    refreshBuyerHub: vi.fn().mockResolvedValue(undefined),
    authSession: null,
    ...overrides
  };
}

describe("useOrderCompletion — ADR 0006 regressions", () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on window.parent.postMessage rather than replacing window.
    postMessageSpy = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  // ── P2a: postMessage targetOrigin ────────────────────────────────────────

  it("P2a: postMessage usa origem do storeUrl como targetOrigin (não '*')", () => {
    renderHook(() =>
      useOrderCompletion(buildInput({ checkoutStage: "completed" }))
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "aacp:order-completed",
        merchant_id: "mrc_test",
        session_id: "sess_1"
      }),
      "https://mystore.example.com"
    );
  });

  it("P2a: postMessage usa '*' quando storeUrl não configurado (fallback)", () => {
    renderHook(() =>
      useOrderCompletion(buildInput({ checkoutStage: "completed", storeUrl: undefined }))
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "aacp:order-completed" }),
      "*"
    );
  });

  it("P2a: postMessage usa '*' quando storeUrl é URL inválida (não lança)", () => {
    renderHook(() =>
      useOrderCompletion(buildInput({ checkoutStage: "completed", storeUrl: "not-a-url" }))
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "aacp:order-completed" }),
      "*"
    );
  });

  // ── P2b: re-arm guard after stage leaves "completed" ─────────────────────

  it("P2b: re-arms orderCompletionHandled quando stage sai de completed e retorna", () => {
    const syncExperience = vi.fn();
    const resetChat = vi.fn();

    let currentStage = "completed";
    const { rerender } = renderHook(({ stage }) =>
      useOrderCompletion(buildInput({ checkoutStage: stage, syncExperience, resetChat })),
      { initialProps: { stage: "completed" } }
    );

    // First completion fires.
    expect(syncExperience).toHaveBeenCalledTimes(1);

    // Stage resets back to "payment" (new order started).
    rerender({ stage: "payment" });

    // Stage goes back to "completed" for a second order.
    rerender({ stage: "completed" });

    // P2b: second completion must also fire.
    expect(syncExperience).toHaveBeenCalledTimes(2);
  });
});
