import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import {
  brandInitials,
  CART_JOURNEY,
  formatCurrency,
  resolveCartJourneyIndex,
} from "../../hooks/checkout-presentation.js";
import type { CartFabModel, CartHeaderModel, CartOverlayModel, CartPanelModel } from "../models/cart-panel.model.js";

export function selectCartHeaderModel(vm: CheckoutAgentViewModel): CartHeaderModel {
  const experience = vm.activeExperience;
  const itemCount = vm.visibleItems.reduce((sum, item) => sum + item.quantity, 0);
  const journeyIndex = resolveCartJourneyIndex(vm.checkoutStage, itemCount);
  const journeyStep = CART_JOURNEY[journeyIndex] ?? CART_JOURNEY[0];
  const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

  return {
    merchantName: experience.brand.name,
    merchantInitials: brandInitials(experience.brand.name),
    logoUrl: vm.theme.logoUrl,
    orderRef: vm.session?.session_id?.slice(-6).toUpperCase() ?? "3EE8A6",
    journeyLabel: journeyStep.label,
    journeyHint: journeyStep.hint,
    showDevReset: isDev,
    onClose: () => vm.setCartOpen(false),
    onDevReset: () => {
      window.localStorage.removeItem("aacp_session_id");
      window.location.reload();
    },
  };
}

export function selectCartPanelModel(vm: CheckoutAgentViewModel): CartPanelModel {
  const currency = vm.visibleTotals.currency;
  const hasShippingEstimate = Boolean(vm.selectedShippingMethod || vm.activeExperience.shipping);
  const serviceFee = vm.visibleTotals.service_fee ?? 0;
  const showServiceFee = vm.checkoutStage === "payment" && serviceFee > 0;

  return {
    open: vm.cartOpen,
    busy: vm.busy,
    itemCount: vm.visibleItems.reduce((sum, item) => sum + item.quantity, 0),
    items: vm.visibleItems.map((item) => ({
      sku: item.sku,
      name: item.name,
      description: item.description,
      variant: item.variant,
      imageUrl: item.image_url,
      quantity: item.quantity,
      lineTotalLabel: formatCurrency(item.line_total, currency),
      onIncrement: () => vm.incrementItem(item.sku),
      onDecrement: () => vm.decrementItem(item.sku),
      onRemove: () => vm.handleRemoveCartItem(item.sku),
    })),
    totals: {
      subtotalLabel: formatCurrency(vm.visibleTotals.subtotal, currency),
      shippingLabel: hasShippingEstimate
        ? formatCurrency(vm.visibleTotals.shipping, currency)
        : "A calcular",
      discountLabel:
        vm.visibleTotals.discount > 0
          ? formatCurrency(vm.visibleTotals.discount, currency)
          : null,
      serviceFeeLabel: showServiceFee ? formatCurrency(serviceFee, currency) : null,
      totalLabel: formatCurrency(
        vm.visibleTotals.total + (showServiceFee ? serviceFee : 0),
        currency,
      ),
    },
    emptyCartRedirectUrl: vm.config.emptyCartRedirectUrl,
    header: selectCartHeaderModel(vm),
  };
}

export function selectCartFabModel(vm: CheckoutAgentViewModel): CartFabModel {
  return {
    visible: !vm.cartOpen && vm.isConversational,
    totalLabel: formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency),
    itemCount: vm.visibleItems.length,
    onOpen: () => vm.setCartOpen(true),
  };
}

export function selectCartOverlayModel(vm: CheckoutAgentViewModel): CartOverlayModel {
  return {
    open: vm.cartOpen,
    onClose: () => vm.setCartOpen(false),
  };
}
