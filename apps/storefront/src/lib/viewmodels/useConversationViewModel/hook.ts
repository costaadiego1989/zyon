"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontReadUiAction } from "@zyon/shared-types";
import { assertStorefrontReadUiAction } from "@/lib/storefront-read-ui-action";
import { useWidgetConfig } from "@/lib/widget-config";
import { useCart } from "@/lib/cart-store";
import type { CartLineSelection } from "@/lib/cart-line-selection";
import { checkoutApi } from "@/lib/api/api-client";
import { ScopedConversationSession, ScopedConversationUnavailable } from "@/lib/scoped-conversation";
import { prepareConversationTurn } from "@/lib/prepare-conversation-turn";
import {
  conversationAccessHeaders,
  conversationAccessMatchesCurrentOrigin,
  forgetConversationAccess,
  ConversationSessionExpiredError,
  ensureConversationAccess,
} from "@/lib/conversation-access";
import { canFireTrigger, recordTriggerFired, noteActivity } from "@/lib/intervention-tracker";
import { trackConversationStart } from "@/lib/analytics";
import { useNudgeTriggers, useProactiveMode, useReturnOrderTracking } from "./effects";
import {
  restoreConversation,
  saveConversationState,
  buildWelcomeMessage,
  applyThemeToDOM,
  restoreChannelPreference,
  saveChannelPreference,
  restoreThemePreference,
  saveThemePreference,
  trackFunnelEvent,
} from "@/lib/services/conversation.service";
import {
  handleSendMessage,
  handleQuickReply,
  handleUpdateQuantity,
  handleFireNudge,
  initConversation as runInitConversation,
} from "@/lib/handlers/conversation.handlers";
import { useCheckoutExperiment } from "@/lib/useCheckoutExperiment";
import type {
  ConversationViewModelProps,
  ConversationViewModelState,
  ConversationViewModelActions,
  Message,
  Channel,
  Theme,
  Mode,
  CrossSellInterstitialData,
  ConversationAttachment,
  ProductCrossSellPlacement,
  CommerceTurnResult,
} from "./types";

export const SHARED_THEME_KEY = "zyon-theme";

export const CONVERSATION_STATE_KEY = (merchantId: string) => `zyon_conversation_state_${merchantId}`;

export function useConversationViewModel(
  props: ConversationViewModelProps,
): ConversationViewModelState & ConversationViewModelActions {
  const { storeName, merchantId, merchantSlug, agentName, agentGreeting, quickReplies, returnOrderId, themeMode, merchantTheme, agentMode, agentInitialDelaySeconds } = props;
  const agent = agentName || "Assistente";
  const [mode, setMode] = useState<Mode>("intro");
  const [channel, setChannel] = useState<Channel | null>(null);

  const [theme, setTheme] = useState<Theme>(() => {
    const merchantDefault: Theme = themeMode === "dark" || themeMode === "grey" ? "dark" : "light";
    const saved = restoreThemePreference();
    return saved || merchantDefault;
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const dispatchedConversationIdsRef = useRef(new Set<string>());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const scopeRef = useRef({ merchantId, mounted: true });
  const initializationRef = useRef<{ scope: object; promise: Promise<void> } | null>(null);
  const sendingRef = useRef<object | null>(null);
  const nudgeGenerationRef = useRef<object | null>(null);
  const restoredRef = useRef(false);
  const [stateMerchantId, setStateMerchantId] = useState(merchantId);
  // Invalidate during render, not only in an effect (including merchant ABA).
  if (scopeRef.current.merchantId !== merchantId) {
    scopeRef.current = { merchantId, mounted: true };
    conversationIdRef.current = null;
    initializationRef.current = null;
    sendingRef.current = null;
    nudgeGenerationRef.current = null;
    restoredRef.current = false;
  }
  const setConversationId = useCallback((id: string, ownerAccepted = false) => {
    if (!ownerAccepted && conversationIdRef.current && conversationIdRef.current !== id) {
      scopeRef.current = { merchantId: scopeRef.current.merchantId, mounted: true };
      initializationRef.current = null;
      sendingRef.current = null;
      nudgeGenerationRef.current = null;
    }
    conversationIdRef.current = id;
    setConversationIdState(id);
    try { sessionStorage.setItem("zyon_conversation_id", id); } catch { /* Storage may be unavailable. */ }
  }, []);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [supportOpen, setSupportOpen] = useState(false);
  const [buyerHubOpen, setBuyerHubOpen] = useState(false);
  const supportNavigationRef = useRef(false);
  const latestBuyerMessage = messages.filter(message => message.role === "user").at(-1)?.text?.trim().toLowerCase();
  supportNavigationRef.current = supportOpen || buyerHubOpen || ["meus dados", "faq", "falar com humano",
    "reportar problema", "status do pedido", "rastrear pedido", "suporte"].includes(latestBuyerMessage ?? "");
  const [cartDrawerForceOpen, setCartDrawerForceOpen] = useState(false);
  const [showBuyerAuth, setShowBuyerAuth] = useState(false);
  const [checkoutIntent, setCheckoutIntent] = useState<string | null>(null);
  const [policyModal, setPolicyModal] = useState<{ title: string; content: string } | null>(null);
  const [crossSellPending, setCrossSellPending] = useState<CrossSellInterstitialData | null>(null);
  const [productCrossSell, setProductCrossSell] = useState<ProductCrossSellPlacement | null>(null);
  const [preparedCheckout, setPreparedCheckout] = useState<ConversationViewModelState["preparedCheckout"]>(null);
  const dismissCrossSell = useCallback(() => setCrossSellPending(null), []);
  const dismissProductCrossSell = useCallback(() => setProductCrossSell(null), []);
  const clearPreparedCheckout = useCallback(() => setPreparedCheckout(null), []);
  const { config: widgetConfig } = useWidgetConfig();
  const { cart, updateFromBlocks, captureConversationCartProjection, updateItemQuantity, clearCart } = useCart();
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const ownerScope = scopeRef.current;
  const conversationOwner = useMemo(() => {
    if (!merchantId) return null;
    const hint = (key: string): string | null => {
      try { return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key); } catch { return null; }
    };
    const key = `zyon-conversation-id:${merchantId}`;
    const owner: ScopedConversationSession = new ScopedConversationSession(merchantId, {
      create: () => checkoutApi.create({ merchantId }),
      isCurrent: () => scopeRef.current === ownerScope && ownerScope.mounted,
      hasAccess: id => Boolean(conversationAccessHeaders(id).Authorization),
      protectedCart: (): string | null => cartRef.current.cartId ?? hint(`zyon-cart-id:${merchantId}`)
        ?? (owner.id && (dispatchedConversationIdsRef.current.has(owner.id)
          || hint(`zyon-conversation-dispatched:${merchantId}`) === owner.id) ? owner.id : null),
      isReadOnly: () => Boolean(hint(`zyon-marketplace-cart-pending:${merchantId}`)),
      save: id => { try { sessionStorage.setItem(key, id); } catch { /* In-memory ownership remains valid. */ } },
      clear: id => { try { if (hint(key) === id) sessionStorage.removeItem(key); } catch { /* Private storage. */ } },
      isRetired: id => hint(`zyon-conversation-retired:${merchantId}`) === id,
    }, hint(`zyon-cart-id:${merchantId}`) ?? hint(key));
    return owner;
  }, [merchantId, ownerScope]);
  const experimentVM = useCheckoutExperiment();

  const initConversation = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope.mounted || scope.merchantId !== merchantId || !conversationOwner?.current()) return;
    if (conversationIdRef.current) return;
    if (initializationRef.current?.scope === scope) return initializationRef.current.promise;
    let ownedConversationId = conversationIdRef.current;
    const isCurrent = () => scopeRef.current === scope && scope.mounted
      && conversationIdRef.current === ownedConversationId;
    const pending = runInitConversation({
      merchantId,
      conversationId: conversationIdRef.current,
      cartId: cartRef.current.cartId,
      ensureConversation: () => conversationOwner.ensure(conversationIdRef.current ?? cartRef.current.cartId),
      isCurrent,
      setConversationId: (id) => {
        if (!isCurrent()) return;
        setConversationId(id, true);
        ownedConversationId = id;
      },
      captureFromConversationStart: experimentVM.captureFromConversationStart,
      setExperimentGreeting: experimentVM.setExperimentGreeting,
    });
    const token = { scope, promise: pending };
    initializationRef.current = token;
    try { await pending; } finally {
      if (initializationRef.current === token) initializationRef.current = null;
    }
  }, [merchantId, conversationId, agent, storeName, cart.cartId, experimentVM, conversationOwner]);

  const applyTheme = useCallback((t: Theme) => {
    applyThemeToDOM(t, merchantTheme);
  }, [merchantTheme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    saveThemePreference(next);
  }, [theme, applyTheme]);

  const selectChannel = useCallback(
    (ch: Channel) => {
      setChannel(ch);
      setMode("chat");
      // Voice is opt-in for the current page only. Do not restore it after
      // a reload, which could make the storefront appear voice-active.
      saveChannelPreference(ch === "voice" ? "chat" : ch);
      initConversation();

      const expGreeting = experimentVM.getExperimentGreeting();
      const selectionScope = scopeRef.current;
      // Cart/product deep links and channel switches re-enter this action.
      // Initialize the greeting only; never replace an active buyer transcript.
      setMessages(current => scopeRef.current !== selectionScope || !selectionScope.mounted
        || current.length > 0 ? current : [
        buildWelcomeMessage({
          agent,
          storeName,
          agentGreeting,
          quickReplies,
          expGreetingMessage: expGreeting?.message,
          expSuggestedNext: expGreeting?.suggestedNext,
        }),
      ]);
    },
    [agent, storeName, quickReplies, agentGreeting, initConversation, experimentVM],
  );

  const toggleChannel = useCallback(() => {
    const next: Channel = channel === "voice" ? "chat" : "voice";
    setChannel(next);
    saveChannelPreference(next === "voice" ? "chat" : next);
  }, [channel]);

  const returnToCurrentConversation = useCallback(() => {
    // Resume the existing thread without initializing a different channel.
    setMode("chat");
    setChannel("chat");
    setBuyerHubOpen(false);
    saveChannelPreference("chat");
  }, []);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    const scope = scopeRef.current;
    if (!scope.mounted || scope.merchantId !== merchantId) return null;
    await initConversation();
    return scopeRef.current === scope && scope.mounted ? conversationIdRef.current : null;
  }, [merchantId, initConversation]);

  const sendMessage = useCallback(
    async (text: string, attachment?: ConversationAttachment, uiAction?: StorefrontReadUiAction, voiceTurnToken?: string): Promise<CommerceTurnResult | null> => {
      if (uiAction !== undefined) assertStorefrontReadUiAction(uiAction);
      const trimmed = text.trim();
      const scope = scopeRef.current;
      if ((!trimmed && !attachment) || sendingRef.current || !scope.mounted || scope.merchantId !== merchantId) return null;
      const startingCartId = cartRef.current.cartId;
      const token = {};
      nudgeGenerationRef.current = null;
      sendingRef.current = token;
      try {
        if (!conversationOwner) return null;
        if (!conversationIdRef.current && (voiceTurnToken || history.length || messagesRef.current.some(message => message.role === "user"))) {
          throw new ConversationSessionExpiredError();
        }
        await initConversation();
        if (scopeRef.current !== scope || !scope.mounted || sendingRef.current !== token) return null;
        const previousId = conversationIdRef.current;
        if (cartRef.current.cartId && cartRef.current.cartId !== (startingCartId ?? previousId)) {
          throw new ConversationSessionExpiredError();
        }
        const started = await prepareConversationTurn({
          owner: conversationOwner,
          hint: previousId,
          hasBuyerHistory: history.length > 0 || messagesRef.current.some(message => message.role === "user"),
          hasVoiceProof: Boolean(voiceTurnToken),
          isCurrent: () => scopeRef.current === scope && scope.mounted && sendingRef.current === token,
          ensureAccess: ensureConversationAccess,
          isExpired: error => error instanceof ConversationSessionExpiredError,
        });
        if (!started || scopeRef.current !== scope || !scope.mounted || sendingRef.current !== token) return null;
        if (cartRef.current.cartId && cartRef.current.cartId !== (startingCartId ?? started.conversation_id)) {
          throw new ConversationSessionExpiredError();
        }
        if (started.conversation_id !== previousId) {
          setConversationId(started.conversation_id, true);
          experimentVM.captureFromConversationStart({ conversation_id: started.conversation_id, experiment: started.experiment ?? null });
          if (merchantId) trackFunnelEvent(merchantId, started.conversation_id, "conversation_started");
        }
        let ownedConversationId = conversationIdRef.current;
        const isCurrent = () => scopeRef.current === scope && scope.mounted
          && conversationIdRef.current === ownedConversationId && conversationOwner.current(ownedConversationId);
        // Public transport binds cart_id to the authorized conversation. The
        // provider captures the latest cart/version itself and rejects mismatch.
        const applyCartProjection = merchantId && ownedConversationId
          ? captureConversationCartProjection?.({ merchantId, conversationId: ownedConversationId, cartId: ownedConversationId })
          : undefined;
        const variantId = started.experiment?.variant_id || experimentVM.getTrackingVariantId() || undefined;
        // Conservative continuity fence survives a reload or a delayed React
        // commit. It is not authorization and never refunds/replays a command.
        if (merchantId && ownedConversationId) {
          dispatchedConversationIdsRef.current.add(ownedConversationId);
          try { sessionStorage.setItem(`zyon-conversation-dispatched:${merchantId}`, ownedConversationId); } catch { /* The memory fence still protects this mount. */ }
        }
        return await handleSendMessage({
          trimmed,
          attachment,
          uiAction,
          voiceTurnToken,
          conversationId: conversationIdRef.current,
          setConversationId: (id) => {
            if (!isCurrent()) return;
            setConversationId(id);
            ownedConversationId = id;
          },
          isCurrent,
          applyCartProjection,
          clearCart,
          merchantId: merchantId || null,
          history,
          cartId: cartRef.current.cartId,
          variantId,
          setMessages,
          setHistory,
          setIsLoading,
          setInput,
          setCrossSellPending,
          setProductCrossSell,
          updateFromBlocks,
          noteActivity,
          onCheckoutPrepared: setPreparedCheckout,
        });
      } catch (error) {
        if (scopeRef.current === scope && scope.mounted && sendingRef.current === token) {
          const text = error instanceof ScopedConversationUnavailable || error instanceof ConversationSessionExpiredError
            ? "Sua conversa e seu carrinho foram preservados. A sessão precisa ser validada antes de continuar; nenhuma solicitação foi reenviada automaticamente."
            : "Não consegui validar sua sessão agora. Seu texto e seus itens foram mantidos; tente novamente em instantes.";
          setMessages(previous => [...previous, { id: `a-session-${Date.now()}`, role: "agent", text }]);
        }
        return null;
      } finally {
        if (sendingRef.current === token) {
          sendingRef.current = null;
          if (scopeRef.current === scope && scope.mounted) setIsLoading(false);
        }
      }
    },
    [merchantId, history, experimentVM, initConversation, setConversationId, clearCart, updateFromBlocks, captureConversationCartProjection, conversationOwner],
  );

  const handleQuickReplyAction = useCallback(
    (option: string, uiAction?: StorefrontReadUiAction) => {
      handleQuickReply({
        budgetModeEnabled: props.budgetModeEnabled || widgetConfig?.budgetModeEnabled,
        option,
        uiAction,
        cartItemCount: cart.itemCount,
        merchantId: merchantId || null,
        conversationId,
        sendMessage,
        setCartDrawerForceOpen,
        setCheckoutIntent,
        setShowBuyerAuth,
      });
    },
    [cart.itemCount, merchantId, conversationId, sendMessage, props.budgetModeEnabled, widgetConfig?.budgetModeEnabled],
  );

  const appendAgentMessage = useCallback((message: Pick<Message, "text" | "blocks">) => {
    setMessages((previous) => [
      ...previous,
      { id: `a-local-${Date.now()}`, role: "agent", ...message },
    ]);
  }, []);

  const handleUpdateQuantityAction = useCallback(
    (variantId: string, quantity: number, selection?: CartLineSelection) => {
      void handleUpdateQuantity({
        variantId,
        quantity,
        selection,
        cartId: cart.cartId || null,
        merchantId: merchantId || null,
        updateItemQuantity,
      });
    },
    [cart.cartId, merchantId, updateItemQuantity],
  );

  useEffect(() => {
    if (!merchantId || stateMerchantId !== merchantId) return;
    const persisted = messages.filter((m) => !m.ephemeral);
    if (persisted.length === 0) return;
    saveConversationState(merchantId, CONVERSATION_STATE_KEY, { conversationId, messages: persisted, mode, channel: channel === "voice" ? "chat" : channel });
  }, [merchantId, stateMerchantId, conversationId, messages, mode, channel]);

  useEffect(() => {
    scopeRef.current.mounted = true;
    return () => {
      scopeRef.current.mounted = false;
      // A StrictMode effect replay may mount again on the same refs. Never
      // reactivate the object captured by the detached async continuation.
      scopeRef.current = { merchantId: scopeRef.current.merchantId, mounted: false };
      initializationRef.current = null;
      sendingRef.current = null;
      nudgeGenerationRef.current = null;
    };
  }, []);

  useEffect(() => {
    conversationIdRef.current = null;
    restoredRef.current = false;
    setStateMerchantId(merchantId);
    setMessages([]);
    setHistory([]);
    setInput("");
    setIsLoading(false);
    setConversationIdState(null);
    setCrossSellPending(null);
    setProductCrossSell(null);
    setPreparedCheckout(null);
    setCheckoutIntent(null);
    setShowBuyerAuth(false);
    setMode("intro");
    setChannel(null);
    try {
      const savedChannel = restoreChannelPreference();
      applyTheme(theme);
      const restored = restoreConversation(merchantId, CONVERSATION_STATE_KEY);
      if (restored && restored.messages.length > 0) {
        const conversationCanBeRestored = !restored.conversationId
          || conversationAccessMatchesCurrentOrigin(restored.conversationId);
        if (conversationCanBeRestored) {
          setMessages(restored.messages);
          if (restored.conversationId) setConversationId(restored.conversationId);
          if (restored.mode) setMode(restored.mode);
          if (restored.channel) setChannel(restored.channel === "voice" ? "chat" : restored.channel);
          restoredRef.current = true;
          return;
        }

        forgetConversationAccess(restored.conversationId!);
        sessionStorage.removeItem(CONVERSATION_STATE_KEY(merchantId!));
        sessionStorage.removeItem(`zyon-cart-id:${merchantId}`);
        sessionStorage.removeItem("zyon_conversation_id");
        clearCart();
      }
      // Chat history may expire before the cart. Keep their identity aligned;
      // the API will verify/renew the stored proof before either is accessed.
      const savedCartId = merchantId ? sessionStorage.getItem(`zyon-cart-id:${merchantId}`) : null;
      if (savedCartId && conversationAccessHeaders(savedCartId).Authorization) {
        if (conversationAccessMatchesCurrentOrigin(savedCartId)) {
          setConversationId(savedCartId);
        } else {
          forgetConversationAccess(savedCartId);
          sessionStorage.removeItem(`zyon-cart-id:${merchantId}`);
          sessionStorage.removeItem("zyon_conversation_id");
          clearCart();
        }
      }
      if (savedChannel === "chat") {
        setChannel("chat");
        setMode("chat");
      }
    } catch {}
  }, [merchantId]);

  useEffect(() => {
    if (!merchantId) return;
    if (restoredRef.current) return;
    void initConversation();
  }, [merchantId, initConversation]);

  useEffect(() => {
    trackConversationStart(storeName, experimentVM.getTrackingVariantId());
  }, [storeName, experimentVM.experiment]);

  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;
  const widgetConfigRef = useRef(widgetConfig);
  widgetConfigRef.current = widgetConfig;
  const experimentVMRef = useRef(experimentVM);
  experimentVMRef.current = experimentVM;

  const fireNudge = useCallback(
    (triggerEvent: "idle_30_seconds" | "exit_intent_detected") => {
      const scope = scopeRef.current;
      if (!scope.mounted || scope.merchantId !== merchantId || sendingRef.current !== null || supportNavigationRef.current) return;
      const ownedConversationId = conversationIdRef.current;
      const token = {};
      const previous = nudgeGenerationRef.current;
      let admitted = false;
      const isCurrent = () => scopeRef.current === scope && scope.mounted
        && conversationIdRef.current === ownedConversationId
        && nudgeGenerationRef.current === (admitted ? token : previous) && sendingRef.current === null && !supportNavigationRef.current;
      const stage = (cartRef.current?.itemCount ?? 0) > 0 ? "cart" : "browsing";
      handleFireNudge({
        isCurrent,
        onAdmitted: () => {
          if (!isCurrent()) return;
          admitted = true;
          nudgeGenerationRef.current = token;
        },
        triggerEvent,
        stage,
        merchantId: merchantId || null,
        conversationId: conversationIdRef.current,
        agentMode: agentModeRef.current,
        widgetConfig: widgetConfigRef.current,
        setMode,
        setMessages,
        setIsLoading,
        canFireTrigger,
        recordTriggerFired,
      });
    },
    [merchantId],
  );

  useNudgeTriggers(merchantId, conversationIdRef, fireNudge);
  useProactiveMode(agentMode, agentInitialDelaySeconds, initConversation, selectChannel);
  useReturnOrderTracking(returnOrderId);

  return {
    mode: stateMerchantId === merchantId ? mode : "intro",
    channel: stateMerchantId === merchantId ? channel : null,
    theme,
    messages: stateMerchantId === merchantId ? messages : [],
    input: stateMerchantId === merchantId ? input : "",
    isLoading: stateMerchantId === merchantId && isLoading,
    conversationId: stateMerchantId === merchantId ? conversationId : null,
    supportOpen,
    buyerHubOpen,
    cartDrawerForceOpen,
    showBuyerAuth: stateMerchantId === merchantId && showBuyerAuth,
    checkoutIntent: stateMerchantId === merchantId ? checkoutIntent : null,
    setCheckoutIntent,
    policyModal,
    crossSellPending: stateMerchantId === merchantId ? crossSellPending : null,
    productCrossSell: stateMerchantId === merchantId ? productCrossSell : null,
    preparedCheckout: stateMerchantId === merchantId ? preparedCheckout : null,
    dismissCrossSell,
    dismissProductCrossSell,
    clearPreparedCheckout,
    selectChannel,
    returnToCurrentConversation,
    toggleChannel,
    toggleTheme,
    ensureConversation,
    sendMessage,
    handleQuickReply: handleQuickReplyAction,
    appendAgentMessage,
    handleUpdateQuantity: handleUpdateQuantityAction,
    setInput,
    setSupportOpen,
    setBuyerHubOpen,
    setShowBuyerAuth,
    setPolicyModal,
    setCartDrawerForceOpen,
  };
}
