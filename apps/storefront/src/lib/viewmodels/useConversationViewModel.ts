"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWidgetConfig } from "@/lib/widget-config";
import { useCart } from "@/lib/cart-store";
import { checkoutApi, cartApi } from "@/lib/api/api-client";
import { initTriggerDetection } from "@/lib/triggers";
import { getInterventionCount, incrementIntervention, canFireTrigger, recordTriggerFired } from "@/lib/intervention-tracker";
import { TRIGGER_MESSAGES } from "@/lib/trigger-messages";
import { useCheckoutExperiment } from "@/lib/useCheckoutExperiment";
import {
  trackBeginCheckout,
  trackConversationStart,
  trackProductView,
  trackPurchase,
} from "@/lib/analytics";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

/** Fire funnel event to backend for experiment tracking */
function trackFunnelEvent(merchantId: string, sessionId: string, event: string) {
  fetch(`${API_BASE}/checkout/track-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchant_id: merchantId, session_id: sessionId, event, metadata: { timestamp: new Date().toISOString() } }),
  }).catch(() => {});
}

export type Message = {
  id: string;
  role: "user" | "agent";
  text?: string;
  blocks?: any[];
};

export type Channel = "chat" | "voice";
export type Theme = "dark" | "light";
export type Mode = "intro" | "chat";

export interface ConversationViewModelProps {
  storeName: string;
  merchantId?: string;
  merchantSlug?: string;
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
  returnOrderId?: string;
}

export interface ConversationViewModelState {
  mode: Mode;
  channel: Channel | null;
  theme: Theme;
  messages: Message[];
  input: string;
  isLoading: boolean;
  listening: boolean;
  conversationId: string | null;
  supportOpen: boolean;
  buyerHubOpen: boolean;
  cartDrawerForceOpen: boolean;
  showBuyerAuth: boolean;
  policyModal: { title: string; content: string } | null;
}

export interface ConversationViewModelActions {
  selectChannel: (ch: Channel) => void;
  toggleChannel: () => void;
  toggleTheme: () => void;
  sendMessage: (text: string) => Promise<void>;
  handleQuickReply: (option: string) => void;
  handleUpdateQuantity: (variantId: string, quantity: number) => void;
  setInput: (value: string) => void;
  setSupportOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setBuyerHubOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setShowBuyerAuth: (value: boolean) => void;
  setPolicyModal: (value: { title: string; content: string } | null) => void;
  setCartDrawerForceOpen: (value: boolean) => void;
  startListening: () => void;
  stopListening: () => void;
}

export function useConversationViewModel(
  props: ConversationViewModelProps,
): ConversationViewModelState & ConversationViewModelActions {
  const { storeName, merchantId, merchantSlug, agentName, agentGreeting, quickReplies, returnOrderId } = props;
  const agent = agentName || "Assistente";
  const [mode, setMode] = useState<Mode>("intro");
  const [channel, setChannel] = useState<Channel | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
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
  const [policyModal, setPolicyModal] = useState<{ title: string; content: string } | null>(null);

  const recognitionRef = useRef<any>(null);
  const { config: widgetConfig } = useWidgetConfig();
  const { cart, updateFromBlocks, updateItemQuantity } = useCart();
  const experimentVM = useCheckoutExperiment();

  const initConversation = useCallback(async () => {
    if (!merchantId || conversationId) return;
    try {
      const data = await checkoutApi.create({ merchantId });
      if (data?.conversation_id) {
        setConversationId(data.conversation_id);
        experimentVM.captureFromConversationStart({
          conversation_id: data.conversation_id,
          experiment: data.experiment || null,
        });

        // Track conversation_started funnel event
        if (merchantId) {
          trackFunnelEvent(merchantId, data.conversation_id, "conversation_started");
        }

        if (data.experiment?.system_prompt) {
          checkoutApi.sendMessage(data.conversation_id, "olá", {
            merchantId,
            cartId: cart.cartId || undefined,
            history: [],
          }).then((greetingData) => {
            if (greetingData?.message) {
              // Store for when user interacts — hero stays until then
              experimentVM.setExperimentGreeting(greetingData.message, greetingData.suggested_next);
            }
          }).catch(() => { /* keep default behavior */ });
        }
      }
    } catch { /* fallback mode */ }
  }, [merchantId, conversationId, agent, storeName]);

  const applyTheme = useCallback((t: Theme) => {
    if (typeof document === "undefined") return;
    const THEME_TOKENS: Record<Theme, Record<string, string>> = {
      dark: {
        "--aacp-bg": "#08080c",
        "--aacp-surface": "#0f0f16",
        "--aacp-surface-2": "rgba(255, 255, 255, 0.05)",
        "--aacp-surface-3": "rgba(255, 255, 255, 0.08)",
        "--aacp-fg": "#f5f5f7",
        "--aacp-muted": "#8b8b95",
        "--aacp-faint": "#6c6a72",
        "--aacp-line": "rgba(255, 255, 255, 0.1)",
        "--aacp-line-strong": "rgba(255, 255, 255, 0.12)",
        "--aacp-card": "rgba(255, 255, 255, 0.05)",
        "--aacp-success": "#34d399",
        "--aacp-panel-bg": "#0f0f16",
        "--aacp-shell-bg": "#08080c",
      },
      light: {
        "--aacp-bg": "#ffffff",
        "--aacp-surface": "#ffffff",
        "--aacp-surface-2": "#f6f5f2",
        "--aacp-surface-3": "#efeee9",
        "--aacp-fg": "#141418",
        "--aacp-muted": "#71717a",
        "--aacp-faint": "#9a978e",
        "--aacp-line": "rgba(15, 15, 25, 0.09)",
        "--aacp-line-strong": "rgba(15, 15, 25, 0.1)",
        "--aacp-card": "#f7f6f3",
        "--aacp-success": "#10b981",
        "--aacp-panel-bg": "#ffffff",
        "--aacp-shell-bg": "#ffffff",
      },
    };
    const tokens = THEME_TOKENS[t];
    for (const [key, val] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(key, val);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem("pulse-theme-pref", next); } catch { /* */ }
  }, [theme, applyTheme]);

  const selectChannel = useCallback((ch: Channel) => {
    setChannel(ch);
    setMode("chat");
    try { localStorage.setItem("pulse-channel-pref", ch); } catch { /* */ }
    initConversation();

    // Use experiment greeting if pre-fetched, otherwise static
    const expGreeting = experimentVM.getExperimentGreeting();
    const greeting = expGreeting?.message
      || agentGreeting
      || `Oi! Sou ${agent}, assistente da ${storeName}. Me diz o que procura — posso buscar produtos, aplicar cupons, calcular frete e fechar pedido tudo aqui. 🛍️`;

    const replies = expGreeting?.suggestedNext ?? quickReplies ?? ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"];

    setMessages([{
      id: "welcome",
      role: "agent",
      text: greeting,
      blocks: [{ type: "quick_replies", data: { options: replies } }],
    }]);
  }, [agent, storeName, quickReplies, agentGreeting, initConversation]);

  const toggleChannel = useCallback(() => {
    const next: Channel = channel === "voice" ? "chat" : "voice";
    setChannel(next);
    try { localStorage.setItem("pulse-channel-pref", next); } catch { /* */ }
    if (next === "voice") startListening();
    else stopListening();
  }, [channel]);

  function startListening() {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = "pt-BR";
    r.continuous = false;
    r.maxAlternatives = 1;
    recognitionRef.current = r;
    r.onresult = (e: any) => {
      const transcript = e.results[0]?.[0]?.transcript;
      if (transcript) {
        setListening(false);
        void sendMessage(transcript);
      }
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    r.start();
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.abort();
    setListening(false);
  }

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const newHistory = [...history, { role: "user" as const, content: trimmed }];
    setHistory(newHistory);

    try {
      let convId = conversationId;
      if (!convId && merchantId) {
        const startData = await checkoutApi.create({ merchantId });
        if (startData?.conversation_id) {
          convId = startData.conversation_id;
          setConversationId(convId);
          experimentVM.captureFromConversationStart({
            conversation_id: startData.conversation_id,
            experiment: startData.experiment || null,
          });
        }
      }

      if (convId && merchantId) {
        const data = await checkoutApi.sendMessage(convId, trimmed, {
          merchantId,
          cartId: cart.cartId || undefined,
          history: newHistory,
          variantId: experimentVM.getTrackingVariantId() || undefined,
        });

        if (data) {
          const blocks = data.blocks ?? [];
          if (data.suggested_next?.length) {
            blocks.push({ type: "quick_replies", data: { options: data.suggested_next } });
          }
          updateFromBlocks(blocks);

          // Track funnel events for experiment based on response content
          if (conversationId && merchantId) {
            const hasCart = blocks.some((b: any) => b.type === "cart_summary");
            const hasProducts = blocks.some((b: any) => ["product_carousel", "product_card", "marketplace_products"].includes(b.type));
            if (hasCart) {
              trackFunnelEvent(merchantId, conversationId, "add_to_cart");
            } else if (hasProducts) {
              trackFunnelEvent(merchantId, conversationId, "product_viewed");
            }
          }

          const hasVisualBlock = blocks.some((b: any) =>
            ["product_carousel", "product_card", "cart_summary", "category_carousel", "product_comparison", "shipping_options", "marketplace_products"].includes(b.type)
          );

          const agentMsg: Message = {
            id: `a-${Date.now()}`,
            role: "agent",
            text: hasVisualBlock ? undefined : data.message,
            blocks,
          };
          setMessages((prev) => [...prev, agentMsg]);
          setHistory((prev) => [...prev, { role: "assistant", content: data.message }]);
        } else {
          setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: "Desculpe, houve um erro. Tente novamente." }]);
        }
      } else {
        setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: `Entendi, "${trimmed}". Deixa eu verificar para você...` }]);
      }
    } catch {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "agent", text: "Não consegui conectar ao servidor. Verifique sua conexão." }]);
    }

    setIsLoading(false);
  }, [conversationId, merchantId, history, cart.cartId]);

  // ─── Quick Reply ───
  const handleQuickReply = useCallback((option: string) => {
    const lower = option.toLowerCase();
    if (lower === "ver carrinho" || lower === "ver meu carrinho") {
      setCartDrawerForceOpen(true);
      setTimeout(() => setCartDrawerForceOpen(false), 100);
      return;
    }
    if (lower === "finalizar compra" || lower === "finalizar pedido") {
      setCartDrawerForceOpen(true);
      setTimeout(() => setCartDrawerForceOpen(false), 100);
      setShowBuyerAuth(true);
      return;
    }
    if (lower === "aplicar cupom" && cart.itemCount === 0) {
      void sendMessage("Quero aplicar um cupom de desconto");
      return;
    }
    void sendMessage(option);
  }, [sendMessage, cart.itemCount]);

  // ─── Cart Quantity ───
  const handleUpdateQuantity = useCallback((variantId: string, quantity: number) => {
    updateItemQuantity(variantId, quantity);
    if (cart.cartId && merchantId) {
      cartApi.updateItem(cart.cartId, variantId, quantity, merchantId).catch((err) => {
        console.error("[cart] server sync failed:", err);
      });
    }
  }, [cart.cartId, merchantId, updateItemQuantity]);

  // ─── Side Effects ───

  // Restore preferences
  useEffect(() => {
    try {
      const savedChannel = localStorage.getItem("pulse-channel-pref") as Channel | null;
      const savedTheme = localStorage.getItem("pulse-theme-pref") as Theme | null;
      if (savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
        applyTheme(savedTheme);
      }
      if (savedChannel === "chat" || savedChannel === "voice") {
        setChannel(savedChannel);
        setMode("chat");
        initConversation();
      } else {
        initConversation();
      }
    } catch { /* SSR/privacy */ }
  }, []);

  useEffect(() => {
    trackConversationStart(storeName, experimentVM.getTrackingVariantId());
  }, [storeName, experimentVM.experiment]);

  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
    const cleanup = initTriggerDetection(
      {
        enableExitIntent: true,
        enableIdleTimer: true,
        idleThresholdMs: 30000,
        apiBaseUrl: API_BASE,
        merchantId,
        sessionId: conversationId || undefined,
      },
      (triggerEvent) => {
        if (!widgetConfig) return;
        if (widgetConfig.mode === "manual_only") return;
        if (!widgetConfig.enabledTriggers?.includes(triggerEvent)) return;

        const maxInterventions = widgetConfig.maxInterventionsPerSession ?? 3;
        const cooldownMs = (widgetConfig.cooldownSeconds ?? 120) * 1000;

        if (getInterventionCount(merchantId || "") >= maxInterventions) return;
        if (!canFireTrigger(merchantId || "", triggerEvent, cooldownMs)) return;

        const customTrigger = widgetConfig.triggerMessages?.[triggerEvent];
        const nudgeText = customTrigger?.message || TRIGGER_MESSAGES[triggerEvent];
        if (!nudgeText) return;

        incrementIntervention(merchantId || "");
        recordTriggerFired(merchantId || "", triggerEvent);

        const couponSuffix = customTrigger?.couponCode
          ? ` 🎁 Use o cupom **${customTrigger.couponCode}** para um desconto especial!`
          : "";

        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: nudgeText + couponSuffix }]);
      },
    );
    return cleanup;
  }, [merchantId, conversationId, widgetConfig]);

  useEffect(() => {
    if (!widgetConfig) return;
    if (widgetConfig.mode !== "proactive") return;
    const delaySec = widgetConfig.initialDelaySeconds ?? 4;
    const timer = setTimeout(() => {
      if (getInterventionCount(merchantId || "") >= (widgetConfig.maxInterventionsPerSession ?? 3)) return;
      incrementIntervention(merchantId || "");
      setMessages((prev) => [...prev, { id: `proactive-${Date.now()}`, role: "agent", text: "Oi! Vi que você está por aqui. Posso ajudar a encontrar algo ou tirar alguma dúvida?" }]);
    }, delaySec * 1000);
    return () => clearTimeout(timer);
  }, [widgetConfig, merchantId]);

  const trackedOrderRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!returnOrderId) return;
    if (trackedOrderRef.current === returnOrderId) return;
    trackedOrderRef.current = returnOrderId;
    trackPurchase(returnOrderId, 0);
  }, [returnOrderId]);

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
    policyModal,
    selectChannel,
    toggleChannel,
    toggleTheme,
    sendMessage,
    handleQuickReply,
    handleUpdateQuantity,
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
