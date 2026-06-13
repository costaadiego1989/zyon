import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { BuyerGuestModal } from "../components/checkout/BuyerGuestModal.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    buyerGuestModalOpen: true,
    setBuyerGuestModalOpen: vi.fn(),
    activeExperience: {
      customer: null,
      agent: { name: "Aurora", tone: "consultative", language: "pt-BR", greeting: "" },
      brand: { merchant_id: "mrc_test", name: "Loja Teste", subtitle: "", support_label: "", theme: {} as any },
      items: [],
      totals: { currency: "BRL", subtotal: 0, shipping: 0, discount: 0, total: 0 },
      copy: { headline: "", subheadline: "", trust_badges: [], quick_replies: [] }
    },
    auth: {
      openLogin: vi.fn()
    },
    ...overrides
  } as unknown as CheckoutAgentViewModel;
}

describe("BuyerGuestModal", () => {
  it("renders nothing when modal is closed", () => {
    const { container } = render(<BuyerGuestModal vm={buildVm({ buyerGuestModalOpen: false })} />);
    expect(container.textContent).toBe("");
  });

  it("shows guest empty state with verified checkout email", () => {
    const vm = buildVm({
      activeExperience: {
        ...buildVm().activeExperience,
        customer: {
          fullName: "Diego Costa",
          email: "costaadiego1989@gmail.com",
          email_verified: true
        }
      }
    });
    const { getByText } = render(<BuyerGuestModal vm={vm} />);
    expect(getByText("Entre para acessar sua conta")).not.toBeNull();
    expect(getByText(/costaadiego1989@gmail.com/)).not.toBeNull();
    expect(getByText(/foi confirmado neste pedido/)).not.toBeNull();
  });

  it("opens login and closes modal when Entrar is clicked", () => {
    const setBuyerGuestModalOpen = vi.fn();
    const openLogin = vi.fn();
    const vm = buildVm({
      setBuyerGuestModalOpen,
      auth: { openLogin } as any
    });
    const { getByText } = render(<BuyerGuestModal vm={vm} />);
    fireEvent.click(getByText("Entrar"));
    expect(setBuyerGuestModalOpen).toHaveBeenCalledWith(false);
    expect(openLogin).toHaveBeenCalledOnce();
  });
});
