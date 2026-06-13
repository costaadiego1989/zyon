import { describe, expect, it, vi } from "vitest";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import {
  selectExperienceHeader,
  selectJourneyProtocol,
} from "../presentation/checkout-experience-model.js";

function buildVm(
  overrides: Partial<CheckoutAgentViewModel> = {},
): CheckoutAgentViewModel {
  return {
    activeExperience: {
      agent: {
        name: "Zion Protocol",
        tone: "consultative",
        language: "pt-BR",
        greeting: "",
      },
      brand: {
        merchant_id: "mrc_demo",
        name: "Athom Tech",
        subtitle: "",
        support_label: "",
        theme: {} as never,
      },
      items: [],
      totals: {
        currency: "BRL",
        subtotal: 299.9,
        shipping: 0,
        discount: 0,
        total: 299.9,
      },
      copy: {
        headline: "",
        subheadline: "",
        trust_badges: [],
        quick_replies: [],
      },
      rules: { couponBoxEnabled: true },
    },
    theme: {
      accentColor: "#0F766E",
      textColor: "#10231C",
      backgroundColor: "#F5F4EC",
      fontFamily: "IBM Plex Sans, sans-serif",
    },
    colorMode: "light",
    cartOpen: false,
    supportOpen: false,
    visibleTotals: {
      currency: "BRL",
      subtotal: 299.9,
      shipping: 0,
      discount: 0,
      total: 299.9,
    },
    setCartOpen: vi.fn(),
    setSupportOpen: vi.fn(),
    toggleColorMode: vi.fn(),
    openBuyerPanel: vi.fn(),
    auth: {
      session: null,
      openLogin: vi.fn(),
    },
    ...overrides,
  } as unknown as CheckoutAgentViewModel;
}

describe("checkout experience presentation", () => {
  it("maps domain state into an operational journey model", () => {
    const model = selectJourneyProtocol("shipping");

    expect(model.currentLabel).toBe("Entrega");
    expect(model.currentNumber).toBe("02");
    expect(model.progressPercent).toBe(50);
    expect(model.steps.map((step) => step.status)).toEqual([
      "done",
      "active",
      "pending",
      "pending",
    ]);
  });

  it("keeps merchant and transaction concerns out of the header view", () => {
    const model = selectExperienceHeader(buildVm());

    expect(model.agent.name).toBe("Zion");
    expect(model.agent.role).toBe("Agente de compras");
    expect(model.agent.statusLabel).toContain("Athom Tech");
    expect(model.order.total).toContain("299");
    expect(model.assurance.description).toBe(
      "Voce revisa tudo antes de pagar",
    );
  });

  it("maps recognized buyers to the account continuation action", () => {
    const onOpen = vi.fn();
    const vm = buildVm({ openBuyerPanel: onOpen });
    vm.activeExperience.customer = {
      fullName: "Marina Alves",
      email_verified: true,
    };

    const model = selectExperienceHeader(vm);
    expect(model.account.kind).toBe("recognized");
    expect(model.account.label).toBe("Olá, Marina");

    model.account.onOpen();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
