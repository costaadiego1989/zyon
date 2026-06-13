import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCheckoutPanels } from "../hooks/use-checkout-panels.js";

describe("useCheckoutPanels", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts with every auxiliary surface closed", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    expect(result.current.activeSurface).toEqual({ kind: "none" });
    expect(result.current.cartOpen).toBe(false);
    expect(result.current.supportOpen).toBe(false);
    expect(result.current.userPanelOpen).toBe(false);
    expect(result.current.showCardForm).toBe(false);
    expect(result.current.cardError).toBeNull();
    expect(result.current.colorMode).toBe("light");
  });

  it("opens and closes support through the compatibility adapter", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    act(() => { result.current.setSupportOpen(true); });
    expect(result.current.supportOpen).toBe(true);
    expect(result.current.activeSurface).toEqual({ kind: "support" });

    act(() => { result.current.setSupportOpen(false); });
    expect(result.current.activeSurface).toEqual({ kind: "none" });
  });

  it("keeps only one auxiliary surface open", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    act(() => {
      result.current.setSupportOpen(true);
      result.current.setCartOpen(true);
    });

    expect(result.current.supportOpen).toBe(false);
    expect(result.current.cartOpen).toBe(true);
    expect(result.current.activeSurface).toEqual({
      kind: "order",
      snapPoint: "full",
    });
  });

  it("opening the buyer hub closes the order summary", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    act(() => { result.current.setCartOpen(true); });
    act(() => { result.current.setUserPanelOpen(true); });

    expect(result.current.cartOpen).toBe(false);
    expect(result.current.userPanelOpen).toBe(true);
    expect(result.current.activeSurface).toEqual({
      kind: "account",
      section: "profile",
    });
  });

  it("preserves the selected buyer hub section across reopen", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    act(() => { result.current.setUserPanelOpen(true); });
    act(() => { result.current.setUserTab("orders"); });
    act(() => { result.current.setUserPanelOpen(false); });
    act(() => { result.current.setUserPanelOpen(true); });

    expect(result.current.userTab).toBe("orders");
    expect(result.current.activeSurface).toEqual({
      kind: "account",
      section: "orders",
    });
  });

  it("toggles and persists the color mode", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    act(() => { result.current.toggleColorMode(); });
    expect(result.current.colorMode).toBe("dark");
    expect(window.localStorage.getItem("aacp_color_mode")).toBe("dark");

    act(() => { result.current.toggleColorMode(); });
    expect(result.current.colorMode).toBe("light");
  });

  it("stores and clears card errors", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    act(() => { result.current.setCardError("Cartao recusado"); });
    expect(result.current.cardError).toBe("Cartao recusado");

    act(() => { result.current.setCardError(null); });
    expect(result.current.cardError).toBeNull();
  });

  it("resetPanels closes surfaces and transactional overlays", () => {
    const { result } = renderHook(() => useCheckoutPanels());

    act(() => {
      result.current.setSupportOpen(true);
      result.current.setBuyerGuestModalOpen(true);
      result.current.setShowCardForm(true);
      result.current.setCardError("Falha");
    });
    act(() => { result.current.resetPanels(); });

    expect(result.current.activeSurface).toEqual({ kind: "none" });
    expect(result.current.buyerGuestModalOpen).toBe(false);
    expect(result.current.showCardForm).toBe(false);
    expect(result.current.cardError).toBeNull();
  });
});
