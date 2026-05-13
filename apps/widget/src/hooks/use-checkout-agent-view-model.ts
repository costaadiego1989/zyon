import { useEffect, useMemo, useState } from "react";
import type { Cart, CustomerHints, MerchantTheme, ShippingQuote, SuggestedProduct } from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { useGlobalAuth } from "./use-global-auth.js";
import { useAccountHub } from "./use-account-hub.js";
import { useBuyerHub } from "./use-buyer-hub.js";
import { injectGoogleFont, stageNarrative, type QuickReplyChoice } from "./checkout-view-model.js";
import { useCheckoutPanels } from "./use-checkout-panels.js";
import { useCheckoutSession } from "./use-checkout-session.js";
import { useCheckoutCart } from "./use-checkout-cart.js";
import { useCheckoutChat } from "./use-checkout-chat.js";
import { useCheckoutPayment } from "./use-checkout-payment.js";

export function useCheckoutAgentViewModel(config: WidgetConfig) {
  const isConversational = config.uiPresentation === "conversational";
  const [open, setOpen] = useState(isConversational);
  const [crossSellDismissed, setCrossSellDismissed] = useState(false);
  const [couponInputVisible, setCouponInputVisible] = useState(false);
  const sessionState = useCheckoutSession(config);
  const cartState = useCheckoutCart(sessionState.experience, config);
  const panels = useCheckoutPanels();
  const chatState = useCheckoutChat(config, sessionState);
  const payment = useCheckoutPayment(config, sessionState, chatState);
  const { activeExperience, session, networkError, track, apiOrigin } = sessionState;
  const { visibleItems, visibleTotals, cartItemCount, handleRemoveCartItem, incrementItem, decrementItem, applyShipping, selectedShippingMethod } = cartState;
  const { checkoutStage, composerLocked, streamingTurnKey } = chatState;
  const theme: MerchantTheme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
  const offer = chatState.lastChat?.authorized_offer;
  const stageNote = stageNarrative(checkoutStage, chatState.lastChat?.missing_fields?.[0]);
  const showComposer = isConversational && Boolean(session) && !networkError && checkoutStage !== "completed" && checkoutStage !== "payment";
  const hasOfferCouponCode = Boolean(offer?.approved && offer?.discountCode);
  const showCouponBox =
    checkoutStage === "payment" &&
    activeExperience.rules?.couponBoxEnabled !== false &&
    visibleTotals.discount === 0 &&
    !panels.showCardForm &&
    (couponInputVisible || hasOfferCouponCode);
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

  const isBuyerSession = Boolean(auth.session?.global_user_id);
  const buyerHub = useBuyerHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: isBuyerSession ? auth.session : null,
    enabled: isBuyerSession && panels.userPanelOpen
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
    () => chatState.lastChat?.experience?.shippingOptions ?? activeExperience.shippingOptions ?? [],
    [chatState.lastChat?.experience?.shippingOptions, activeExperience.shippingOptions]
  );

  const suggestedProducts: SuggestedProduct[] = useMemo(
    () => activeExperience.suggestedProducts ?? [],
    [activeExperience.suggestedProducts]
  );

  async function addSuggestedProduct(product: SuggestedProduct): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    await chatState.sendMessageWithOverride(`Quero adicionar: ${product.name}`);
  }

  function dismissCrossSell(): void {
    setCrossSellDismissed(true);
  }

  async function tapShippingOption(option: ShippingQuote): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    applyShipping(option.method ?? "Frete", option.customerPrice);
    await chatState.sendMessageWithOverride(option.method || "Selecionar frete");
  }

  async function tapQuick(reply: QuickReplyChoice): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    if (/cart[aã]o/i.test(reply.label)) {
      panels.setShowCardForm(true);
      chatState.appendAgentTurn(
        "Preencha os dados do seu cartão abaixo. Seus dados são criptografados e transmitidos com segurança via checkout transparente.",
        { stream: true }
      );
      return;
    }
    if (/^(tenho|adicionar|usar|inserir|informar)\b.*\bcupom\b/i.test(reply.label)) {
      setCouponInputVisible(true);
      chatState.appendAgentTurn(
        "Insira o código do seu cupom abaixo para aplicar o desconto.",
        { stream: true }
      );
      return;
    }
    if (/aplicar.*desconto|aceitar.*desconto/i.test(reply.label)) {
      void chatState.applyOffer();
      return;
    }
    if (/^pix$/i.test(reply.label)) {
      await payment.createPaymentIntent("pix");
      return;
    }
    if (/^boleto$/i.test(reply.label)) {
      chatState.appendAgentTurn(
        "No momento, o pagamento via boleto não está disponível para esta compra. Por favor, escolha Cartão de crédito ou PIX.",
        { stream: true }
      );
      return;
    }
    // Send to API for contextual response
    return chatState.tapQuick(reply);
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
    awaitingAgentPlayback: chatState.awaitingAgentPlayback,
    showCouponBox,
    showOfferBanner,
    chatTrustBadges,
    quickReplies: chatState.quickReplies,
    auth,
    hub,
    tapQuick,
    sendMessage: chatState.sendMessage,
    applyOffer: chatState.applyOffer,
    continueToPayment: chatState.continueToPayment,
    submitCoupon: chatState.submitCoupon,
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
    userTab: panels.userTab,
    setUserTab: panels.setUserTab,
    showCardForm: panels.showCardForm,
    setShowCardForm: panels.setShowCardForm,
    cardError: panels.cardError,
    setCardError: panels.setCardError,
    shippingOptions,
    suggestedProducts,
    crossSellDismissed,
    addSuggestedProduct,
    dismissCrossSell,
    tapShippingOption,
    couponInputVisible,
    setCouponInputVisible,
    buyerHub,
    apiOrigin
  };
}

export type CheckoutAgentViewModel = ReturnType<typeof useCheckoutAgentViewModel>;
export type { Cart, CustomerHints, ShippingQuote };
