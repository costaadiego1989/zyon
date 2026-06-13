import { useEffect, useMemo, useRef, useState } from "react";
import type { Cart, CustomerHints, MerchantTheme, ShippingQuote, SuggestedProduct } from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { useGlobalAuth } from "./use-global-auth.js";
import { useAccountHub } from "./use-account-hub.js";
import { useBuyerHub } from "./use-buyer-hub.js";
import { filterCheckoutQuickReplies, injectGoogleFont, stageNarrative, type QuickReplyChoice } from "./checkout-view-model.js";
import { useCheckoutPanels } from "./use-checkout-panels.js";
import { useCheckoutSession } from "./use-checkout-session.js";
import { useCheckoutCart } from "./use-checkout-cart.js";
import { useCheckoutChat } from "./use-checkout-chat.js";
import { useCheckoutPayment } from "./use-checkout-payment.js";
import { useThemeStudio } from "./use-theme-studio.js";

type PrePaymentStep = "cross_sell" | "coupon_gate" | "coupon_entry" | "payment_method";

export function useCheckoutAgentViewModel(config: WidgetConfig) {
  const isConversational = config.uiPresentation === "conversational";
  const [open, setOpen] = useState(isConversational);
  const [crossSellDismissed, setCrossSellDismissed] = useState(false);
  const [couponInputVisible, setCouponInputVisible] = useState(false);
  const [prePaymentStep, setPrePaymentStep] = useState<PrePaymentStep>("cross_sell");
  const couponGatePromptedKey = useRef<string | null>(null);
  const sessionState = useCheckoutSession(config);
  const cartState = useCheckoutCart(sessionState.experience, config);
  const panels = useCheckoutPanels();
  const chatState = useCheckoutChat(config, sessionState);
  const payment = useCheckoutPayment(config, sessionState, chatState);
  const { activeExperience, session, networkError, track, apiOrigin } = sessionState;
  const { visibleItems, visibleTotals, cartItemCount, handleRemoveCartItem, incrementItem, decrementItem, applyShipping, selectedShippingMethod } = cartState;
  const { checkoutStage, composerLocked, streamingTurnKey } = chatState;
  const offer = chatState.lastChat?.authorized_offer;
  const currentMissingField = chatState.lastChat?.missing_fields?.[0];
  const stageNote = stageNarrative(checkoutStage, currentMissingField);
  const showComposer = isConversational && Boolean(session) && !networkError && checkoutStage !== "completed" && checkoutStage !== "payment";
  const suggestedProducts: SuggestedProduct[] = useMemo(
    () => activeExperience.suggestedProducts ?? [],
    [activeExperience.suggestedProducts]
  );
  const couponGateEnabled =
    checkoutStage === "payment" &&
    activeExperience.rules?.couponBoxEnabled !== false &&
    visibleTotals.discount === 0 &&
    !panels.showCardForm;
  const showCouponBox =
    checkoutStage === "payment" &&
    activeExperience.rules?.couponBoxEnabled !== false &&
    visibleTotals.discount === 0 &&
    !panels.showCardForm &&
    (prePaymentStep === "coupon_entry" || couponInputVisible);
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
    enabled: auth.open && auth.panel === "hub" && Boolean(auth.session?.merchant_id)
  });

  const isBuyerSession = Boolean(auth.session?.global_user_id);
  const buyerHub = useBuyerHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: isBuyerSession ? auth.session : null,
    enabled: isBuyerSession && panels.userPanelOpen
  });

  const baseTheme: MerchantTheme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
  const themeStudio = useThemeStudio({
    merchantId: config.merchantId,
    baseTheme,
    session: auth.session,
    apiBaseUrl: apiOrigin
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
    if (checkoutStage !== "payment") {
      setPrePaymentStep("cross_sell");
      setCouponInputVisible(false);
      setCrossSellDismissed(false);
      couponGatePromptedKey.current = null;
      return;
    }

    if (prePaymentStep === "cross_sell" && (crossSellDismissed || suggestedProducts.length === 0)) {
      const nextStep = couponGateEnabled ? "coupon_gate" : "payment_method";
      setPrePaymentStep(nextStep);
      if (nextStep === "coupon_gate") {
        const promptKey = session?.session_id ?? "payment";
        if (couponGatePromptedKey.current !== promptKey) {
          couponGatePromptedKey.current = promptKey;
          chatState.appendAgentTurn("Antes de liberar PIX ou cartao, voce tem algum cupom?", { stream: true });
        }
      }
      return;
    }

    if (prePaymentStep === "coupon_gate" && !couponGateEnabled) {
      setPrePaymentStep("payment_method");
    }
  }, [checkoutStage, couponGateEnabled, crossSellDismissed, prePaymentStep, session?.session_id, suggestedProducts.length]);

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ event: Parameters<typeof track>[0] }>;
      if (custom.detail?.event) void track(custom.detail.event);
    };
    window.addEventListener("aacp:checkout-event", listener);
    return () => { window.removeEventListener("aacp:checkout-event", listener); };
  }, [track]);

  useEffect(() => {
    if (checkoutStage === "completed" && session && !auth.session) {
      void auth.loginFromCheckoutSession(session.session_id, config.merchantId);
    }
  }, [checkoutStage, session, auth.session]);

  useEffect(() => {
    if (!session || auth.session) return;
    const recognizedBuyer = activeExperience.customer?.recognized_buyer === true;
    const emailVerified = activeExperience.customer?.email_verified === true;
    if (!recognizedBuyer || !emailVerified) return;
    void auth.loginFromCheckoutSession(session.session_id, config.merchantId);
  }, [activeExperience.customer?.email_verified, activeExperience.customer?.recognized_buyer, auth.session, config.merchantId, session]);

  const shippingOptions: ShippingQuote[] = useMemo(
    () => chatState.lastChat?.experience?.shippingOptions ?? [],
    [chatState.lastChat?.experience?.shippingOptions]
  );

  async function addSuggestedProduct(product: SuggestedProduct): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    const accepted = product.suggestion_id
      ? await chatState.acceptCrossSell(product)
      : false;
    if (accepted) {
      setCrossSellDismissed(true);
      return;
    }
    if (!product.suggestion_id) {
      await chatState.sendMessageWithOverride(`Quero adicionar: ${product.name}`);
    }
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
    if (!quickReplies.some((allowed) => allowed.label === reply.label && allowed.type === reply.type && allowed.offerId === reply.offerId)) return;
    if (checkoutStage === "payment" && /^(sim|tenho|usar|informar).*\bcupom\b/i.test(reply.label)) {
      setCouponInputVisible(true);
      setPrePaymentStep("coupon_entry");
      chatState.appendAgentTurn("Digite o codigo do cupom para eu aplicar antes de liberar o pagamento.", { stream: true });
      return;
    }
    if (checkoutStage === "payment" && /^(nao|sem)\b.*cupom|^nao tenho cupom$/i.test(reply.label)) {
      setCouponInputVisible(false);
      setPrePaymentStep("payment_method");
      chatState.appendAgentTurn("Perfeito. Agora escolha a forma de pagamento para finalizar.", { stream: true });
      return;
    }
    if (checkoutStage === "payment" && prePaymentStep !== "payment_method" && (/^pix$/i.test(reply.label) || /cartao|cartao de credito|cartao de debito/i.test(reply.label))) {
      return;
    }
    if (/cartao|cartao de credito|cartao de debito|cart[aã]o/i.test(reply.label)) {
      panels.setShowCardForm(true);
      chatState.appendAgentTurn(
        "Preencha os dados do seu cartao abaixo. Seus dados sao criptografados e transmitidos com seguranca via checkout transparente.",
        { stream: true }
      );
      return;
    }
    if (/^(tenho|adicionar|usar|inserir|informar)\b.*\bcupom\b/i.test(reply.label)) {
      setCouponInputVisible(true);
      setPrePaymentStep("coupon_entry");
      chatState.appendAgentTurn("Insira o codigo do seu cupom abaixo para aplicar o desconto.", { stream: true });
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
        "No momento, o pagamento via boleto nao esta disponivel para esta compra. Por favor, escolha cartao de credito ou PIX.",
        { stream: true }
      );
      return;
    }
    return chatState.tapQuick(reply);
  }

  const quickReplies = useMemo(() => {
    return filterCheckoutQuickReplies(chatState.quickReplies, {
      stage: checkoutStage,
      missingField: currentMissingField,
      prePaymentStep
    });
  }, [chatState.quickReplies, checkoutStage, currentMissingField, prePaymentStep]);

  async function submitCoupon(): Promise<void> {
    const applied = await chatState.submitCoupon();
    if (!applied) return;
    setCouponInputVisible(false);
    setPrePaymentStep("payment_method");
    chatState.appendAgentTurn("Desconto aplicado. Agora escolha PIX ou cartao para concluir.", { stream: true });
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
    themeStudio,
    offer,
    checkoutStage,
    stageNote,
    showComposer,
    composerLocked,
    awaitingAgentPlayback: chatState.awaitingAgentPlayback,
    showCouponBox,
    showOfferBanner,
    chatTrustBadges,
    quickReplies,
    auth,
    hub,
    tapQuick,
    sendMessage: chatState.sendMessage,
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
    userTab: panels.userTab,
    setUserTab: panels.setUserTab,
    showCardForm: panels.showCardForm,
    setShowCardForm: panels.setShowCardForm,
    cardError: panels.cardError,
    setCardError: panels.setCardError,
    shippingOptions,
    suggestedProducts: prePaymentStep === "cross_sell" ? suggestedProducts : [],
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
