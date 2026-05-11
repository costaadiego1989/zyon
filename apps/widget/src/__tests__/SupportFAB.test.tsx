import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { SupportFAB } from "../components/checkout/SupportFAB.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";

function buildVm(overrides: Partial<{ supportOpen: boolean; setSupportOpen: (v: boolean) => void }> = {}): CheckoutAgentViewModel {
  return {
    supportOpen: false,
    setSupportOpen: vi.fn(),
    ...overrides,
  } as unknown as CheckoutAgentViewModel;
}

describe("SupportFAB", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Ícone e estado do botão ───────────────────────────────────────────────

  it("A01 — botão sem classe active quando painel fechado", () => {
    const { container } = render(<SupportFAB vm={buildVm({ supportOpen: false })} />);
    const btn = container.querySelector(".aacp-fab");
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains("active")).toBe(false);
  });

  it("A02/A05 — botão com classe active quando painel aberto", () => {
    const { container } = render(<SupportFAB vm={buildVm({ supportOpen: true })} />);
    const btn = container.querySelector(".aacp-fab");
    expect(btn!.classList.contains("active")).toBe(true);
  });

  // ── Interação de click ────────────────────────────────────────────────────

  it("A03 — click chama setSupportOpen(true) quando fechado", () => {
    const setSupportOpen = vi.fn();
    const { container } = render(
      <SupportFAB vm={buildVm({ supportOpen: false, setSupportOpen })} />
    );
    fireEvent.click(container.querySelector(".aacp-fab")!);
    expect(setSupportOpen).toHaveBeenCalledWith(true);
  });

  it("A04 — click chama setSupportOpen(false) quando aberto", () => {
    const setSupportOpen = vi.fn();
    const { container } = render(
      <SupportFAB vm={buildVm({ supportOpen: true, setSupportOpen })} />
    );
    fireEvent.click(container.querySelector(".aacp-fab")!);
    expect(setSupportOpen).toHaveBeenCalledWith(false);
  });

  // ── Acessibilidade ────────────────────────────────────────────────────────

  it("A06 — aria-label 'Abrir suporte' quando fechado", () => {
    const { container } = render(<SupportFAB vm={buildVm({ supportOpen: false })} />);
    expect(container.querySelector(".aacp-fab")!.getAttribute("aria-label")).toBe("Abrir suporte");
  });

  it("A07 — aria-label 'Fechar suporte' quando aberto", () => {
    const { container } = render(<SupportFAB vm={buildVm({ supportOpen: true })} />);
    expect(container.querySelector(".aacp-fab")!.getAttribute("aria-label")).toBe("Fechar suporte");
  });

  // ── Tooltip ───────────────────────────────────────────────────────────────

  it("A08 — tooltip visível no mount inicial", () => {
    const { getByText } = render(<SupportFAB vm={buildVm()} />);
    expect(getByText("Precisa de ajuda com o pedido?")).not.toBeNull();
  });

  it("A09 — tooltip desaparece após 8 segundos", () => {
    const { queryByText } = render(<SupportFAB vm={buildVm()} />);
    act(() => { vi.advanceTimersByTime(8000); });
    expect(queryByText("Precisa de ajuda com o pedido?")).toBeNull();
  });

  it("A09 — tooltip ainda visível antes de 8 segundos", () => {
    const { getByText } = render(<SupportFAB vm={buildVm()} />);
    act(() => { vi.advanceTimersByTime(7999); });
    expect(getByText("Precisa de ajuda com o pedido?")).not.toBeNull();
  });

  it("A10 — tooltip não renderizado quando painel está aberto", () => {
    const { queryByText } = render(<SupportFAB vm={buildVm({ supportOpen: true })} />);
    expect(queryByText("Precisa de ajuda com o pedido?")).toBeNull();
  });

  it("A11 — click no X do tooltip oculta tooltip sem fechar painel", () => {
    const setSupportOpen = vi.fn();
    const { queryByText, container } = render(
      <SupportFAB vm={buildVm({ supportOpen: false, setSupportOpen })} />
    );
    const tooltipCloseBtn = container.querySelector(".aacp-fab-tooltip button");
    expect(tooltipCloseBtn).not.toBeNull();
    fireEvent.click(tooltipCloseBtn!);
    expect(queryByText("Precisa de ajuda com o pedido?")).toBeNull();
    expect(setSupportOpen).not.toHaveBeenCalled();
  });

  it("A12 — cleanup: clearTimeout chamado no unmount", () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<SupportFAB vm={buildVm()} />);
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
