import { describe, expect, it } from "vitest";
import {
  selectCheckoutPanels,
  shouldShowShippingSelector,
  shouldShowThreadQuickReplies,
} from "../presentation/selectors/checkout-panels.selector.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    checkoutStage: "shipping",
    selectedShippingMethod: undefined,
    activeExperience: { shipping: null },
    shippingOptions: [{ method: "PAC", customerPrice: 12 }],
    lastChat: { missing_fields: ["frete"] },
    showOfferBanner: false,
    showPendingOffer: false,
    showCouponBox: false,
    showCardForm: false,
    showCryptoPanel: false,
    cryptoPayment: null,
    isCartEmpty: false,
    catalogResults: [],
    suggestedProducts: [],
    crossSellDismissed: false,
    quickReplies: [{ label: "PAC" }],
    showComposer: false,
    composerLocked: false,
    busy: false,
    visibleTotals: { total: 100, currency: "BRL", subtotal: 100, shipping: 0, discount: 0 },
    ...overrides,
  } as CheckoutAgentViewModel;
}

describe("checkout-panels.selector", () => {
  it("shows shipping selector only when frete is missing", () => {
    expect(shouldShowShippingSelector(buildVm())).toBe(true);
    expect(shouldShowShippingSelector(buildVm({ checkoutStage: "payment" }))).toBe(false);
  });

  it("selects shipping panel for thread variant", () => {
    const panels = selectCheckoutPanels(buildVm(), { variant: "thread" });
    expect(panels.shipping).not.toBeNull();
    expect(panels.shipping?.options).toHaveLength(1);
  });

  it("hides catalog and cross-sell on voice variant", () => {
    const panels = selectCheckoutPanels(
      buildVm({
        isCartEmpty: true,
        catalogResults: [{ name: "Produto", sku: "sku-1", unit_price: 10 }],
        suggestedProducts: [{ name: "Extra", sku: "sku-2", unit_price: 20 }],
      }),
      { variant: "voice" },
    );

    expect(panels.catalogResults).toBeNull();
    expect(panels.crossSell).toBeNull();
  });

  it("shows thread quick replies during payment without card/crypto panels", () => {
    expect(
      shouldShowThreadQuickReplies(
        buildVm({
          checkoutStage: "payment",
          showComposer: false,
          quickReplies: [{ label: "PIX" }],
        }),
      ),
    ).toBe(true);
  });
});
