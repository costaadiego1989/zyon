"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWidgetConfig } from "@/lib/widget-config";
import { useCart } from "@/lib/cart-store";
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
} from "@/lib/services/conversation.service";
import {
  handleSendMessage,
  handleQuickReply,
  handleUpdateQuantity,
  handleFireNudge,
  initConversation as runInitConversation,
  startVoiceRecognition,
  stopVoiceRecognition,
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
} from "./types";

export const SHARED_THEME_KEY = "zyon-theme";

export const CONVERSATION_STATE_KEY = (merchantId: string) => `zyon_conversation_state_${merchantId}`;

export function useConversationViewModel(
  props: ConversationViewModelProps,
): ConversationViewModelState & ConversationViewModelActions {
  const { storeName, merchantId, merchantSlug, agentName, agentGreeting, quickReplies, returnOrderId, themeMode, agentMode, agentInitialDelaySeconds } = props;
  const agent = agentName || "Assistente";
  const [mode, setMode] = useState<Mode>("intro");
  const [channel, setChannel] = useState<Channel | null>(null);

  const [theme, setTheme] = useState<Theme>(() => {
    const merchantDefault: Theme = themeMode === "dark" || themeMode === "grey" ? "dark" : "light";
    const saved = restoreThemePreference();
    return saved || merchantDefault;
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [supportOpen, setSupportOpen] = useState(false);
  const [buyerHubOpen, setBuyerHubOpen] = useState(false);
  const [cartDrawerForceOpen, setCartDrawerForceOpen] = useState(false);
  const [showBuyerAuth, setShowBuyerAuth] = useState(false);
  const [checkoutIntent, setCheckoutIntent] = useState<string | null>(null);
  const [policyModal, setPolicyModal] = useState<{ title: string; content: string } | null>(null);
  const [crossSellPending, setCrossSellPending] = useState<CrossSellInterstitialData | null>(null);
  const dismissCrossSell = useCallback(() => setCrossSellPending(null), []);
  const recognitionRef = useRef<any>(null);
  const { config: widgetConfig } = useWidgetConfig();
  const { cart, updateFromBlocks, updateItemQuantity } = useCart();
  const experimentVM = useCheckoutExperiment();

  const initConversation = useCallback(async () => {
    await runInitConversation({
      merchantId,
      conversationId,
      cartId: cart.cartId,
      setConversationId,
      captureFromConversationStart: experimentVM.captureFromConversationStart,
      setExperimentGreeting: experimentVM.setExperimentGreeting,
    });
  }, [merchantId, conversationId, agent, storeName, cart.cartId, experimentVM]);

  const applyTheme = useCallback((t: Theme) => {
    applyThemeToDOM(t);
  }, []);

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
      saveChannelPreference(ch);
      initConversation();

      const expGreeting = experimentVM.getExperimentGreeting();
      setMessages([
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
    saveChannelPreference(next);
    if (next === "voice") startListening();
    else stopListening();
  }, [channel]);

  function startListening() {
    startVoiceRecognition({ recognitionRef, setListening, sendMessage });
  }

  function stopListening() {
    stopVoiceRecognition(recognitionRef, setListening);
  }

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const variantId = experimentVM.getTrackingVariantId() || undefined;

      await handleSendMessage({
        trimmed,
        conversationId,
        merchantId: merchantId || null,
        history,
        cartId: cart.cartId,
        variantId,
        setMessages,
        setHistory,
        setIsLoading,
        setInput,
        setCrossSellPending,
        updateFromBlocks,
        noteActivity,
      });
    },
    [conversationId, merchantId, history, cart.cartId, experimentVM],
  );

  const handleQuickReplyAction = useCallback(
    (option: string) => {
      handleQuickReply({
        option,
        cartItemCount: cart.itemCount,
        merchantId: merchantId || null,
        conversationId,
        sendMessage,
        setCartDrawerForceOpen,
        setCheckoutIntent,
        setShowBuyerAuth,
      });
    },
    [cart.itemCount, merchantId, conversationId, sendMessage],
  );

  const handleUpdateQuantityAction = useCallback(
    (variantId: string, quantity: number) => {
      handleUpdateQuantity({
        variantId,
        quantity,
        cartId: cart.cartId || null,
        merchantId: merchantId || null,
        updateItemQuantity,
      });
    },
    [cart.cartId, merchantId, updateItemQuantity],
  );

  useEffect(() => {
    if (!merchantId) return;
    const persisted = messages.filter((m) => !m.ephemeral);
    if (persisted.length === 0) return;
    saveConversationState(merchantId, CONVERSATION_STATE_KEY, { conversationId, messages: persisted, mode, channel });
  }, [merchantId, conversationId, messages, mode, channel]);

  const restoredRef = useRef(false);
  useEffect(() => {
    try {
      const savedChannel = restoreChannelPreference();
      applyTheme(theme);
      const restored = restoreConversation(merchantId, CONVERSATION_STATE_KEY);
      if (restored && restored.messages.length > 0) {
        setMessages(restored.messages);
        if (restored.conversationId) setConversationId(restored.conversationId);
        if (restored.mode) setMode(restored.mode);
        if (restored.channel) setChannel(restored.channel);
        restoredRef.current = true;
        return;
      }
      if (savedChannel === "chat" || savedChannel === "voice") {
        setChannel(savedChannel);
        setMode("chat");
      }
    } catch {}
  }, []);

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
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const experimentVMRef = useRef(experimentVM);
  experimentVMRef.current = experimentVM;

  const cartRef = useRef(cart);
  cartRef.current = cart;

  const fireNudge = useCallback(
    (triggerEvent: "idle_30_seconds" | "exit_intent_detected") => {
      // Stage drives the nudge tone: a buyer with items in the cart gets a
      // conversion-focused offer (never a discovery question); an empty cart
      // keeps the discovery message.
      const stage = (cartRef.current?.itemCount ?? 0) > 0 ? "cart" : "browsing";
      handleFireNudge({
        triggerEvent,
        stage,
        merchantId: merchantId || null,
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
    mode,
    channel,
    theme,
    messages,
    input,
    isLoading,
    listening,
    conversationId,
    supportOpen,
    buyerHubOpen,
    cartDrawerForceOpen,
    showBuyerAuth,
    checkoutIntent,
    setCheckoutIntent,
    policyModal,
    crossSellPending,
    dismissCrossSell,
    selectChannel,
    toggleChannel,
    toggleTheme,
    sendMessage,
    handleQuickReply: handleQuickReplyAction,
    handleUpdateQuantity: handleUpdateQuantityAction,
    setInput,
    setSupportOpen,
    setBuyerHubOpen,
    setShowBuyerAuth,
    setPolicyModal,
    setCartDrawerForceOpen,
    startListening,
    stopListening,
  };
}
