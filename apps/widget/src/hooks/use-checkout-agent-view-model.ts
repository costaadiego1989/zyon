import { useEffect, useMemo, useRef, useState } from "react";
import type { Cart, CustomerHints, MerchantTheme, ShippingQuote, SuggestedProduct } from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { useGlobalAuth } from "./use-global-auth.js";
import { useAccountHub } from "./use-account-hub.js";
import { useBuyerHub } from "./use-buyer-hub.js";
import {
  injectGoogleFont,
  isBuyerHubEligible,
  stageNarrative,
  type VisibleCartState,
} from "./checkout-presentation.js";
import { useCheckoutPanels } from "./use-checkout-panels.js";
import { useCheckoutSession } from "./use-checkout-session.js";
import { useCheckoutCart } from "./use-checkout-cart.js";
import { useCheckoutChat } from "./use-checkout-chat.js";
import { useCheckoutPayment } from "./use-checkout-payment.js";
import { useThemeStudio } from "./use-theme-studio.js";
import { useCheckoutPrePayment } from "./use-checkout-pre-payment.js";
import { useCheckoutQuickReplies } from "./use-checkout-quick-replies.js";
import { useOrderCompletion } from "./use-order-completion.js";

export function useCheckoutAgentViewModel(config: WidgetConfig) {
  const isConversational = config.uiPresentation === "conversational";
  const [open, setOpen] = useState(isConversational);
  const buyerLoginAttemptedKey = useRef<string | null>(null);

  const sessionState = useCheckoutSession(config);
  const cartState = useCheckoutCart(sessionState.experience, config, sessionState.updateCart);
  const panels = useCheckoutPanels();
  const chatState = useCheckoutChat(config, sessionState, {
    purchaseChannel: panels.purchaseChannel,
  });
  const payment = useCheckoutPayment(config, sessionState, chatState);

  const { activeExperience, session, networkError, track, apiOrigin } = sessionState;
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
  const { checkoutStage, composerLocked, streamingTurnKey, awaitingAgentPlayback } = chatState;
  const offer = chatState.lastChat?.authorized_offer;
  const currentMissingField = chatState.lastChat?.missing_fields?.[0];
  const stageNote = stageNarrative(checkoutStage, currentMissingField);

  const suggestedProducts: SuggestedProduct[] = useMemo(
    () => activeExperience.suggestedProducts ?? [],
    [activeExperience.suggestedProducts],
  );

  const couponBoxEnabled = activeExperience.rules?.couponBoxEnabled !== false;

  const prePayment = useCheckoutPrePayment({
    checkoutStage,
    sessionId: session?.session_id,
    visibleTotals,
    showCardForm: panels.showCardForm,
    showCryptoPanel: panels.showCryptoPanel,
    couponBoxEnabled,
    suggestedProducts,
    appendAgentTurn: chatState.appendAgentTurn,
  });

  const showPendingOffer =
    Boolean(offer?.approved) &&
    visibleTotals.discount === 0 &&
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

  const auth = useGlobalAuth({
    apiBaseUrl: sessionState.apiOrigin,
    merchantId: config.merchantId,
    defaultMerchantName: activeExperience.brand.name,
    defaultEmail: activeExperience.customer?.email ?? config.customer?.email,
  });

  useEffect(() => {
    const sessionId = session?.session_id;
    const customer = activeExperience.customer;
    if (!sessionId || !isBuyerHubEligible(customer) || auth.session) return;

    const loginKey = `${sessionId}:${customer?.email_verified ? "verified" : "pending"}:${customer?.phone_verified ? "phone" : "no-phone"}`;
    if (buyerLoginAttemptedKey.current === loginKey) return;

    buyerLoginAttemptedKey.current = loginKey;
    void auth.loginFromCheckoutSession(sessionId, config.merchantId);
  }, [activeExperience.customer, auth, auth.session, config.merchantId, session?.session_id]);

  const hub = useAccountHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: auth.session,
    enabled: auth.open && auth.panel === "hub" && Boolean(auth.session?.merchant_id),
  });

  const isBuyerSession = Boolean(auth.session?.global_user_id);
  const buyerHub = useBuyerHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: isBuyerSession ? auth.session : null,
    merchantId: config.merchantId,
    enabled: isBuyerSession && panels.userPanelOpen,
    onAuthExpired: () => {
      auth.logout();
      if (session) {
        void auth.refreshBuyerFromCheckoutSession(session.session_id, config.merchantId);
      }
    },
  });

  const baseTheme: MerchantTheme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
  const themeStudio = useThemeStudio({
    merchantId: config.merchantId,
    baseTheme,
    session: auth.session,
    apiBaseUrl: apiOrigin,
  });
  const theme = themeStudio.resolvedTheme;

  useEffect(() => {
    injectGoogleFont(theme.fontFamily);
    if (theme.fontDisplay) injectGoogleFont(theme.fontDisplay);
  }, [theme.fontDisplay, theme.fontFamily]);

  useEffect(() => {
    if (sessionState.startedEvent?.response.initial_mode === "open") setOpen(true);
  }, [sessionState.startedEvent]);

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ event: Parameters<typeof track>[0] }>;
      if (custom.detail?.event) void track(custom.detail.event);
    };
    window.addEventListener("aacp:checkout-event", listener);
    return () => {
      window.removeEventListener("aacp:checkout-event", listener);
    };
  }, [track]);

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

  const shippingOptions: ShippingQuote[] = useMemo(
    () => chatState.lastChat?.experience?.shippingOptions ?? [],
    [chatState.lastChat?.experience?.shippingOptions],
  );

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
    resetPrePayment: prePayment.resetAfterCompletion,
    clearPersistedSession: sessionState.clearPersistedSession,
    loginFromCheckout: auth.loginFromCheckoutSession,
    refreshBuyerHub: buyerHub.refresh,
    authSession: auth.session,
  });

  async function addSuggestedProduct(product: SuggestedProduct): Promise<boolean> {
    if (!session || networkError || chatState.busy) return false;

    let added = false;
    let agentAlreadyReplied = false;

    if (chatState.isCartEmpty && product.sku) {
      added = config.mode === "embed" ? await chatState.addCatalogProduct(product) : false;
      agentAlreadyReplied = added;
    } else if (config.mode === "embed" && product.suggestion_id) {
      added = await chatState.acceptCrossSell(product);
      agentAlreadyReplied = added;
      if (!added && product.sku) {
        added = await chatState.addCatalogProduct(product);
        agentAlreadyReplied = added;
      }
    } else if (config.mode === "embed" && product.sku) {
      added = await chatState.addCatalogProduct(product);
      agentAlreadyReplied = added;
    }

    if (!added) {
      await chatState.sendMessageWithOverride(`Quero adicionar: ${product.name}`);
      added = !sessionState.networkError;
      agentAlreadyReplied = added;
    }

    if (added) {
      prePayment.dismissCrossSell();
      if (!agentAlreadyReplied) {
        chatState.appendAgentTurn(`Perfeito! ${product.name} foi adicionado ao seu pedido.`, {
          stream: true,
        });
      }
    } else {
      sessionState.setNetworkError?.("Falha ao adicionar o produto. Tente novamente em instantes.");
    }
    return added;
  }

  function proceedFromCrossSell(): void {
    prePayment.proceedFromCrossSell((text) =>
      chatState.appendAgentTurn(text, { stream: true }),
    );
  }

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

  async function tapShippingOption(option: ShippingQuote): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    applyShipping(option.method ?? "Frete", option.customerPrice);
    await chatState.sendMessageWithOverride(option.method || "Selecionar frete");
  }

  const { quickReplies, tapQuick } = useCheckoutQuickReplies({
    config,
    checkoutStage,
    currentMissingField,
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
    addSuggestedProduct,
    proceedFromCrossSell,
    setCouponInputVisible: prePayment.setCouponInputVisible,
    setPrePaymentStep: prePayment.setPrePaymentStep,
    appendAgentTurn: chatState.appendAgentTurn,
    applyOffer: chatState.applyOffer,
    setShowCardForm: panels.setShowCardForm,
    setShowCryptoPanel: panels.setShowCryptoPanel,
    createPaymentIntent: payment.createPaymentIntent,
    tapShippingOption,
    tapQuickFromChat: chatState.tapQuick,
  });

  async function submitCoupon(): Promise<void> {
    const applied = await chatState.submitCoupon();
    if (!applied) return;
    prePayment.setCouponInputVisible(false);
    prePayment.setPrePaymentStep("payment_method");
    chatState.appendAgentTurn("Desconto aplicado. Agora escolha PIX, cartao ou crypto para concluir.", {
      stream: true,
    });
  }

  function retryStartCheckout(): void {
    chatState.retryChat();
  }

  function selectPurchaseChannel(channel: "chat" | "voice"): void {
    panels.selectPurchaseChannel(channel);
  }

  const showChannelWelcome = isConversational && panels.purchaseChannel === "pending";

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
    retryStartCheckout,
    cartOpen: panels.cartOpen,
    setCartOpen: panels.setCartOpen,
    visibleItems,
    visibleTotals,
    completedOrderSnapshot,
    cartItemCount,
    streamingTurnKey,
    handleAgentTypingDone: chatState.handleAgentTypingDone,
    coupon: chatState.coupon,
    setCoupon: chatState.setCoupon,
    threadRef: chatState.threadRef,
    composerInputRef: chatState.composerInputRef,
    theme,
    themeStudio,
    offer,
    checkoutStage,
    stageNote,
    showComposer,
    composerLocked,
    awaitingAgentPlayback: chatState.awaitingAgentPlayback,
    showCouponBox: prePayment.showCouponBox,
    showOfferBanner: prePayment.showOfferBanner,
    showPendingOffer,
    chatTrustBadges,
    quickReplies,
    isCartEmpty: chatState.isCartEmpty,
    catalogResults: chatState.catalogResults,
    addCatalogProduct: chatState.addCatalogProduct,
    auth,
    hub,
    tapQuick,
    sendMessage: chatState.sendMessage,
    sendMessageWithOverride: chatState.sendMessageWithOverride,
    applyOffer: chatState.applyOffer,
    continueToPayment: chatState.continueToPayment,
    submitCoupon,
    handleRemoveCartItem,
    incrementItem,
    decrementItem,
    selectedShippingMethod,
    createEmbedPaymentIntentDemo: payment.createEmbedPaymentIntentDemo,
    createPaymentIntent: payment.createPaymentIntent,
    stripeIntent: payment.stripeIntent,
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
      prePayment.prePaymentStep === "cross_sell" ? suggestedProducts : [],
    crossSellDismissed: prePayment.crossSellDismissed,
    addSuggestedProduct,
    dismissCrossSell: prePayment.dismissCrossSell,
    proceedFromCrossSell,
    openBuyerPanel,
    tapShippingOption,
    couponInputVisible: prePayment.couponInputVisible,
    setCouponInputVisible: prePayment.setCouponInputVisible,
    buyerHub,
    apiOrigin,
    purchaseChannel: panels.purchaseChannel,
    selectPurchaseChannel,
    showChannelWelcome,
  };
}

export type CheckoutAgentViewModel = ReturnType<typeof useCheckoutAgentViewModel>;
export type { Cart, CustomerHints, ShippingQuote, VisibleCartState };
