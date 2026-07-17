import { useMemo } from "react";
import type { SuggestedProduct } from "@zyon/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { useCheckoutPanels } from "./use-checkout-panels.js";
import type { useCheckoutPrePayment } from "./use-checkout-pre-payment.js";
import type { CheckoutPaymentState } from "./use-checkout-payment.js";
import type { useCheckoutChatVM } from "./use-checkout-chat-vm.js";
import type { useGlobalAuth } from "./use-global-auth.js";
import { useCheckoutQuickReplies } from "./use-checkout-quick-replies.js";

export type CheckoutUIVMDeps = {
  config: WidgetConfig;
  sessionState: CheckoutSessionState;
  panels: ReturnType<typeof useCheckoutPanels>;
  prePayment: ReturnType<typeof useCheckoutPrePayment>;
  payment: CheckoutPaymentState;
  chatVM: ReturnType<typeof useCheckoutChatVM>;
  auth: ReturnType<typeof useGlobalAuth>;
  isBuyerSession: boolean;
  suggestedProducts: SuggestedProduct[];
  applyShipping: (method: string, price: number) => void;
};

/**
 * UI-layer sub-VM: derives display flags (showComposer, showPendingOffer, etc.),
 * wires quick replies, and encapsulates the openBuyerPanel / selectPurchaseChannel
 * routing logic.
 */
export function useCheckoutUIVM(deps: CheckoutUIVMDeps) {
  const {
    config,
    sessionState,
    panels,
    prePayment,
    payment,
    chatVM,
    auth,
    isBuyerSession,
    suggestedProducts,
    applyShipping,
  } = deps;

  const isConversational = config.uiPresentation === "conversational";
  const { activeExperience, session, networkError } = sessionState;
  const { checkoutStage, awaitingAgentPlayback, offer, shippingOptions, chatState } = chatVM;

  // --- derived display flags ---------------------------------------------

  const showPendingOffer =
    Boolean(offer?.approved) &&
    chatVM.chatState.lastChat?.experience?.totals?.discount === 0 &&
    checkoutStage === "payment" &&
    prePayment.prePaymentStep === "payment_method" &&
    !panels.showCardForm &&
    !panels.showCryptoPanel;

  const showComposer =
    isConversational &&
    panels.purchaseChannel !== "voice" &&
    Boolean(session) &&
    !networkError &&
    checkoutStage !== "completed" &&
    checkoutStage !== "payment" &&
    !awaitingAgentPlayback;

  const chatTrustBadges = activeExperience.copy.trust_badges.slice(0, 3);
  const showChannelWelcome = isConversational && panels.purchaseChannel === "pending";

  // --- quick replies -----------------------------------------------------

  const visibleTotals = useMemo(() => {
    const totals = activeExperience.totals;
    return { ...totals };
  }, [activeExperience.totals]);

  async function tapShippingOptionUI(option: import("@zyon/shared-types").ShippingQuote): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    applyShipping(option.method ?? "Frete", option.customerPrice);
    await chatVM.tapShippingOption(option);
  }

  const { quickReplies, tapQuick } = useCheckoutQuickReplies({
    config,
    checkoutStage,
    currentMissingField: chatVM.currentMissingField,
    prePaymentStep: prePayment.prePaymentStep,
    suggestedProducts,
    cryptoPaymentsEnabled: activeExperience.rules?.cryptoPaymentsEnabled,
    chatQuickReplies: chatState.quickReplies,
    shippingOptions,
    offer,
    visibleTotals,
    session,
    networkError,
    busy: chatState.busy,
    addSuggestedProduct: chatVM.addSuggestedProduct,
    proceedFromCrossSell: chatVM.proceedFromCrossSell,
    setCouponInputVisible: prePayment.setCouponInputVisible,
    setPrePaymentStep: prePayment.setPrePaymentStep,
    appendAgentTurn: chatState.appendAgentTurn,
    applyOffer: chatState.applyOffer,
    setShowCardForm: panels.setShowCardForm,
    setShowCryptoPanel: panels.setShowCryptoPanel,
    createPaymentIntent: payment.createPaymentIntent,
    tapShippingOption: tapShippingOptionUI,
    tapQuickFromChat: chatState.tapQuick,
  });

  // --- buyer panel routing ------------------------------------------------

  function openBuyerPanel(): void {
    if (isBuyerSession) {
      panels.setBuyerGuestModalOpen(false);
      panels.setUserPanelOpen(true);
      return;
    }
    if (auth.session) {
      panels.setBuyerGuestModalOpen(false);
      panels.setUserPanelOpen(false);
      auth.openHub();
      return;
    }
    panels.setUserPanelOpen(false);
    panels.setBuyerGuestModalOpen(false);
    auth.openLogin();
  }

  function selectPurchaseChannel(channel: "chat" | "voice"): void {
    panels.selectPurchaseChannel(channel);
  }

  return {
    showPendingOffer,
    showComposer,
    chatTrustBadges,
    showChannelWelcome,
    quickReplies,
    tapQuick,
    openBuyerPanel,
    selectPurchaseChannel,
    tapShippingOption: tapShippingOptionUI,
  };
}
