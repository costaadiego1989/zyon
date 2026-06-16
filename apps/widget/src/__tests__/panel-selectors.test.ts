import { describe, expect, it, vi } from "vitest";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import {
  selectCartFabModel,
  selectCartOverlayModel,
  selectCartPanelModel,
} from "../presentation/selectors/cart-panel.selector.js";
import { selectFloatingCheckoutModel } from "../presentation/selectors/floating-checkout.selector.js";
import { selectOrderConfirmationModel } from "../presentation/selectors/order-confirmation.selector.js";
import { selectSupportPanelModel } from "../presentation/selectors/support-panel.selector.js";
import { selectSupportFabModel } from "../presentation/selectors/support-fab.selector.js";

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    cartOpen: false,
    supportOpen: true,
    open: true,
    isConversational: true,
    busy: false,
    networkError: null,
    message: "oi",
    colorMode: "light",
    theme: {},
    themeStudio: { open: false },
    config: {
      merchantId: "merchant-1",
      successRedirectUrl: "https://loja.example",
      successRedirectLabel: "Ir para loja",
    },
    session: { session_id: "sess-abc123def456", global_user_id: "buyer-global-99" },
    activeExperience: {
      brand: { name: "Loja Teste" },
      agent: { name: "Ana" },
      shipping: null,
    },
    visibleItems: [
      {
        sku: "sku-1",
        name: "Camiseta",
        quantity: 2,
        line_total: 120,
        unit_price: 60,
      },
    ],
    visibleTotals: {
      currency: "BRL",
      subtotal: 120,
      shipping: 15,
      discount: 10,
      total: 125,
      service_fee: 0,
    },
    checkoutStage: "payment",
    selectedShippingMethod: "PAC",
    turns: [{ role: "agent", text: "Olá", occurredAt: "2026-01-01T00:00:00.000Z" }],
    setCartOpen: vi.fn(),
    setSupportOpen: vi.fn(),
    setOpen: vi.fn(),
    setMessage: vi.fn(),
    sendMessage: vi.fn(),
    incrementItem: vi.fn(),
    decrementItem: vi.fn(),
    handleRemoveCartItem: vi.fn(),
    ...overrides,
  } as CheckoutAgentViewModel;
}

describe("panel selectors", () => {
  it("selectCartPanelModel maps items and totals", () => {
    const model = selectCartPanelModel(buildVm({ cartOpen: true }));
    expect(model.open).toBe(true);
    expect(model.items).toHaveLength(1);
    expect(model.items[0]?.name).toBe("Camiseta");
    expect(model.totals.discountLabel).toContain("10");
    expect(model.header.merchantName).toBe("Loja Teste");
  });

  it("selectCartFabModel hides when cart is open", () => {
    expect(selectCartFabModel(buildVm({ cartOpen: true })).visible).toBe(false);
    expect(selectCartFabModel(buildVm({ cartOpen: false })).visible).toBe(true);
  });

  it("selectCartOverlayModel wires close handler", () => {
    const setCartOpen = vi.fn();
    const model = selectCartOverlayModel(buildVm({ cartOpen: true, setCartOpen }));
    model.onClose();
    expect(setCartOpen).toHaveBeenCalledWith(false);
  });

  it("selectSupportPanelModel exposes session and brand", () => {
    const model = selectSupportPanelModel(buildVm());
    expect(model.open).toBe(true);
    expect(model.merchantId).toBe("merchant-1");
    expect(model.sessionId).toBe("sess-abc123def456");
    expect(model.brandName).toBe("Loja Teste");
  });

  it("selectFloatingCheckoutModel maps composer state", () => {
    const model = selectFloatingCheckoutModel(buildVm({ busy: true }));
    expect(model.open).toBe(true);
    expect(model.turns).toHaveLength(1);
    expect(model.composerDisabled).toBe(true);
    expect(model.sessionLabel).toContain("buyer-global");
  });

  it("selectOrderConfirmationModel builds summary lines and redirect", () => {
    const model = selectOrderConfirmationModel(buildVm({ checkoutStage: "completed" }));
    expect(model.sessionRef).toBe("DEF456");
    expect(model.lines.some((line) => line.key === "sku-1")).toBe(true);
    expect(model.lines.some((line) => line.variant === "total")).toBe(true);
    expect(model.redirectUrl).toBe("https://loja.example");
    expect(model.redirectLabel).toBe("Ir para loja");
  });

  it("selectSupportFabModel toggles support panel", () => {
    const setSupportOpen = vi.fn();
    const model = selectSupportFabModel(buildVm({ supportOpen: false, setSupportOpen }));
    model.onToggle();
    expect(setSupportOpen).toHaveBeenCalledWith(true);
  });
});
