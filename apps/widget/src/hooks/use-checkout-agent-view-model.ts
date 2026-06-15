import { useEffect, useMemo, useRef, useState } from "react";
import type { Cart, CustomerHints, MerchantTheme, ShippingQuote, SuggestedProduct } from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { useGlobalAuth } from "./use-global-auth.js";
import { useAccountHub } from "./use-account-hub.js";
import { useBuyerHub } from "./use-buyer-hub.js";
import { filterCheckoutQuickReplies, buildEmptyCompletedExperience, injectGoogleFont, matchShippingOptionFromLabel, stageNarrative, isBuyerHubEligible, type QuickReplyChoice, type VisibleCartState, normalizeQuickReplyLabel } from "./checkout-view-model.js";
import { emitCheckoutEvent } from "../lib/merchant-checkout-shell.js";
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
  const [completedOrderSnapshot, setCompletedOrderSnapshot] = useState<VisibleCartState | null>(null);
  const couponGatePromptedKey = useRef<string | null>(null);
  const orderCompletionHandled = useRef(false);
  const buyerLoginAttemptedKey = useRef<string | null>(null);
  const sessionState = useCheckoutSession(config);
  const cartState = useCheckoutCart(sessionState.experience, config, sessionState.updateCart);
  const panels = useCheckoutPanels();
  const chatState = useCheckoutChat(config, sessionState, {
    purchaseChannel: panels.purchaseChannel
  });
  const payment = useCheckoutPayment(config, sessionState, chatState);
  const { activeExperience, session, networkError, track, apiOrigin } = sessionState;
  const { visibleItems, visibleTotals, cartItemCount, handleRemoveCartItem, incrementItem, decrementItem, applyShipping, selectedShippingMethod } = cartState;
  const { checkoutStage, composerLocked, streamingTurnKey, awaitingAgentPlayback } = chatState;
  const offer = chatState.lastChat?.authorized_offer;
  const currentMissingField = chatState.lastChat?.missing_fields?.[0];
  const stageNote = stageNarrative(checkoutStage, currentMissingField);
  const showComposer =
    isConversational &&
    panels.purchaseChannel !== "voice" &&
    Boolean(session) &&
    !networkError &&
    checkoutStage !== "completed" &&
    checkoutStage !== "payment" &&
    !awaitingAgentPlayback;
  const suggestedProducts: SuggestedProduct[] = useMemo(
    () => activeExperience.suggestedProducts ?? [],
    [activeExperience.suggestedProducts]
  );
  const couponGateEnabled =
    checkoutStage === "payment" &&
    activeExperience.rules?.couponBoxEnabled !== false &&
    visibleTotals.discount === 0 &&
    !panels.showCardForm &&
    !panels.showCryptoPanel;
  const showCouponBox =
    checkoutStage === "payment" &&
    activeExperience.rules?.couponBoxEnabled !== false &&
    visibleTotals.discount === 0 &&
    !panels.showCardForm &&
    !panels.showCryptoPanel &&
    (prePaymentStep === "coupon_entry" || couponInputVisible);
  const showOfferBanner = visibleTotals.discount > 0;
  const showPendingOffer =
    Boolean(offer?.approved) &&
    visibleTotals.discount === 0 &&
    checkoutStage === "payment" &&
    prePaymentStep === "payment_method" &&
    !panels.showCardForm &&
    !panels.showCryptoPanel;
  const chatTrustBadges = activeExperience.copy.trust_badges.slice(0, 3);

  const auth = useGlobalAuth({
    apiBaseUrl: sessionState.apiOrigin,
    defaultMerchantName: activeExperience.brand.name,
    defaultEmail: activeExperience.customer?.email ?? config.customer?.email
  });

  useEffect(() => {
    const sessionId = session?.session_id;
    const customer = activeExperience.customer;
    if (!sessionId || !isBuyerHubEligible(customer) || auth.session) return;

    const loginKey = `${sessionId}:${customer?.email_verified ? "verified" : "pending"}:${customer?.phone_verified ? "phone" : "no-phone"}`;
    if (buyerLoginAttemptedKey.current === loginKey) return;

    buyerLoginAttemptedKey.current = loginKey;
    void auth.loginFromCheckoutSession(sessionId, config.merchantId);
  }, [
    activeExperience.customer,
    auth,
    auth.session,
    config.merchantId,
    session?.session_id
  ]);
  const hub = useAccountHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: auth.session,
    enabled: auth.open && auth.panel === "hub" && Boolean(auth.session?.merchant_id)
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
    }
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
    if (checkoutStage === "completed" && session && !auth.session && isBuyerHubEligible(activeExperience.customer)) {
      void auth.loginFromCheckoutSession(session.session_id, config.merchantId);
    }
  }, [checkoutStage, session, auth.session, auth, config.merchantId, activeExperience.customer]);

  useEffect(() => {
    if (checkoutStage !== "completed" || orderCompletionHandled.current) return;
    orderCompletionHandled.current = true;

    setCompletedOrderSnapshot({
      items: [...cartState.visibleItems],
      totals: { ...cartState.visibleTotals }
    });

    const currency = activeExperience.totals.currency ?? config.cart.currency ?? "BRL";
    sessionState.syncExperience(buildEmptyCompletedExperience(activeExperience, currency));
    cartState.resetCart(currency);
    chatState.resetAfterCompletion();
    panels.resetPanels();
    setCrossSellDismissed(true);
    setCouponInputVisible(false);
    setPrePaymentStep("cross_sell");
    sessionState.clearPersistedSession();

    emitCheckoutEvent("order_completed");
    if (typeof window !== "undefined") {
      window.parent?.postMessage(
        {
          type: "aacp:order-completed",
          merchant_id: config.merchantId,
          session_id: session?.session_id ?? null
        },
        "*"
      );
    }

    window.setTimeout(() => {
      void auth.loginFromCheckoutSession(session?.session_id ?? "", config.merchantId).finally(() => {
        if (isBuyerSession || auth.session?.global_user_id) {
          void buyerHub.refresh();
        }
      });
    }, 600);
  }, [
    activeExperience,
    auth,
    buyerHub,
    cartState,
    chatState,
    checkoutStage,
    config.cart.currency,
    config.merchantId,
    isBuyerSession,
    panels,
    session?.session_id,
    sessionState
  ]);

  const shippingOptions: ShippingQuote[] = useMemo(
    () => chatState.lastChat?.experience?.shippingOptions ?? [],
    [chatState.lastChat?.experience?.shippingOptions]
  );

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
      setCrossSellDismissed(true);
      if (!agentAlreadyReplied) {
        chatState.appendAgentTurn(`Perfeito! ${product.name} foi adicionado ao seu pedido.`, { stream: true });
      }
    } else {
      sessionState.setNetworkError?.("Falha ao adicionar o produto. Tente novamente em instantes.");
    }
    return added;
  }

  function dismissCrossSell(): void {
    setCrossSellDismissed(true);
  }

  function proceedFromCrossSell(): void {
    dismissCrossSell();
    chatState.appendAgentTurn("Perfeito. Vamos finalizar seu pagamento.", { stream: true });
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

  async function tapQuick(reply: QuickReplyChoice): Promise<void> {
    if (!session || networkError || chatState.busy) return;
    if (!quickReplies.some((allowed) => allowed.label === reply.label && allowed.type === reply.type && allowed.offerId === reply.offerId)) return;

    const crossSellProduct = suggestedProducts.find((product) => {
      const label = normalizeQuickReplyLabel(reply.label);
      const productName = normalizeQuickReplyLabel(product.name);
      return label === normalizeQuickReplyLabel(`Adicionar ${product.name}`) ||
        (label.startsWith("adicionar") && label.includes(productName));
    });
    if (crossSellProduct && checkoutStage === "payment" && prePaymentStep === "cross_sell") {
      await addSuggestedProduct(crossSellProduct);
      return;
    }

    if (checkoutStage === "payment" && prePaymentStep === "cross_sell") {
      if (/^nao agora$/i.test(reply.label)) {
        proceedFromCrossSell();
        return;
      }
      if (/pagamento|finalizar|pagar/i.test(reply.label)) {
        proceedFromCrossSell();
        return;
      }
    }
    if (checkoutStage === "payment" && prePaymentStep === "coupon_gate") {
      const normalized = normalizeQuickReplyLabel(reply.label);
      if (normalized === "sim" || /^(sim|tenho|usar|informar).*\bcupom\b/.test(normalized)) {
        setCouponInputVisible(true);
        setPrePaymentStep("coupon_entry");
        chatState.appendAgentTurn("Digite o codigo do cupom para eu aplicar antes de liberar o pagamento.", { stream: true });
        return;
      }
      if (normalized === "nao" || /^(nao|sem)\b.*cupom|^nao tenho cupom$/.test(normalized)) {
        setCouponInputVisible(false);
        setPrePaymentStep("payment_method");
        if (offer?.approved && visibleTotals.discount === 0) {
          await chatState.applyOffer();
          chatState.appendAgentTurn(
            offer.type === "discount_percent" && offer.value > 0
              ? `Sem problema. Liberamos ${offer.value}% de desconto para voce finalizar agora.`
              : "Perfeito. Liberamos uma condicao especial para voce finalizar agora.",
            { stream: true }
          );
        } else {
          chatState.appendAgentTurn("Perfeito. Agora escolha a forma de pagamento para finalizar.", { stream: true });
        }
        return;
      }
    }
    if (checkoutStage === "payment" && /^(sim|tenho|usar|informar).*\bcupom\b/i.test(reply.label)) {
      setCouponInputVisible(true);
      setPrePaymentStep("coupon_entry");
      chatState.appendAgentTurn("Digite o codigo do cupom para eu aplicar antes de liberar o pagamento.", { stream: true });
      return;
    }
    if (checkoutStage === "payment" && /^(nao|sem)\b.*cupom|^nao tenho cupom$/i.test(reply.label)) {
      setCouponInputVisible(false);
      setPrePaymentStep("payment_method");
      if (offer?.approved && visibleTotals.discount === 0) {
        await chatState.applyOffer();
      }
      chatState.appendAgentTurn("Perfeito. Agora escolha a forma de pagamento para finalizar.", { stream: true });
      return;
    }
    if (checkoutStage === "payment" && prePaymentStep !== "payment_method" && (/^pix$/i.test(reply.label) || /cartao|cartao de credito|cartao de debito/i.test(reply.label))) {
      return;
    }
    if (/cartao|cartao de credito|cartao de debito|cart[aã]o/i.test(reply.label)) {
      panels.setShowCryptoPanel(false);
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
    if (/aplicar.*desconto|aceitar.*desconto|aplicar oferta/i.test(reply.label)) {
      void chatState.applyOffer().then(() => {
        setPrePaymentStep("payment_method");
      });
      return;
    }
    if (/^pix$/i.test(reply.label)) {
      panels.setShowCryptoPanel(false);
      await payment.createPaymentIntent("pix");
      return;
    }
    if (/crypto|cripto/i.test(reply.label)) {
      panels.setShowCardForm(false);
      panels.setShowCryptoPanel(true);
      await payment.createPaymentIntent("crypto");
      return;
    }
    if (/^boleto$/i.test(reply.label)) {
      chatState.appendAgentTurn(
        "No momento, o pagamento via boleto nao esta disponivel para esta compra. Por favor, escolha cartao de credito ou PIX.",
        { stream: true }
      );
      return;
    }
    if (checkoutStage === "shipping" && currentMissingField === "frete") {
      const shippingOption = matchShippingOptionFromLabel(reply.label, shippingOptions);
      if (shippingOption) {
        await tapShippingOption(shippingOption);
        return;
      }
    }
    return chatState.tapQuick(reply);
  }

  const quickReplies = useMemo(() => {
    if (checkoutStage === "payment" && prePaymentStep === "payment_method") {
      const methods: QuickReplyChoice[] = [
        { label: "Cartão de crédito" },
        { label: "PIX" }
      ];
      if (activeExperience.rules?.cryptoPaymentsEnabled) {
        methods.push({ label: "Pagar com crypto" });
      }
      return methods;
    }

    const filtered = filterCheckoutQuickReplies(chatState.quickReplies, {
      stage: checkoutStage,
      missingField: currentMissingField,
      prePaymentStep,
      suggestedProducts: prePaymentStep === "cross_sell" ? suggestedProducts : undefined
    });
    return filtered;
  }, [activeExperience.rules?.cryptoPaymentsEnabled, chatState.quickReplies, checkoutStage, currentMissingField, prePaymentStep, suggestedProducts]);

  async function submitCoupon(): Promise<void> {
    const applied = await chatState.submitCoupon();
    if (!applied) return;
    setCouponInputVisible(false);
    setPrePaymentStep("payment_method");
    chatState.appendAgentTurn("Desconto aplicado. Agora escolha PIX, cartao ou crypto para concluir.", { stream: true });
  }

  function retryStartCheckout(): void {
    chatState.retryChat();
  }

  function selectPurchaseChannel(channel: "chat" | "voice"): void {
    panels.selectPurchaseChannel(channel);
  }

  const showChannelWelcome =
    isConversational && panels.purchaseChannel === "pending";

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
    showCouponBox,
    showOfferBanner,
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
    suggestedProducts: prePaymentStep === "cross_sell" ? suggestedProducts : [],
    crossSellDismissed,
    addSuggestedProduct,
    dismissCrossSell,
    proceedFromCrossSell,
    openBuyerPanel,
    tapShippingOption,
    couponInputVisible,
    setCouponInputVisible,
    buyerHub,
    apiOrigin,
    purchaseChannel: panels.purchaseChannel,
    selectPurchaseChannel,
    showChannelWelcome,
  };
}

export type CheckoutAgentViewModel = ReturnType<typeof useCheckoutAgentViewModel>;
export type { Cart, CustomerHints, ShippingQuote };
