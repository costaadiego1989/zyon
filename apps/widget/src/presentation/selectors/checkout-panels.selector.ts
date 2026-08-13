import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { formatCurrency } from "../../hooks/checkout-presentation.js";
import type {
  CouponBoxModel,
  NetworkErrorModel,
  OfferBannerModel,
  PendingOfferBannerModel,
} from "../models/checkout-action-panels.model.js";
import type { CreditCardFormModel } from "../models/credit-card-form.model.js";
import type { CheckoutPanelsModel } from "../models/checkout-panels.model.js";
import { selectCryptoPaymentPanelModel } from "./crypto-payment-panel.selector.js";

// Memoization cache for selectCheckoutPanels. Keyed by vm reference (WeakMap)
// so it cannot leak across consumers, then by a stable string key for the
// options shape. Returned references stay stable when neither vm nor the
// variant/hasPendingTurn inputs change, letting downstream React.memo
// components skip re-render.
const panelsCache = new WeakMap<
  CheckoutAgentViewModel,
  Map<string, CheckoutPanelsModel>
>();

function getCachedPanels(
  vm: CheckoutAgentViewModel,
  optionsKey: string,
  build: () => CheckoutPanelsModel,
): CheckoutPanelsModel {
  let perVm = panelsCache.get(vm);
  if (!perVm) {
    perVm = new Map();
    panelsCache.set(vm, perVm);
  }
  const existing = perVm.get(optionsKey);
  if (existing) return existing;
  const built = build();
  perVm.set(optionsKey, built);
  return built;
}

export function shouldShowShippingSelector(vm: CheckoutAgentViewModel): boolean {
  return (
    !vm.selectedShippingMethod &&
    !vm.activeExperience.shipping &&
    vm.shippingOptions.length > 0 &&
    vm.lastChat?.missing_fields?.[0] === "frete"
  );
}

export function shouldShowCardForm(vm: CheckoutAgentViewModel): boolean {
  return vm.showCardForm && vm.checkoutStage !== "completed";
}

export function shouldShowCryptoPanel(vm: CheckoutAgentViewModel): boolean {
  return Boolean(vm.showCryptoPanel && vm.cryptoPayment && vm.checkoutStage !== "completed");
}

export function shouldShowThreadQuickReplies(vm: CheckoutAgentViewModel): boolean {
  return (
    (vm.showComposer ||
      (vm.checkoutStage === "payment" && !vm.showCardForm && !vm.showCryptoPanel)) &&
    !vm.composerLocked &&
    vm.quickReplies.length > 0
  );
}

export function shouldShowVoiceQuickReplies(
  vm: CheckoutAgentViewModel,
  hasPendingTurn: boolean,
): boolean {
  return !hasPendingTurn && !vm.composerLocked && vm.quickReplies.length > 0;
}

export function selectNetworkErrorModel(vm: CheckoutAgentViewModel): NetworkErrorModel | null {
  if (!vm.networkError) return null;
  return {
    message: vm.networkError,
    onRetry: vm.retryStartCheckout,
  };
}

export function selectCouponBoxModel(vm: CheckoutAgentViewModel): CouponBoxModel | null {
  if (!vm.showCouponBox) return null;
  return {
    value: vm.coupon,
    busy: vm.busy,
    onChange: vm.setCoupon,
    onSubmit: () => vm.submitCoupon(),
  };
}

export function selectOfferBannerModel(vm: CheckoutAgentViewModel): OfferBannerModel | null {
  if (!vm.showOfferBanner) return null;

  const hasShipping = vm.visibleTotals.shipping > 0;
  const orderTotal = Math.max(
    0,
    vm.visibleTotals.subtotal + vm.visibleTotals.shipping - vm.visibleTotals.discount,
  );

  return {
    discountLabel: formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency),
    orderTotalLabel: formatCurrency(orderTotal, vm.visibleTotals.currency),
    shippingLabel: hasShipping
      ? formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)
      : null,
    busy: vm.busy,
    onContinue: () => vm.continueToPayment(),
  };
}

export function selectPendingOfferBannerModel(
  vm: CheckoutAgentViewModel,
): PendingOfferBannerModel | null {
  if (!vm.showPendingOffer || !vm.offer?.approved) return null;

  const offer = vm.offer;
  const pct = offer.type === "discount_percent" ? offer.value : 0;
  const savingsLabel =
    pct > 0
      ? `${pct}% de desconto`
      : offer.type === "shipping_free"
        ? "frete grátis"
        : "condição especial";

  return {
    savingsLabel,
    busy: vm.busy,
    onApply: () => vm.applyOffer(),
  };
}

export function selectCreditCardFormModel(vm: CheckoutAgentViewModel): CreditCardFormModel | null {
  if (!shouldShowCardForm(vm)) return null;

  return {
    busy: vm.busy,
    colorMode: vm.colorMode,
    totalLabel: formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency),
    stripeIntent: vm.stripeIntent,
    onInitiate: () => vm.createPaymentIntent("card"),
    onStripePaymentConfirmed: vm.onStripePaymentConfirmed,
    onStripePaymentError: vm.onStripePaymentError,
    onClose: () => vm.setShowCardForm(false),
  };
}

export type CheckoutPanelsOptions = {
  variant: "thread" | "voice";
  hasPendingTurn?: boolean;
};

export function selectCheckoutPanels(
  vm: CheckoutAgentViewModel,
  options: CheckoutPanelsOptions,
): CheckoutPanelsModel {
  const { variant, hasPendingTurn = false } = options;
  const optionsKey = `${variant}|${hasPendingTurn ? 1 : 0}`;

  return getCachedPanels(vm, optionsKey, () => {
    const quickRepliesVisible =
      variant === "voice"
        ? shouldShowVoiceQuickReplies(vm, hasPendingTurn)
        : shouldShowThreadQuickReplies(vm);

    return buildCheckoutPanels(vm, variant, quickRepliesVisible);
  });
}

function buildCheckoutPanels(
  vm: CheckoutAgentViewModel,
  variant: "thread" | "voice",
  quickRepliesVisible: boolean,
): CheckoutPanelsModel {
  return {
    networkError: selectNetworkErrorModel(vm),
    offerBanner: selectOfferBannerModel(vm),
    pendingOffer: selectPendingOfferBannerModel(vm),
    couponBox: selectCouponBoxModel(vm),
    shipping: shouldShowShippingSelector(vm)
      ? {
          options: vm.shippingOptions,
          selectedMethod: vm.selectedShippingMethod,
          busy: vm.busy,
          onSelect: (option) => vm.tapShippingOption(option),
        }
      : null,
    catalogResults:
      variant === "thread" && vm.isCartEmpty && vm.catalogResults.length > 0
        ? {
            products: vm.catalogResults,
            currency: vm.visibleTotals.currency,
            onAdd: vm.addCatalogProduct,
          }
        : null,
    crossSell:
      variant === "thread" &&
      vm.suggestedProducts &&
      vm.suggestedProducts.length > 0 &&
      !vm.crossSellDismissed &&
      vm.suggestedProducts.some((p) => p.name && p.unit_price > 0 && p.sku)
        ? {
            products: vm.suggestedProducts.filter((p) => p.name && p.unit_price > 0 && p.sku),
            currency: vm.visibleTotals.currency,
            onAdd: (product) => vm.addSuggestedProduct(product),
            onDismiss: vm.dismissCrossSell,
            onProceedToPayment: vm.proceedFromCrossSell,
          }
        : null,
    creditCardForm: selectCreditCardFormModel(vm),
    cryptoPanel: shouldShowCryptoPanel(vm) ? selectCryptoPaymentPanelModel(vm) : null,
    quickReplies: quickRepliesVisible
      ? {
          items: vm.quickReplies,
          onTap: (reply) => vm.tapQuick(reply),
          variant,
          disabled: vm.busy,
        }
      : null,
  };
}
