import { useEffect, useMemo, useState } from "react";
import type { Cart, CustomerHints, MerchantTheme, ShippingQuote } from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { useGlobalAuth } from "./use-global-auth.js";
import { useAccountHub } from "./use-account-hub.js";
import { injectGoogleFont, stageNarrative } from "./checkout-view-model.js";
import { useCheckoutPanels } from "./use-checkout-panels.js";
import { useCheckoutSession } from "./use-checkout-session.js";
import { useCheckoutCart } from "./use-checkout-cart.js";
import { useCheckoutChat } from "./use-checkout-chat.js";
import { useCheckoutPayment } from "./use-checkout-payment.js";

export function useCheckoutAgentViewModel(config: WidgetConfig) {
  const isConversational = config.uiPresentation === "conversational";
  const [open, setOpen] = useState(isConversational);
  const sessionState = useCheckoutSession(config);
  const cartState = useCheckoutCart(sessionState.experience, config);
  const panels = useCheckoutPanels();
  const chatState = useCheckoutChat(config, sessionState);
  const payment = useCheckoutPayment(config, sessionState, chatState);
  const { activeExperience, session, networkError, track } = sessionState;
  const { visibleItems, visibleTotals, cartItemCount, handleRemoveCartItem } = cartState;
  const { checkoutStage, composerLocked, streamingTurnKey } = chatState;
  const theme: MerchantTheme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
  const offer = chatState.lastChat?.authorized_offer;
  const stageNote = stageNarrative(checkoutStage, chatState.lastChat?.missing_fields?.[0]);
  const showComposer = isConversational && Boolean(session) && !networkError && checkoutStage !== "completed";
  const showCouponBox =
    checkoutStage === "payment" &&
    activeExperience.rules?.couponBoxEnabled !== false &&
    visibleTotals.discount === 0;
  const showOfferBanner = visibleTotals.discount > 0;
  const chatTrustBadges = activeExperience.copy.trust_badges.slice(0, 3);

  const auth = useGlobalAuth({
    apiBaseUrl: sessionState.apiOrigin,
    defaultMerchantName: activeExperience.brand.name,
    defaultEmail: config.customer?.email
  });
  const hub = useAccountHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: auth.session,
    enabled: auth.open && auth.panel === "hub" && Boolean(auth.session)
  });

  useEffect(() => {
    injectGoogleFont(theme.fontFamily);
  }, [theme.fontFamily]);

  useEffect(() => {
    if (sessionState.startedEvent?.response.initial_mode === "open") setOpen(true);
  }, [sessionState.startedEvent]);

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ event: Parameters<typeof track>[0] }>;
      if (custom.detail?.event) void track(custom.detail.event);
    };
    window.addEventListener("aacp:checkout-event", listener);
    return () => { window.removeEventListener("aacp:checkout-event", listener); };
  }, [track]);

  const shippingOptions: ShippingQuote[] = useMemo(
    () => activeExperience.shippingOptions ?? [],
    [activeExperience.shippingOptions]
  );

  async function tapShippingOption(option: ShippingQuote): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    await chatState.sendMessageWithOverride(option.method || "Selecionar frete");
  }

  function retryStartCheckout(): void {
    chatState.retryChat();
  }

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
    cartItemCount,
    streamingTurnKey,
    handleAgentTypingDone: chatState.handleAgentTypingDone,
    coupon: chatState.coupon,
    setCoupon: chatState.setCoupon,
    threadRef: chatState.threadRef,
    composerInputRef: chatState.composerInputRef,
    theme,
    offer,
    checkoutStage,
    stageNote,
    showComposer,
    composerLocked,
    showCouponBox,
    showOfferBanner,
    chatTrustBadges,
    quickReplies: chatState.quickReplies,
    auth,
    hub,
    tapQuick: chatState.tapQuick,
    sendMessage: chatState.sendMessage,
    applyOffer: chatState.applyOffer,
    continueToPayment: chatState.continueToPayment,
    submitCoupon: chatState.submitCoupon,
    handleRemoveCartItem,
    createEmbedPaymentIntentDemo: payment.createEmbedPaymentIntentDemo,
    createPaymentIntent: payment.createPaymentIntent,
    colorMode: panels.colorMode,
    toggleColorMode: panels.toggleColorMode,
    supportOpen: panels.supportOpen,
    setSupportOpen: panels.setSupportOpen,
    userPanelOpen: panels.userPanelOpen,
    setUserPanelOpen: panels.setUserPanelOpen,
    userTab: panels.userTab,
    setUserTab: panels.setUserTab,
    showCardForm: panels.showCardForm,
    setShowCardForm: panels.setShowCardForm,
    cardError: panels.cardError,
    setCardError: panels.setCardError,
    shippingOptions,
    tapShippingOption
  };
}

export type CheckoutAgentViewModel = ReturnType<typeof useCheckoutAgentViewModel>;
export type { Cart, CustomerHints, ShippingQuote };
