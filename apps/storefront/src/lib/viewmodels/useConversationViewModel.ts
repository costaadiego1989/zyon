"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWidgetConfig } from "@/lib/widget-config";
import { useCart } from "@/lib/cart-store";
import { checkoutApi, cartApi } from "@/lib/api/api-client";
import { initTriggerDetection } from "@/lib/triggers";
import { getInterventionCount, incrementIntervention, canFireTrigger, recordTriggerFired } from "@/lib/intervention-tracker";
import { TRIGGER_MESSAGES } from "@/lib/trigger-messages";
import { useCheckoutExperiment } from "@/lib/useCheckoutExperiment";
import { getValidBuyer } from "@/lib/buyer-auth";
import {
  trackBeginCheckout,
  trackConversationStart,
  trackProductView,
  trackPurchase,
} from "@/lib/analytics";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

/** Fire funnel event to backend for experiment tracking */
function trackFunnelEvent(merchantId: string, sessionId: string, event: string) {
  fetch(`${API_BASE}/v1/storefront/conversations/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchant_id: merchantId, event, metadata: { timestamp: new Date().toISOString() } }),
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

/** Shared localStorage key so storefront + embedded checkout widget stay in sync. */
export const SHARED_THEME_KEY = "zyon-theme";

/**
 * Narration fallback for storefront conversation blocks. When the LLM returns a
 * visual component with no accompanying text, derive a short line so the agent
 * always "speaks" instead of silently dropping a component. Keeps the chat
 * immersive. Returns undefined for blocks that need no narration.
 */
function narrateStorefrontBlock(type: string | undefined): string | undefined {
  switch (type) {
    case "product_carousel":
    case "marketplace_products":
      return "Separei estes produtos pra você:";
    case "product_card":
      return "Encontrei este produto:";
    case "product_comparison":
      return "Aqui está a comparação entre os produtos:";
    case "category_carousel":
      return "Estas são as categorias disponíveis:";
    case "cart_summary":
      return "Aqui está o resumo do seu carrinho:";
    case "shipping_options":
      return "Estas são as opções de entrega:";
    case "cross_sell":
      return "Separei alguns itens que combinam com sua compra:";
    default:
      return undefined;
  }
}

export interface ConversationViewModelProps {
  storeName: string;
  merchantId?: string;
  merchantSlug?: string;
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
  returnOrderId?: string;
  themeMode?: "dark" | "light" | "grey";
  /** Storefront agent activation mode (from agent-rules, projected via store config). */
  agentMode?: "silent_until_trigger" | "proactive" | "manual_only";
  /** Seconds before proactive mode auto-opens the chat. */
  agentInitialDelaySeconds?: number;
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
  checkoutIntent: string | null;
  policyModal: { title: string; content: string } | null;
  crossSellPending: CrossSellInterstitialData | null;
}

export interface CrossSellInterstitialData {
  trigger: string;
  products: Array<{
    id: string;
    name: string;
    price: number;
    priceFormatted: string;
    image?: string;
    inStock: boolean;
    discountPercent?: number;
  }>;
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
  setCheckoutIntent: (value: string | null) => void;
  setPolicyModal: (value: { title: string; content: string } | null) => void;
  setCartDrawerForceOpen: (value: boolean) => void;
  dismissCrossSell: () => void;
  startListening: () => void;
  stopListening: () => void;
}

export function useConversationViewModel(
  props: ConversationViewModelProps,
): ConversationViewModelState & ConversationViewModelActions {
  const { storeName, merchantId, merchantSlug, agentName, agentGreeting, quickReplies, returnOrderId, themeMode, agentMode, agentInitialDelaySeconds } = props;
  const agent = agentName || "Assistente";
  const [mode, setMode] = useState<Mode>("intro");
  const [channel, setChannel] = useState<Channel | null>(null);
  // Theme resolution: user preference (localStorage, shared key) > merchant default > light.
  // Lazy initializer avoids a dark-mode flash before the restore effect runs.
  const [theme, setTheme] = useState<Theme>(() => {
    const merchantDefault: Theme = themeMode === "dark" || themeMode === "grey" ? "dark" : "light";
    try {
      const saved = localStorage.getItem(SHARED_THEME_KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch { /* SSR/privacy */ }
    return merchantDefault;
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
  // Set to the resolved globalUserId when a valid buyer token lets us skip the
  // OTP gate and open checkout directly. ConversationShell reacts and clears it.
  const [checkoutIntent, setCheckoutIntent] = useState<string | null>(null);
  const [policyModal, setPolicyModal] = useState<{ title: string; content: string } | null>(null);
  const [crossSellPending, setCrossSellPending] = useState<CrossSellInterstitialData | null>(null);
  const dismissCrossSell = useCallback(() => setCrossSellPending(null), []);

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
        try { sessionStorage.setItem("zyon_conversation_id", data.conversation_id); } catch {}
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
    try { localStorage.setItem(SHARED_THEME_KEY, next); } catch { /* */ }
  }, [theme, applyTheme]);

  const selectChannel = useCallback((ch: Channel) => {
    setChannel(ch);
    setMode("chat");
    try { localStorage.setItem("pulse-channel-pref", ch); } catch { /* */ }
    initConversation();

    // Greeting priority: active A/B-test message (experiment) → merchant's own
    // configured greeting → a strong persuasive fallback. The A/B greeting wins
    // so the running experiment's copy style is honored; the fallback only shows
    // when neither an experiment nor a merchant greeting exists.
    const expGreeting = experimentVM.getExperimentGreeting();
    const persuasiveFallback = `Oi! Sou ${agent}, sua vendedora pessoal aqui na ${storeName}. 💚 Me conta o que você procura — eu encontro o produto ideal, garanto o melhor preço com cupons, calculo o frete e fecho seu pedido em segundos, tudo por aqui. Bora começar?`;
    const greeting = expGreeting?.message || agentGreeting || persuasiveFallback;

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

          // Surface a cross-sell suggestion as a pre-cart interstitial (modal),
          // not just inline in the thread. Only when it accompanies a cart update
          // (add-to-cart) so it acts as the "before cart" step.
          const crossSellBlock = blocks.find((b: any) => b.type === "cross_sell" && b.data?.products?.length);
          const cartGrew = blocks.some((b: any) => b.type === "cart_summary");
          if (crossSellBlock && cartGrew) {
            setCrossSellPending(crossSellBlock.data as CrossSellInterstitialData);
            // Remove cross_sell from inline blocks so it only shows in the interstitial,
            // not duplicated in the chat body.
            const idx = blocks.indexOf(crossSellBlock);
            if (idx !== -1) blocks.splice(idx, 1);
          }

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

          // Always show agent text alongside visual blocks for immersive conversation.
          // If the LLM didn't produce text, derive narration from the first visual block.
          let agentText = data.message || undefined;
          if (!agentText && hasVisualBlock) {
            const firstVisual = blocks.find((b: any) =>
              ["product_carousel", "product_card", "cart_summary", "category_carousel", "product_comparison", "shipping_options", "marketplace_products", "cross_sell"].includes(b.type)
            );
            agentText = narrateStorefrontBlock(firstVisual?.type);
          }

          const agentMsg: Message = {
            id: `a-${Date.now()}`,
            role: "agent",
            text: agentText,
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
      if (merchantId && conversationId) {
        trackFunnelEvent(merchantId, conversationId, "checkout_intent");
      }
      // Skip OTP entirely if a valid 7-day token is already stored.
      const buyer = getValidBuyer();
      if (buyer) {
        setCheckoutIntent(buyer.globalUserId);
      } else {
        setShowBuyerAuth(true);
      }
      return;
    }
    if (lower === "aplicar cupom" && cart.itemCount === 0) {
      void sendMessage("Quero aplicar um cupom de desconto");
      return;
    }
    void sendMessage(option);
  }, [sendMessage, cart.itemCount, merchantId, conversationId]);

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
      // Theme already resolved in the lazy useState initializer (localStorage > merchant
      // default). Just apply the CSS tokens for the current value on mount.
      applyTheme(theme);
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

  // Trigger detection (idle / exit-intent) must be armed ONCE and never re-armed
  // by changing config/session, otherwise the 30s idle timer keeps resetting and
  // never completes. Read the volatile values (agentMode, widgetConfig,
  // conversationId) through refs so the effect can depend only on merchantId.
  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;
  const widgetConfigRef = useRef(widgetConfig);
  widgetConfigRef.current = widgetConfig;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  useEffect(() => {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
    const cleanup = initTriggerDetection(
      {
        enableExitIntent: true,
        enableIdleTimer: true,
        idleThresholdMs: 30000,
        apiBaseUrl: API_BASE,
        merchantId,
        // Read at fire-time so a late-arriving conversationId is still reported.
        get sessionId() { return conversationIdRef.current || undefined; },
      },
      (triggerEvent) => {
        // Activation modes are cumulative in agentiveness, not mutually exclusive:
        //   manual_only          → agent never acts on its own (no triggers)
        //   silent_until_trigger → reacts to idle/exit-intent signals
        //   proactive            → opens on its own AND still reacts to signals
        // So only manual_only suppresses triggers. In proactive the chat is already
        // open; a later idle/exit nudge is appended to keep the agent engaging
        // (still bounded by maxInterventions + cooldown below).
        const mode = agentModeRef.current;
        if (mode === "manual_only") return;

        // Frequency limits fall back to sane defaults when checkout widgetConfig
        // is absent (the storefront must not depend on checkout being configured).
        const cfg = widgetConfigRef.current;
        const maxInterventions = cfg?.maxInterventionsPerSession ?? 3;
        const cooldownMs = (cfg?.cooldownSeconds ?? 120) * 1000;

        if (getInterventionCount(merchantId || "") >= maxInterventions) return;
        if (!canFireTrigger(merchantId || "", triggerEvent, cooldownMs)) return;

        // Custom copy from checkout-settings overrides the built-in fallback when present.
        const customTrigger = cfg?.triggerMessages?.[triggerEvent];
        const nudgeText = customTrigger?.message || TRIGGER_MESSAGES[triggerEvent];
        if (!nudgeText) return;

        incrementIntervention(merchantId || "");
        recordTriggerFired(merchantId || "", triggerEvent);

        const couponSuffix = customTrigger?.couponCode
          ? ` 🎁 Use o cupom **${customTrigger.couponCode}** para um desconto especial!`
          : "";

        // Open the chat (intro → chat) if still on the hero, then append the nudge
        // so the buyer actually sees the agent reaching out.
        setMode("chat");
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: nudgeText + couponSuffix }]);
      },
    );
    return cleanup;
  }, [merchantId]);

  // Proactive activation: after a delay, auto-open the chat (intro → chat) and
  // surface the greeting. `agentMode` (from agent-rules, projected via store config)
  // is the source of truth; fire once per mount. selectChannel is read through a
  // ref so its changing identity (it depends on conversationId) does not reset the
  // timer on every render — otherwise the timeout never completes.
  const selectChannelRef = useRef(selectChannel);
  selectChannelRef.current = selectChannel;
  const initConversationRef = useRef(initConversation);
  initConversationRef.current = initConversation;
  const proactiveFiredRef = useRef(false);
  useEffect(() => {
    if (agentMode !== "proactive") return;
    if (proactiveFiredRef.current) return;
    // Pre-start the conversation immediately so the active A/B-test greeting is
    // fetched and cached before the timer fires — otherwise the proactive open
    // races the experiment fetch and falls back to the static greeting.
    initConversationRef.current();
    const delaySec = agentInitialDelaySeconds ?? 5;
    const timer = setTimeout(() => {
      proactiveFiredRef.current = true;
      // selectChannel opens the chat AND emits the experiment/merchant greeting.
      selectChannelRef.current("chat");
    }, delaySec * 1000);
    return () => clearTimeout(timer);
  }, [agentMode, agentInitialDelaySeconds]);

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
    checkoutIntent,
    setCheckoutIntent,
    policyModal,
    crossSellPending,
    dismissCrossSell,
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
