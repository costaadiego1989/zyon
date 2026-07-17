import { useEffect, useMemo, useState } from "react";
import type { Cart, CustomerHints, ShippingQuote, SuggestedProduct } from "@zyon/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { isBuyerHubEligible, type VisibleCartState } from "./checkout-presentation.js";
import { useCheckoutCart } from "./use-checkout-cart.js";
import { useCheckoutPayment } from "./use-checkout-payment.js";
import { useCheckoutPrePayment } from "./use-checkout-pre-payment.js";
import { useOrderCompletion } from "./use-order-completion.js";
import { useCheckoutSessionVM } from "./use-checkout-session-vm.js";
import { useCheckoutChatVM } from "./use-checkout-chat-vm.js";
import { useCheckoutUIVM } from "./use-checkout-ui-vm.js";

export function useCheckoutAgentViewModel(config: WidgetConfig) {
  const isConversational = config.uiPresentation === "conversational";
  const [open, setOpen] = useState(isConversational);

  // --- session sub-VM (session, auth, theme, hub, tracking) ---------------
  const sessionVM = useCheckoutSessionVM(config);
  const {
    sessionState,
    panels,
    activeExperience,
    session,
    networkError,
    apiOrigin,
    auth,
    hub,
    buyerHub,
    isBuyerSession,
    theme,
    themeStudio,
  } = sessionVM;

  // --- cart ---------------------------------------------------------------
  const cartState = useCheckoutCart(sessionState.experience, config, sessionState.updateCart);
  const {
    visibleItems,
    visibleTotals,
    cartItemCount,
    handleRemoveCartItem,
    incrementItem,
    decrementItem,
    applyShipping,
    selectedShippingMethod,
  } = cartState;

  // --- suggested products -------------------------------------------------
  const suggestedProducts: SuggestedProduct[] = useMemo(
    () => activeExperience.suggestedProducts ?? [],
    [activeExperience.suggestedProducts],
  );

  const couponBoxEnabled = activeExperience.rules?.couponBoxEnabled !== false;

  // --- pre-payment --------------------------------------------------------
  // Note: we need chatState for appendAgentTurn, so we construct a minimal
  // prePayment first (it only needs appendAgentTurn from chat which we
  // forward from the chatVM below).
  const prePayment = useCheckoutPrePayment({
    checkoutStage: "collecting_info", // placeholder — will be overridden below
    sessionId: session?.session_id,
    visibleTotals,
    showCardForm: panels.showCardForm,
    showCryptoPanel: panels.showCryptoPanel,
    couponBoxEnabled,
    suggestedProducts,
    appendAgentTurn: () => {},  // temporary
  });

  // --- chat sub-VM (chat turns, replies, stage, actions) -------------------
  const chatVM = useCheckoutChatVM({
    config,
    sessionState,
    panels,
    prePayment,
  });

  const { chatState, checkoutStage, offer, shippingOptions } = chatVM;

  // Re-create prePayment with the real checkoutStage and appendAgentTurn now
  // that we have chatState wired. We rely on useCheckoutPrePayment being
  // idempotent with respect to its inputs.
  const prePaymentReal = useCheckoutPrePayment({
    checkoutStage,
    sessionId: session?.session_id,
    visibleTotals,
    showCardForm: panels.showCardForm,
    showCryptoPanel: panels.showCryptoPanel,
    couponBoxEnabled,
    suggestedProducts,
    appendAgentTurn: chatState.appendAgentTurn,
  });

  // --- payment -------------------------------------------------------------
  const payment = useCheckoutPayment(config, sessionState, chatState);

  // --- UI sub-VM (flags, quick replies, panels) ----------------------------
  const uiVM = useCheckoutUIVM({
    config,
    sessionState,
    panels,
    prePayment: prePaymentReal,
    payment,
    chatVM,
    auth,
    isBuyerSession,
    suggestedProducts,
    applyShipping,
  });

  // --- order completion ----------------------------------------------------
  const { completedOrderSnapshot } = useOrderCompletion({
    checkoutStage,
    sessionId: session?.session_id,
    merchantId: config.merchantId,
    storeUrl: config.storeUrl,
    activeExperience,
    currency: activeExperience.totals.currency ?? config.cart.currency ?? "BRL",
    visibleItems: cartState.visibleItems,
    visibleTotals: cartState.visibleTotals,
    isBuyerSession,
    syncExperience: sessionState.syncExperience,
    resetCart: cartState.resetCart,
    resetChat: chatState.resetAfterCompletion,
    resetPanels: panels.resetPanels,
    resetPrePayment: prePaymentReal.resetAfterCompletion,
    clearPersistedSession: sessionState.clearPersistedSession,
    loginFromCheckout: auth.loginFromCheckoutSession,
    refreshBuyerHub: buyerHub.refresh,
    authSession: auth.session,
  });

  // --- side effects --------------------------------------------------------

  useEffect(() => {
    if (sessionState.startedEvent?.response.initial_mode === "open") setOpen(true);
  }, [sessionState.startedEvent]);

  useEffect(() => {
    if (
      checkoutStage === "completed" &&
      session &&
      !auth.session &&
      isBuyerHubEligible(activeExperience.customer)
    ) {
      void auth.loginFromCheckoutSession(session.session_id, config.merchantId);
    }
  }, [checkoutStage, session, auth.session, auth, config.merchantId, activeExperience.customer]);

  // --- public API (unchanged surface) -------------------------------------

  return {
    config,
    isConversational,
    session,
    open,
    setOpen,
    turns: chatState.turns,
    message: chatState.message,
    setMessage: chatState.setMessage,
    lastChat: chatState.lastChat,
    busy: chatState.busy,
    activeExperience,
    networkError,
    retryStartCheckout: chatVM.retryStartCheckout,
    cartOpen: panels.cartOpen,
    setCartOpen: panels.setCartOpen,
    visibleItems,
    visibleTotals,
    completedOrderSnapshot,
    cartItemCount,
    streamingTurnKey: chatVM.streamingTurnKey,
    handleAgentTypingDone: chatState.handleAgentTypingDone,
    coupon: chatState.coupon,
    setCoupon: chatState.setCoupon,
    threadRef: chatState.threadRef,
    composerInputRef: chatState.composerInputRef,
    theme,
    themeStudio,
    offer,
    checkoutStage,
    stageNote: chatVM.stageNote,
    showComposer: uiVM.showComposer,
    composerLocked: chatVM.composerLocked,
    awaitingAgentPlayback: chatVM.awaitingAgentPlayback,
    showCouponBox: prePaymentReal.showCouponBox,
    showOfferBanner: prePaymentReal.showOfferBanner,
    showPendingOffer: uiVM.showPendingOffer,
    chatTrustBadges: uiVM.chatTrustBadges,
    quickReplies: uiVM.quickReplies,
    isCartEmpty: chatState.isCartEmpty,
    catalogResults: chatState.catalogResults,
    addCatalogProduct: chatState.addCatalogProduct,
    auth,
    hub,
    tapQuick: uiVM.tapQuick,
    sendMessage: chatState.sendMessage,
    sendMessageWithOverride: chatState.sendMessageWithOverride,
    applyOffer: chatState.applyOffer,
    continueToPayment: chatState.continueToPayment,
    submitCoupon: chatVM.submitCoupon,
    handleRemoveCartItem,
    incrementItem,
    decrementItem,
    selectedShippingMethod,
    createEmbedPaymentIntentDemo: payment.createEmbedPaymentIntentDemo,
    createPaymentIntent: payment.createPaymentIntent,
    stripeIntent: payment.stripeIntent,
    pixWaiting: payment.pixWaiting,
    dismissPixWaiting: payment.dismissPixWaiting,
    onStripePaymentConfirmed: payment.onStripePaymentConfirmed,
    onStripePaymentError: payment.onStripePaymentError,
    colorMode: panels.colorMode,
    toggleColorMode: panels.toggleColorMode,
    supportOpen: panels.supportOpen,
    setSupportOpen: panels.setSupportOpen,
    userPanelOpen: panels.userPanelOpen,
    setUserPanelOpen: panels.setUserPanelOpen,
    buyerGuestModalOpen: panels.buyerGuestModalOpen,
    setBuyerGuestModalOpen: panels.setBuyerGuestModalOpen,
    userTab: panels.userTab,
    setUserTab: panels.setUserTab,
    showCardForm: panels.showCardForm,
    setShowCardForm: panels.setShowCardForm,
    showCryptoPanel: panels.showCryptoPanel,
    setShowCryptoPanel: panels.setShowCryptoPanel,
    cryptoPayment: payment.cryptoPayment,
    confirmCryptoPayment: payment.confirmCryptoPayment,
    cardError: panels.cardError,
    setCardError: panels.setCardError,
    shippingOptions,
    suggestedProducts:
      prePaymentReal.prePaymentStep === "cross_sell" ? suggestedProducts : [],
    crossSellDismissed: prePaymentReal.crossSellDismissed,
    addSuggestedProduct: chatVM.addSuggestedProduct,
    dismissCrossSell: prePaymentReal.dismissCrossSell,
    proceedFromCrossSell: chatVM.proceedFromCrossSell,
    openBuyerPanel: uiVM.openBuyerPanel,
    tapShippingOption: uiVM.tapShippingOption,
    couponInputVisible: prePaymentReal.couponInputVisible,
    setCouponInputVisible: prePaymentReal.setCouponInputVisible,
    buyerHub,
    apiOrigin,
    purchaseChannel: panels.purchaseChannel,
    selectPurchaseChannel: uiVM.selectPurchaseChannel,
    showChannelWelcome: uiVM.showChannelWelcome,
  };
}

export type CheckoutAgentViewModel = ReturnType<typeof useCheckoutAgentViewModel>;
export type { Cart, CustomerHints, ShippingQuote, VisibleCartState };
