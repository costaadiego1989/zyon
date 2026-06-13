import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CheckoutHeader } from "../components/checkout/CheckoutHeader.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";

// ─── Minimal vm builder ───────────────────────────────────────────────────────

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    activeExperience: {
      agent: { name: "Aurora Assistente", tone: "consultative", language: "pt-BR", greeting: "" },
      brand: {
        merchant_id: "mrc_demo",
        name: "Northstar Atelier",
        subtitle: "",
        support_label: "",
        theme: {} as any
      },
      items: [],
      totals: { currency: "BRL", subtotal: 0, shipping: 0, discount: 0, total: 929.7 },
      copy: { headline: "", subheadline: "", trust_badges: [], quick_replies: [] },
      rules: { couponBoxEnabled: true }
    },
    theme: { accentColor: "#FF0066", textColor: "#000", backgroundColor: "#fff", fontFamily: "sans-serif" },
    colorMode: "light",
    toggleColorMode: vi.fn(),
    cartOpen: false,
    setCartOpen: vi.fn(),
    visibleTotals: { currency: "BRL", subtotal: 899.8, shipping: 29.9, discount: 0, total: 929.7 },
    auth: {
      session: null,
      open: false,
      panel: "login",
      error: null,
      openLogin: vi.fn(),
      openHub: vi.fn(),
      close: vi.fn(),
      logout: vi.fn()
    },
    setUserPanelOpen: vi.fn(),
    config: {
      mode: "legacy",
      merchantId: "mrc_demo",
      apiBaseUrl: "http://localhost:3009",
      cart: { currency: "BRL", source: "storefront", total: 929.7, items: [] },
      uiPresentation: "conversational"
    },
    ...overrides
  } as unknown as CheckoutAgentViewModel;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("CheckoutHeader", () => {
  // ── Agent identity ──────────────────────────────────────────────────────────

  it("renders agent first name and role from full name", () => {
    const { getByText } = render(<CheckoutHeader vm={buildVm()} />);
    expect(getByText("Aurora")).not.toBeNull();
    expect(getByText("Assistente")).not.toBeNull();
  });

  it("falls back to 'Assistente de Vendas' when agent has single name", () => {
    const vm = buildVm();
    vm.activeExperience.agent.name = "Aurora";
    const { getByText } = render(<CheckoutHeader vm={vm} />);
    expect(getByText("Assistente de Vendas")).not.toBeNull();
  });

  it("renders brand name with online status in subtitle", () => {
    const { container } = render(<CheckoutHeader vm={buildVm()} />);
    expect(container.querySelector(".aacp-agent-sub")?.textContent).toContain("Northstar Atelier");
    expect(container.querySelector(".aacp-agent-sub")?.textContent).toContain("online");
    expect(container.querySelector(".aacp-agent-sub")?.textContent).not.toContain("Pagamento seguro");
  });

  it("renders enterprise theme header copy without trust strip", () => {
    const vm = buildVm();
    vm.theme.headerTitle = "Concierge Northstar";
    vm.theme.headerSubtitle = "Pagamento seguro com acompanhamento premium";
    vm.theme.agentName = "Aurora VIP";
    vm.theme.trustBadges = ["Pagamento seguro", "Frete rastreavel", "Suporte humano"];
    const { container, getByText } = render(<CheckoutHeader vm={vm} />);
    expect(getByText("Concierge Northstar")).not.toBeNull();
    expect(container.querySelector(".aacp-agent-sub")?.textContent).toContain("Pagamento seguro");
    expect(container.querySelectorAll(".aacp-trust-seal")).toHaveLength(0);
  });

  it("renders avatar image when agentAvatarUrl is set", () => {
    const vm = buildVm();
    vm.theme.agentAvatarUrl = "https://cdn.example.com/avatar.png";
    const { container } = render(<CheckoutHeader vm={vm} />);
    const img = container.querySelector(".aacp-header-agent-avatar img");
    expect(img).not.toBeNull();
    expect((img as HTMLImageElement).src).toContain("avatar.png");
  });

  it("renders Bot icon in chat header when no agentAvatarUrl", () => {
    const vm = buildVm();
    vm.theme.agentAvatarUrl = undefined;
    const { container } = render(<CheckoutHeader vm={vm} />);
    expect(container.querySelector(".aacp-header-agent-avatar img")).toBeNull();
    expect(container.querySelector(".aacp-header-agent-avatar svg")).not.toBeNull();
  });

  it("does not render merchant initials in chat header", () => {
    const vm = buildVm();
    vm.theme.logoUrl = undefined;
    const { container } = render(<CheckoutHeader vm={vm} />);
    expect(container.querySelector(".aacp-header-monogram-text")).toBeNull();
    expect(container.querySelector(".aacp-header-agent-avatar")).not.toBeNull();
  });

  // ── Store return ────────────────────────────────────────────────────────────

  it("renders back to store link when storeUrl is configured", () => {
    const vm = buildVm();
    vm.config = {
      ...vm.config,
      storeUrl: "https://minhaloja.com.br",
      cart: { currency: "BRL", source: "storefront", total: 0, items: [] }
    };
    const { getByLabelText } = render(<CheckoutHeader vm={vm} />);
    const link = getByLabelText("Voltar ao site") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("https://minhaloja.com.br");
  });

  // ── Login states ────────────────────────────────────────────────────────────

  it("shows Entrar button when unauthenticated and not email-verified", () => {
    const { getByLabelText } = render(<CheckoutHeader vm={buildVm()} />);
    expect(getByLabelText("Entrar")).not.toBeNull();
  });

  it("calls auth.openLogin when Entrar is clicked", () => {
    const openLogin = vi.fn();
    const vm = buildVm();
    vm.auth.openLogin = openLogin;
    const { getByLabelText } = render(<CheckoutHeader vm={vm} />);
    fireEvent.click(getByLabelText("Entrar"));
    expect(openLogin).toHaveBeenCalledOnce();
  });

  it("shows verified customer chip with first name and Cliente label", () => {
    const vm = buildVm();
    (vm.activeExperience as any).customer = { fullName: "Diego Costa", email_verified: true };
    const { getByLabelText, container } = render(<CheckoutHeader vm={vm} />);
    const btn = getByLabelText("Abrir conta");
    expect(btn.textContent).toContain("Olá, Diego");
    expect(btn.textContent).toContain("Cliente");
    expect(container.querySelector("#aacp-login-btn")).not.toBeNull();
  });

  it("calls setUserPanelOpen(true) when verified customer chip is clicked", () => {
    const setUserPanelOpen = vi.fn();
    const vm = buildVm({ setUserPanelOpen });
    (vm.activeExperience as any).customer = { fullName: "Diego Costa", email_verified: true };
    const { getByLabelText } = render(<CheckoutHeader vm={vm} />);
    fireEvent.click(getByLabelText("Abrir conta"));
    expect(setUserPanelOpen).toHaveBeenCalledWith(true);
  });

  it("shows Minha conta chip with email initial when auth session exists", () => {
    const vm = buildVm();
    vm.auth.session = { email: "global@example.com" } as any;
    const { getByLabelText } = render(<CheckoutHeader vm={vm} />);
    const btn = getByLabelText("Minha conta");
    expect(btn.textContent).toContain("G");
    expect(btn.textContent).toContain("Minha conta");
  });

  it("calls auth.openHub when Minha conta chip is clicked", () => {
    const openHub = vi.fn();
    const vm = buildVm();
    vm.auth.session = { merchant_id: "mrc_001", user_id: "usr_001", email: "merchant@example.com" } as any;
    vm.auth.openHub = openHub;
    const { getByLabelText } = render(<CheckoutHeader vm={vm} />);
    fireEvent.click(getByLabelText("Minha conta"));
    expect(openHub).toHaveBeenCalledOnce();
  });

  it("opens buyer UserPanel when Minha conta is a buyer session", () => {
    const openHub = vi.fn();
    const setUserPanelOpen = vi.fn();
    const vm = buildVm({ setUserPanelOpen });
    vm.auth.session = { global_user_id: "guser_001", email: "buyer@example.com" } as any;
    vm.auth.openHub = openHub;
    const { getByLabelText } = render(<CheckoutHeader vm={vm} />);
    fireEvent.click(getByLabelText("Minha conta"));
    expect(setUserPanelOpen).toHaveBeenCalledWith(true);
    expect(openHub).not.toHaveBeenCalled();
  });

  it("auth session takes priority over email_verified customer chip", () => {
    const vm = buildVm();
    vm.auth.session = { email: "global@example.com" } as any;
    (vm.activeExperience as any).customer = { fullName: "Diego Costa", email_verified: true };
    const { queryByLabelText } = render(<CheckoutHeader vm={vm} />);
    expect(queryByLabelText("Minha conta")).not.toBeNull();
    expect(queryByLabelText("Abrir conta")).toBeNull();
    expect(queryByLabelText("Entrar")).toBeNull();
  });

  // ── Cart button ─────────────────────────────────────────────────────────────

  it("renders cart button with formatted total", () => {
    const { getByLabelText } = render(<CheckoutHeader vm={buildVm()} />);
    const btn = getByLabelText("Abrir resumo do pedido");
    expect(btn.textContent).toContain("929");
  });

  it("cart button has aria-expanded=false when cart is closed", () => {
    const { getByLabelText } = render(<CheckoutHeader vm={buildVm({ cartOpen: false })} />);
    expect(getByLabelText("Abrir resumo do pedido").getAttribute("aria-expanded")).toBe("false");
  });

  it("cart button has aria-expanded=true when cart is open", () => {
    const { getByLabelText } = render(<CheckoutHeader vm={buildVm({ cartOpen: true })} />);
    expect(getByLabelText("Abrir resumo do pedido").getAttribute("aria-expanded")).toBe("true");
  });

  it("calls setCartOpen(true) when cart button is clicked", () => {
    const setCartOpen = vi.fn();
    const { getByLabelText } = render(<CheckoutHeader vm={buildVm({ setCartOpen })} />);
    fireEvent.click(getByLabelText("Abrir resumo do pedido"));
    expect(setCartOpen).toHaveBeenCalledWith(true);
  });

  it("cart button has aria-controls pointing to aacp-cart-panel", () => {
    const { getByLabelText } = render(<CheckoutHeader vm={buildVm()} />);
    expect(getByLabelText("Abrir resumo do pedido").getAttribute("aria-controls")).toBe("aacp-cart-panel");
  });
});
