import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCheckoutPanels } from "../hooks/use-checkout-panels.js";

describe("useCheckoutPanels", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // ── Estado inicial ────────────────────────────────────────────────────────

  it("D01 — todos os painéis iniciam fechados", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    expect(result.current.cartOpen).toBe(false);
    expect(result.current.supportOpen).toBe(false);
    expect(result.current.userPanelOpen).toBe(false);
  });

  it("D01 — showCardForm inicia como false", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    expect(result.current.showCardForm).toBe(false);
  });

  it("D01 — cardError inicia como null", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    expect(result.current.cardError).toBeNull();
  });

  it("D01 — colorMode inicia como light", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    expect(result.current.colorMode).toBe("light");
  });

  // ── supportOpen ───────────────────────────────────────────────────────────

  it("D02 — setSupportOpen(true) atualiza estado", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.setSupportOpen(true); });
    expect(result.current.supportOpen).toBe(true);
  });

  it("D03 — setSupportOpen(false) reverte estado", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.setSupportOpen(true); });
    act(() => { result.current.setSupportOpen(false); });
    expect(result.current.supportOpen).toBe(false);
  });

  // ── Independência entre painéis ───────────────────────────────────────────

  it("D04 — supportOpen não afeta cartOpen nem userPanelOpen", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.setSupportOpen(true); });
    expect(result.current.cartOpen).toBe(false);
    expect(result.current.userPanelOpen).toBe(false);
  });

  it("D04 — cartOpen não afeta supportOpen", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.setCartOpen(true); });
    expect(result.current.supportOpen).toBe(false);
  });

  it("D05 — múltiplos painéis podem estar abertos simultaneamente", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => {
      result.current.setSupportOpen(true);
      result.current.setCartOpen(true);
    });
    expect(result.current.supportOpen).toBe(true);
    expect(result.current.cartOpen).toBe(true);
  });

  // ── colorMode ─────────────────────────────────────────────────────────────

  it("toggleColorMode alterna light → dark", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.toggleColorMode(); });
    expect(result.current.colorMode).toBe("dark");
  });

  it("toggleColorMode alterna dark → light", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.toggleColorMode(); });
    act(() => { result.current.toggleColorMode(); });
    expect(result.current.colorMode).toBe("light");
  });

  // ── userTab ───────────────────────────────────────────────────────────────

  it("userTab inicia como profile", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    expect(result.current.userTab).toBe("profile");
  });

  it("setUserTab atualiza aba ativa", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.setUserTab("orders"); });
    expect(result.current.userTab).toBe("orders");
  });

  // ── cardError ─────────────────────────────────────────────────────────────

  it("setCardError persiste mensagem de erro", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.setCardError("Cartão recusado"); });
    expect(result.current.cardError).toBe("Cartão recusado");
  });

  it("setCardError(null) limpa erro", () => {
    const { result } = renderHook(() => useCheckoutPanels());
    act(() => { result.current.setCardError("Erro"); });
    act(() => { result.current.setCardError(null); });
    expect(result.current.cardError).toBeNull();
  });
});
