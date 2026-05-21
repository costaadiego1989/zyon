import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { UserPanel } from "../components/checkout/UserPanel.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import type { BuyerHubState } from "../hooks/use-buyer-hub.js";

function buildBuyerHub(overrides: Partial<BuyerHubState> = {}): BuyerHubState {
  return {
    profile: null,
    summary: null,
    purchases: [],
    agent: null,
    loading: false,
    error: null,
    hasMorePurchases: false,
    refresh: vi.fn(),
    loadMorePurchases: vi.fn(),
    saveProfile: vi.fn(),
    saveAgent: vi.fn(),
    changePassword: vi.fn(),
    ...overrides
  };
}

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    userPanelOpen: true,
    setUserPanelOpen: vi.fn(),
    userTab: "profile",
    setUserTab: vi.fn(),
    colorMode: "light",
    toggleColorMode: vi.fn(),
    activeExperience: {
      customer: null,
      agent: { name: "Aurora", tone: "consultative", language: "pt-BR", greeting: "" },
      brand: { merchant_id: "mrc_test", name: "Loja Teste", subtitle: "", support_label: "", theme: {} as any },
      items: [],
      totals: { currency: "BRL", subtotal: 0, shipping: 0, discount: 0, total: 0 },
      copy: { headline: "", subheadline: "", trust_badges: [], quick_replies: [] }
    },
    buyerHub: buildBuyerHub(),
    auth: {
      session: null,
      open: false,
      panel: "auth",
      error: null,
      logout: vi.fn()
    },
    ...overrides
  } as unknown as CheckoutAgentViewModel;
}

describe("UserPanel", () => {
  it("renders nothing when userPanelOpen=false", () => {
    const { container } = render(
      <UserPanel vm={buildVm({ userPanelOpen: false })} />
    );
    expect(container.querySelector(".aacp-user-panel")).toBeNull();
  });

  it("renders panel with class aacp-user-panel when open", () => {
    const { container } = render(<UserPanel vm={buildVm()} />);
    expect(container.querySelector(".aacp-user-panel")).not.toBeNull();
  });

  it("shows profile email from hub.profile when available", () => {
    const vm = buildVm({
      buyerHub: buildBuyerHub({
        profile: {
          global_user_id: "guser_001",
          display_name: "João Silva",
          email: "joao@test.com"
        }
      })
    });
    const { container } = render(<UserPanel vm={vm} />);
    expect(container.textContent).toContain("joao@test.com");
  });

  it("shows email from auth.session in email input when hub has no profile", () => {
    const vm = buildVm({
      auth: {
        session: {
          email: "session@test.com",
          access_token: "tok",
          token_type: "Bearer",
          expires_in: 3600,
          provider: "phone"
        },
        open: false,
        panel: "auth",
        error: null,
        logout: vi.fn()
      } as any
    });
    const { container } = render(<UserPanel vm={vm} />);
    const emailInput = container.querySelector('input[aria-label="E-mail"]') as HTMLInputElement;
    expect(emailInput?.value).toBe("session@test.com");
  });

  it("shows display_name initial as avatar letter", () => {
    const vm = buildVm({
      buyerHub: buildBuyerHub({
        profile: {
          global_user_id: "g1",
          display_name: "Maria",
          email: "m@test.com"
        }
      })
    });
    const { container } = render(<UserPanel vm={vm} />);
    expect(container.querySelector(".aacp-side-avatar")?.textContent).toBe("M");
  });

  it("shows 'C' avatar fallback when no display_name", () => {
    const { container } = render(<UserPanel vm={buildVm()} />);
    expect(container.querySelector(".aacp-side-avatar")?.textContent).toBe("C");
  });

  it("renders profile tab by default", () => {
    const { getByText } = render(<UserPanel vm={buildVm({ userTab: "profile" })} />);
    expect(getByText("Dados pessoais")).not.toBeNull();
  });

  it("shows tracking code in orders tab when available", () => {
    const vm = buildVm({
      userTab: "orders",
      buyerHub: buildBuyerHub({
        purchases: [
          {
            id: "purchase_1",
            order_id: "order_1",
            merchant_name: "Loja Teste",
            tracking_code: "BR123456789AA",
            tracking_status: "in_transit",
            carrier: "correios",
            tracking_events: [
              {
                status: "in_transit",
                description: "Objeto em transferencia",
                location: "Sao Paulo, SP",
                occurred_at: "2026-05-21T09:30:00.000Z"
              }
            ],
            total: 199.9,
            discount_amount: 0,
            items_count: 1,
            currency: "BRL",
            created_at: "2026-05-20T12:00:00.000Z"
          }
        ]
      })
    });
    const { getByText } = render(<UserPanel vm={vm} />);
    expect(getByText("BR123456789AA")).not.toBeNull();
    expect(getByText("Em transporte")).not.toBeNull();
    expect(getByText("correios")).not.toBeNull();
    expect(getByText("Em transporte - Objeto em transferencia")).not.toBeNull();
    expect(getByText("21/05/2026 - Sao Paulo, SP")).not.toBeNull();
    expect(getByText("Pedido order_1")).not.toBeNull();
  });

  it("shows pending tracking state when order has no tracking code yet", () => {
    const vm = buildVm({
      userTab: "orders",
      buyerHub: buildBuyerHub({
        purchases: [
          {
            id: "purchase_1",
            order_id: "order_1",
            merchant_name: "Loja Teste",
            tracking_code: null,
            total: 199.9,
            discount_amount: 0,
            items_count: 1,
            currency: "BRL",
            created_at: "2026-05-20T12:00:00.000Z"
          }
        ]
      })
    });
    const { getByText } = render(<UserPanel vm={vm} />);
    expect(getByText("Aguardando codigo de rastreio")).not.toBeNull();
  });

  it("filters orders by tracking code", () => {
    const vm = buildVm({
      userTab: "orders",
      buyerHub: buildBuyerHub({
        purchases: [
          {
            id: "purchase_1",
            order_id: "order_1",
            merchant_name: "Loja A",
            tracking_code: "BR123456789AA",
            total: 199.9,
            discount_amount: 0,
            items_count: 1,
            currency: "BRL",
            created_at: "2026-05-20T12:00:00.000Z"
          },
          {
            id: "purchase_2",
            order_id: "order_2",
            merchant_name: "Loja B",
            tracking_code: "ZX987654321BR",
            total: 99.9,
            discount_amount: 0,
            items_count: 1,
            currency: "BRL",
            created_at: "2026-05-20T12:00:00.000Z"
          }
        ]
      })
    });
    const { getByLabelText, queryByText } = render(<UserPanel vm={vm} />);
    fireEvent.change(getByLabelText("Buscar pedido ou rastreio"), {
      target: { value: "ZX987" }
    });
    expect(queryByText("Loja A")).toBeNull();
    expect(queryByText("Loja B")).not.toBeNull();
  });

  it("shows loading spinner when hub is loading and no profile", () => {
    const vm = buildVm({ buyerHub: buildBuyerHub({ loading: true, profile: null }) });
    const { container } = render(<UserPanel vm={vm} />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows hub error message when error present and no profile", () => {
    const vm = buildVm({
      buyerHub: buildBuyerHub({ error: "Falha ao carregar dados.", profile: null })
    });
    const { getByText } = render(<UserPanel vm={vm} />);
    expect(getByText("Falha ao carregar dados.")).not.toBeNull();
  });

  it("calls setUserPanelOpen(false) when backdrop clicked", () => {
    const setUserPanelOpen = vi.fn();
    const { container } = render(
      <UserPanel vm={buildVm({ setUserPanelOpen })} />
    );
    const backdrop = container.querySelector(".aacp-side-backdrop") as HTMLElement;
    backdrop.click();
    expect(setUserPanelOpen).toHaveBeenCalledWith(false);
  });
});
