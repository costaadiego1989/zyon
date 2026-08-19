"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CartSummaryBlock,
  CheckoutRedirectBlock,
  ConversationBlock,
  ProductCardBlock,
  ProductCarouselBlock,
  QuickRepliesBlock,
} from "@/lib/types";
import {
  trackBeginCheckout,
  trackConversationStart,
  trackProductView,
  trackPurchase,
} from "@/lib/analytics";
import { useWidgetConfig } from "@/lib/widget-config";
import { useCart } from "@/lib/cart-store";
import { checkoutApi, cartApi } from "@/lib/api/api-client";
import { initTriggerDetection } from "@/lib/triggers";
import { getInterventionCount, incrementIntervention, canFireTrigger, recordTriggerFired } from "@/lib/intervention-tracker";
import { TRIGGER_MESSAGES } from "@/lib/trigger-messages";
import { useCheckoutExperiment } from "@/lib/useCheckoutExperiment";
import BlockRenderer from "./blocks/BlockRenderer";
import { BuyerHub } from "./BuyerHub";
import { BuyerHubTrigger } from "./BuyerHubTrigger";
import SupportPanel from "./SupportPanel";
import StoriesRow from "./StoriesRow";
import CheckoutWidgetPanel from "./CheckoutWidgetPanel";
import BuyerAuthGate from "./BuyerAuthGate";

type Message = {
  id: string;
  role: "user" | "agent";
  text?: string;
  blocks?: ConversationBlock[];
};

type Channel = "chat" | "voice";
type Theme = "dark" | "light";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

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

function PulseAgentOrb({ size = 96 }: { size?: number }) {
  const eyeW = Math.max(2, Math.round(size * 0.086));
  const eyeH = Math.max(3, Math.round(size * 0.125));
  const eyeGap = Math.max(2, Math.round(size * 0.102));
  const glowInset = -Math.max(12, Math.round(size * 0.14));
  const ringInset = -Math.max(4, Math.round(size * 0.05));

  return (
    <div aria-hidden style={{ position: "relative", width: size, height: size, flexShrink: 0, animation: "orbFloat 6s ease-in-out infinite" }}>
      <div style={{ position: "absolute", inset: ringInset, borderRadius: "50%", border: "1px solid var(--aacp-accent, #0f766e)", animation: "waveRing 2.6s ease-out infinite" }} />
      <div style={{ position: "absolute", inset: glowInset, borderRadius: "50%", background: "var(--aacp-accent, #0f766e)", filter: "blur(20px)", opacity: 0.38, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(120% 120% at 30% 25%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 42%), var(--aacp-accent, #0f766e)`, boxShadow: "inset 0 0 30px rgba(255, 255, 255, 0.28), 0 0 28px color-mix(in srgb, var(--aacp-accent, #0f766e) 50%, transparent)", zIndex: 1 }} />
      <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: `${eyeGap}px`, pointerEvents: "none", animation: "eyeLookLR 2.6s ease-in-out infinite" }}>
        <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "eyeBlink 4s ease-in-out infinite" }} />
        <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "eyeBlink 4s ease-in-out infinite", animationDelay: "0.12s" }} />
      </div>
    </div>
  );
}

function createRecognition(): any {
  if (typeof window === "undefined") return null;
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "pt-BR";
  r.continuous = false;
  r.maxAlternatives = 1;
  return r;
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pt-BR";
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

export default function ConversationShell({
  storeName,
  logo,
  returnOrderId,
  agentName,
  quickReplies,
  merchantId,
  merchantSlug,
  storeSettings,
  agentGreeting,
  initialStories,
}: {
  storeName: string;
  logo?: string;
  returnOrderId?: string;
  agentName?: string;
  agentGreeting?: string;
  quickReplies?: string[];
  merchantId?: string;
  merchantSlug?: string;
  initialStories?: any[];
  storeSettings?: {
    social?: { instagram?: string; facebook?: string; linkedin?: string; youtube?: string; googleMaps?: string };
    company?: { cnpj?: string; razaoSocial?: string; email?: string; phone?: string; businessHours?: string; address?: { city?: string; state?: string } };
    policies?: { privacy?: string; returns?: string; terms?: string; shipping?: string };
  };
}) {
  const [mode, setMode] = useState<"intro" | "chat">("intro");
  const [channel, setChannel] = useState<Channel | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [supportOpen, setSupportOpen] = useState(false);
  const [buyerHubOpen, setBuyerHubOpen] = useState(false);
  const [policyModal, setPolicyModal] = useState<{ title: string; content: string } | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const agent = agentName || "Assistente";
  const { config: widgetConfig } = useWidgetConfig();
  const { cart, updateFromBlocks, updateItemQuantity } = useCart();
  const experimentVM = useCheckoutExperiment();

  // The widgetConfig is now available to this component and can be used for trigger logic,
  // suppression rules, etc. SupportFAB handles presentation mode (position, color, delay) separately.

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
      }
    } catch { /* SSR/privacy */ }
  }, []);

  function applyTheme(t: Theme) {
    if (typeof document === "undefined") return;
    const tokens = THEME_TOKENS[t];
    for (const [key, val] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(key, val);
    }
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem("pulse-theme-pref", next); } catch { /* */ }
  }

  useEffect(() => { trackConversationStart(storeName, experimentVM.getTrackingVariantId()); }, [storeName, experimentVM.experiment]);

  useEffect(() => {
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

        const maxInterventions = 3;
        const cooldownMs = 120 * 1000; // 120 seconds

        if (getInterventionCount(merchantId || "") >= maxInterventions) return;
        if (!canFireTrigger(merchantId || "", triggerEvent, cooldownMs)) return;

        const nudgeText = TRIGGER_MESSAGES[triggerEvent];
        if (!nudgeText) return;

        incrementIntervention(merchantId || "");
        recordTriggerFired(merchantId || "", triggerEvent);

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: nudgeText,
          },
        ]);
      }
    );

    return cleanup;
  }, [merchantId, conversationId, widgetConfig]);

  // Proactive mode: auto-send nudge after initialDelaySeconds without waiting for trigger
  useEffect(() => {
    if (!widgetConfig) return;
    if (widgetConfig.mode !== "proactive") return;
    const delaySec = widgetConfig.initialDelaySeconds ?? 4;
    const delayMs = delaySec * 1000;

    const timer = setTimeout(() => {
      if (getInterventionCount(merchantId || "") >= (widgetConfig.maxInterventionsPerSession ?? 3)) return;
      incrementIntervention(merchantId || "");
      setMessages((prev) => [
        ...prev,
        {
          id: `proactive-${Date.now()}`,
          role: "agent" as const,
          text: "Oi! Vi que você está por aqui. Posso ajudar a encontrar algo ou tirar alguma dúvida?",
        },
      ]);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [widgetConfig, merchantId]);

  const trackedOrderRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!returnOrderId) return;
    if (trackedOrderRef.current === returnOrderId) return;
    trackedOrderRef.current = returnOrderId;
    trackPurchase(returnOrderId, 0);
  }, [returnOrderId]);

  const trackedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (!m.blocks) continue;
      for (const block of m.blocks) {
        const id = `${m.id}::${block.type}`;
        if (trackedIdsRef.current.has(id)) continue;
        trackedIdsRef.current.add(id);
        if (block.type === "product_card") {
          const p = (block as ProductCardBlock).data;
          trackProductView(p.id, p.name, p.price);
        } else if (block.type === "product_carousel") {
          const c = (block as ProductCarouselBlock).data;
          for (const p of c.products) trackProductView(p.id, p.name, p.price);
        } else if (block.type === "checkout_redirect") {
          trackBeginCheckout(0, 0);
        } else if (block.type === "cart_summary") {
          const cs = (block as CartSummaryBlock).data;
          trackBeginCheckout(cs.total, cs.itemCount);
        }
      }
    }
  }, [messages]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    });
  };

  useEffect(() => {
    if (mode === "chat" && !isLoading) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [mode, isLoading]);

  async function initConversation() {
    if (!merchantId || conversationId) return;
    try {
      const data = await checkoutApi.create({ merchantId });
      if (data?.conversation_id) {
        setConversationId(data.conversation_id);
        experimentVM.captureFromConversationStart({
          conversation_id: data.conversation_id,
          experiment: data.experiment || null
        });
      }
    } catch { /* fallback mode */ }
  }

  const selectChannel = (ch: Channel) => {
    setChannel(ch);
    setMode("chat");
    try { localStorage.setItem("pulse-channel-pref", ch); } catch { /* */ }
    initConversation();
    setMessages([{
      id: "welcome",
      role: "agent",
      text: `Oi! Sou ${agent}, assistente da ${storeName}. Me diz o que procura — posso buscar produtos, aplicar cupons, calcular frete e fechar pedido tudo aqui. 🛍️`,
      blocks: [{ type: "quick_replies", data: { options: quickReplies ?? ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"] } }],
    }]);
    setTimeout(() => inputRef.current?.focus(), 200);
  };

  const toggleChannel = () => {
    const next: Channel = channel === "voice" ? "chat" : "voice";
    setChannel(next);
    try { localStorage.setItem("pulse-channel-pref", next); } catch { /* */ }
    if (next === "voice") startListening();
    else stopListening();
  };

  function startListening() {
    const r = createRecognition();
    if (!r) return;
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
    scrollToBottom();
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
          // Capture experiment on lazy init too
          experimentVM.captureFromConversationStart({
            conversation_id: startData.conversation_id,
            experiment: startData.experiment || null
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
          const hasVisualBlock = data.blocks?.some((b: any) => b.type === "product_carousel" || b.type === "product_card" || b.type === "cart_summary" || b.type === "category_carousel" || b.type === "product_comparison" || b.type === "shipping_options" || b.type === "marketplace_products");
          // Inject quick replies from backend as a block
          const blocks = data.blocks ?? [];
          if (data.suggested_next?.length) {
            blocks.push({ type: "quick_replies", data: { options: data.suggested_next } });
          }

          // Update cart state from response blocks
          updateFromBlocks(blocks);

          const agentMsg: Message = {
            id: `a-${Date.now()}`,
            role: "agent",
            text: hasVisualBlock ? undefined : data.message,
            blocks,
          };
          setMessages((prev) => [...prev, agentMsg]);
          setHistory((prev) => [...prev, { role: "assistant", content: data.message }]);

          if (channel === "voice" && data.message) {
            speak(data.message);
            // Auto-listen again after speech
            setTimeout(() => startListening(), 1500);
          }
        } else {
          setMessages((prev) => [...prev, {
            id: `a-${Date.now()}`,
            role: "agent",
            text: "Desculpe, houve um erro. Tente novamente.",
          }]);
        }
      } else {
        setMessages((prev) => [...prev, {
          id: `a-${Date.now()}`,
          role: "agent",
          text: `Entendi, "${trimmed}". Deixa eu verificar para você...`,
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: "agent",
        text: "Não consegui conectar ao servidor. Verifique sua conexão.",
      }]);
    }

    setIsLoading(false);
    scrollToBottom();
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [conversationId, merchantId, history, channel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const [cartDrawerForceOpen, setCartDrawerForceOpen] = useState(false);
  const [showBuyerAuth, setShowBuyerAuth] = useState(false);

  const handleQuickReply = (option: string) => {
    // Intercept cart-related actions — open drawer directly instead of sending to LLM
    const lower = option.toLowerCase();
    if (lower === "ver carrinho" || lower === "ver meu carrinho") {
      setCartDrawerForceOpen(true);
      setTimeout(() => setCartDrawerForceOpen(false), 100);
      return;
    }
    void sendMessage(option);
  };

  // Local optimistic qty update + server sync — never touches LLM
  const handleUpdateQuantity = (variantId: string, quantity: number) => {
    updateItemQuantity(variantId, quantity);

    // Fire-and-forget server sync via api-client
    if (cart.cartId && merchantId) {
      cartApi.updateItem(cart.cartId, variantId, quantity, merchantId).catch((err) => {
        console.error("[cart] server sync failed for qty update:", err);
      });
    }
  };

  const chatQuickReplies = [
    "Ver categorias",
    "Buscar produto",
    "Calcular frete",
    "Aplicar cupom",
  ];

  return (
    <div className="pulse-widget-shell" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, width: "100%", position: "relative" }}>
      <h1 style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
        {storeName} - Loja Online
      </h1>
      <style>{`
        @keyframes orbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes waveRing { 0%{transform:scale(0.7);opacity:0.5} 100%{transform:scale(1.5);opacity:0} }
        @keyframes eyeBlink { 0%,92%,100%{transform:scaleY(1)} 96%{transform:scaleY(0.12)} }
        @keyframes eyeLookLR { 0%,100%{transform:translateX(-2.5px)} 50%{transform:translateX(2.5px)} }
        @keyframes eyeThinkUp { 0%,80%,100%{transform:translateY(0)} 20%,60%{transform:translateY(-1.5px)} }
        @keyframes bubble-in { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes dot-pulse { 0%,80%,100%{opacity:.3;transform:scale(.65)} 40%{opacity:1;transform:scale(1)} }
        @keyframes pulseDot { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes micPulse { 0%{box-shadow:0 0 0 0 rgba(255,76,108,0.5)} 100%{box-shadow:0 0 0 9px rgba(255,76,108,0)} }
        @keyframes shimmerSlide { 0%{left:-100%} 50%{left:100%} 100%{left:100%} }
      `}</style>

      {mode === "chat" && (
        <>
        <header style={{ display: "flex", alignItems: "center", gap: "11px", padding: "8px 14px", borderBottom: "none", zIndex: 9, background: "var(--aacp-bg)", flex: "none" }}>
          {logo ? (
            <img src={logo} alt={storeName} width={80} height={80} loading="eager" style={{ maxWidth: "80px", maxHeight: "80px", objectFit: "contain", flex: "none" }} />
          ) : (
            <div style={{ width: "34px", height: "34px", borderRadius: "12px", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", color: "var(--aacp-fg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", overflow: "hidden", fontSize: "13px", fontWeight: 800, letterSpacing: "-.2px" }}>
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px", borderRadius: "999px", background: "color-mix(in srgb, var(--aacp-success) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--aacp-success) 25%, transparent)" }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--aacp-success)", animation: "pulseDot 2.2s ease-in-out infinite", flex: "none" }} />
              <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--aacp-success)", letterSpacing: "0.03em" }}>Online</span>
            </div>
          </div>

          <button type="button" onClick={toggleChannel} title={channel === "voice" ? "Mudar para chat" : "Mudar para voz"} style={{ width: "30px", height: "30px", borderRadius: "50%", border: `1px solid ${channel === "voice" ? "var(--aacp-accent)" : "var(--aacp-line)"}`, background: channel === "voice" ? "color-mix(in srgb, var(--aacp-accent) 15%, transparent)" : "var(--aacp-card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
            {channel === "voice" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            )}
          </button>

          <button type="button" onClick={toggleTheme} title={theme === "dark" ? "Modo claro" : "Modo escuro"} style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--aacp-muted)" strokeWidth="1.8" /><path d="M12 3a9 9 0 0 0 0 18z" fill="var(--aacp-muted)" /></svg>
          </button>

          <BuyerHubTrigger onClick={() => setBuyerHubOpen(!buyerHubOpen)} hasNotifications={false} />

          <button type="button" onClick={() => setSupportOpen((v) => !v)} title="Suporte" style={{ width: "30px", height: "30px", borderRadius: "50%", border: `1px solid ${supportOpen ? "var(--aacp-accent)" : "var(--aacp-line)"}`, background: supportOpen ? "color-mix(in srgb, var(--aacp-accent) 12%, transparent)" : "var(--aacp-card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={supportOpen ? "var(--aacp-accent)" : "var(--aacp-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </button>

          <nav aria-label="Ações rápidas" style={{ display: "flex", gap: "6px" }}>
            {storeSettings?.social?.instagram && (
              <a href={storeSettings.social.instagram} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="Instagram"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
              </a>
            )}
            {storeSettings?.social?.facebook && (
              <a href={storeSettings.social.facebook} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="Facebook"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
              </a>
            )}
            {storeSettings?.social?.linkedin && (
              <a href={storeSettings.social.linkedin} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="LinkedIn"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>
              </a>
            )}
            {storeSettings?.social?.youtube && (
              <a href={storeSettings.social.youtube} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="YouTube"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z" /><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" /></svg>
              </a>
            )}
            {storeSettings?.social?.googleMaps && (
              <a href={storeSettings.social.googleMaps} target="_blank" rel="noopener noreferrer" style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)", flex: "none", transition: "all 0.15s", cursor: "pointer" }} title="Google Maps"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent) 12%, transparent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.background = "var(--aacp-card)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              </a>
            )}
          </nav>
        </header>
        {/* Shimmer divider */}
        <div style={{ height: "1px", position: "relative", overflow: "hidden", flex: "none" }}>
          <div style={{ position: "absolute", inset: 0, background: "var(--aacp-line)" }} />
          <div style={{ position: "absolute", top: 0, left: "-100%", width: "60%", height: "100%", background: "linear-gradient(90deg, transparent, var(--aacp-accent, #0f766e), transparent)", animation: "shimmerSlide 3s ease-in-out infinite", opacity: 0.8 }} />
        </div>

        {/* Stories Row */}
        {merchantSlug && <StoriesRow merchantSlug={merchantSlug} initialCategories={initialStories} />}
        </>
      )}

      {mode === "intro" ? (
        /* ─── INTRO STAGE ─── */
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 24px", overflowY: "auto" }}>
          <div style={{ maxWidth: "520px", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div style={{ position: "absolute", top: "-50px", left: "50%", transform: "translateX(-50%)", width: "220px", height: "220px", borderRadius: "50%", background: "var(--aacp-accent, #0f766e)", filter: "blur(80px)", opacity: 0.22, pointerEvents: "none" }} />

            <div style={{ width: "min(100%, 520px)", display: "flex", justifyContent: "center", alignItems: "center", margin: "0 auto 18px", position: "relative", zIndex: 1 }}>
              <PulseAgentOrb size={96} />
            </div>

            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", lineHeight: 1.45, letterSpacing: "2px", textTransform: "uppercase", color: "var(--aacp-muted)", marginBottom: "6px" }}>
              Gerente de vendas da {storeName}
            </div>
            <div style={{ fontSize: "27px", fontWeight: 700, letterSpacing: "-0.5px", marginBottom: "10px" }}>
              Oi, eu sou a {agent}.
            </div>
            <div style={{ fontSize: "13.5px", lineHeight: 1.55, color: "var(--aacp-muted)", maxWidth: "100%", marginBottom: "22px" }}>
              Eu cuido da sua compra do início ao fim. Acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você, passo a passo.
            </div>

            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--aacp-muted)", marginBottom: "11px" }}>
              Como você prefere comprar?
            </div>
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button type="button" onClick={() => selectChannel("chat")} style={{ flex: 1, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", borderRadius: "16px", padding: "15px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: "9px", color: "var(--aacp-fg)" }}>
                <span style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
                </span>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Por chat</span>
                <span style={{ fontSize: "10.5px", color: "var(--aacp-muted)", lineHeight: 1.3 }}>Converse digitando</span>
              </button>

              <button type="button" onClick={() => selectChannel("voice")} style={{ flex: 1, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--aacp-accent)", background: "color-mix(in srgb, var(--aacp-accent) 8%, transparent)", borderRadius: "16px", padding: "15px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: "9px", position: "relative", overflow: "hidden", color: "var(--aacp-fg)" }}>
                <span style={{ position: "absolute", top: "9px", right: "9px", fontFamily: "'Space Mono', monospace", fontSize: "7.5px", letterSpacing: ".5px", color: "var(--aacp-accent)", border: "1px solid var(--aacp-accent)", borderRadius: "5px", padding: "1px 4px" }}>IA</span>
                <span style={{ width: "38px", height: "38px", borderRadius: "11px", background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </span>
                <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Por voz</span>
                <span style={{ fontSize: "10.5px", color: "var(--aacp-muted)", lineHeight: 1.3 }}>Fale com a {agent}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ─── CHAT STAGE ─── */
        <>
          <main ref={threadRef} role="main" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 18px", display: "flex", flexDirection: "column", gap: "14px", minHeight: 0, scrollBehavior: "smooth", msOverflowStyle: "none", scrollbarWidth: "none" }}>
            {/* Welcome state — no messages yet */}
            {messages.length === 0 && !isLoading && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "16px 20px", textAlign: "center" }}>
                <PulseAgentOrb size={56} />
                <div style={{ marginTop: "4px", maxWidth: "100%", width: "100%" }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--aacp-fg)", lineHeight: 1.3, letterSpacing: "-0.3px", fontFamily: "var(--aacp-font-display, var(--aacp-font))" }}>Olá! Sou {agent} 👋</div>
                  <div style={{ fontSize: "13px", color: "var(--aacp-muted)", marginTop: "8px", lineHeight: 1.5, maxWidth: "380px", marginLeft: "auto", marginRight: "auto", fontFamily: "var(--aacp-font)", whiteSpace: "pre-line" }}>
                    {agentGreeting || "A partir de agora serei sua assistente de vendas e irei te ajudar a encontrar produtos, aplicar cupons, calcular frete e finalizar sua compra. Vamos começar!"}
                  </div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--aacp-muted)", marginTop: "14px" }}>
                    Selecione uma opção abaixo ou digite algo
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", justifyContent: "center", marginTop: "10px", paddingBottom: "8px", width: "100%" }}>
                  {(quickReplies ?? chatQuickReplies).map((label) => (
                    <button key={label} type="button" onClick={() => handleQuickReply(label)} style={{ padding: "7px 14px", borderRadius: "999px", border: "1px solid var(--aacp-line)", background: "transparent", color: "var(--aacp-muted)", fontSize: "11.5px", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s", fontFamily: "var(--aacp-font)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}
                    >{label}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => {
              if (m.role === "agent") {
                const hasProductCard = m.blocks?.some((b) => b.type === "product_card");
                const hasOnlyBlocks = !m.text && m.blocks?.length;
                const isFullWidth = hasOnlyBlocks || hasProductCard;

                if (hasProductCard) {
                  const cardBlock = m.blocks!.find((b) => b.type === "product_card")!;
                  return (
                    <div key={m.id} style={{ width: "100%", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                      <BlockRenderer block={cardBlock} onQuickReply={handleQuickReply} />
                    </div>
                  );
                }

                return (
                  <div key={m.id} style={{ display: "flex", gap: "9px", alignItems: "flex-start", maxWidth: isFullWidth ? "100%" : "min(82%, 520px)", alignSelf: "flex-start", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both", width: isFullWidth ? "100%" : undefined }}>
                    <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: `radial-gradient(120% 120% at 30% 25%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 42%), var(--aacp-accent)`, flex: "none", position: "relative", marginTop: "4px" }}>
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
                        <span style={{ width: "2px", height: "3px", borderRadius: "50%", background: "#fff" }} />
                        <span style={{ width: "2px", height: "3px", borderRadius: "50%", background: "#fff" }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 }}>
                      {m.text && <div style={{ padding: "12px 16px", borderRadius: "16px 16px 16px 4px", fontSize: "13.5px", lineHeight: 1.55, whiteSpace: "pre-wrap", background: "var(--aacp-card)", color: "var(--aacp-fg)", wordWrap: "break-word", border: "1px solid var(--aacp-line)" }}>{m.text}</div>}
                      {m.blocks?.map((block, idx) => (
                        <div key={idx} style={{ maxWidth: "100%" }}>
                          <BlockRenderer block={block} onQuickReply={handleQuickReply} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              } else {
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "min(76%, 480px)", alignSelf: "flex-end", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                    {m.text && <div style={{ padding: "11px 14px", borderRadius: "16px 16px 4px 16px", fontSize: "13.5px", lineHeight: 1.5, fontWeight: 500, whiteSpace: "pre-wrap", background: "var(--aacp-accent)", color: "#fff", wordWrap: "break-word" }}>{m.text}</div>}
                  </div>
                );
              }
            })}

            {isLoading && (
              <div style={{ display: "flex", gap: "9px", alignItems: "flex-end", alignSelf: "flex-start", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                {/* Thinking orb with eyes looking up */}
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: `radial-gradient(120% 120% at 30% 25%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 42%), var(--aacp-accent)`, flex: "none", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: "2.2px" }}>
                  {/* Left eye — looking up */}
                  <span style={{ width: "2.5px", height: "3.5px", borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(0,0,0,0.12)", animation: "eyeThinkUp 2s ease-in-out infinite", flex: "none" }} />
                  {/* Right eye — looking up */}
                  <span style={{ width: "2.5px", height: "3.5px", borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(0,0,0,0.12)", animation: "eyeThinkUp 2s ease-in-out infinite", animationDelay: "0.1s", flex: "none" }} />
                </div>
                {/* 3-dot bubble */}
                <div style={{ padding: "10px 14px", borderRadius: "16px 16px 16px 4px", background: "var(--aacp-card)", border: "1px solid var(--aacp-line)", display: "flex", gap: "3px", alignItems: "center" }}>
                  <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--aacp-muted)", animation: "dot-pulse 1.2s infinite", animationDelay: "0s" }} />
                  <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--aacp-muted)", animation: "dot-pulse 1.2s infinite", animationDelay: "0.2s" }} />
                  <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--aacp-muted)", animation: "dot-pulse 1.2s infinite", animationDelay: "0.4s" }} />
                </div>
              </div>
            )}
          </main>

          {/* Composer / Voice indicator */}
          <div style={{ padding: "9px 14px 14px", flex: "none" }}>
            {channel === "voice" && listening ? (
              /* Listening state */
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "18px" }}>
                <button type="button" onClick={stopListening} style={{ width: "56px", height: "56px", borderRadius: "50%", background: "#ff4c6c", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", animation: "micPulse 1.2s infinite" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
                <span style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>Escutando… toque para parar</span>
              </div>
            ) : channel === "voice" && !listening ? (
              /* Voice idle — tap to speak */
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "18px" }}>
                <button type="button" onClick={startListening} disabled={isLoading} style={{ width: "56px", height: "56px", borderRadius: "50%", background: "var(--aacp-accent)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: isLoading ? 0.4 : 1 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
                <span style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>Toque para falar</span>
              </div>
            ) : (
              /* Chat composer */
              <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "9px 9px 9px 15px", background: "var(--aacp-card)", border: "1px solid var(--aacp-line)", borderRadius: "14px", transition: "border-color 0.2s ease, box-shadow 0.2s ease" }} onFocus={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.boxShadow = "0 0 0 2px color-mix(in srgb, var(--aacp-accent) 20%, transparent)"; }} onBlur={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.boxShadow = "none"; }}>
                <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={isLoading ? "Aguarde..." : "Escreva sua mensagem…"} aria-label="Mensagem" disabled={isLoading} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--aacp-fg)", fontSize: "13px", padding: 0, fontFamily: "inherit" }} />
                <button type="submit" disabled={!input.trim() || isLoading} aria-label="Enviar mensagem" style={{ width: "36px", height: "36px", borderRadius: "10px", border: "none", cursor: !input.trim() || isLoading ? "not-allowed" : "pointer", background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0, opacity: !input.trim() || isLoading ? 0.4 : 1 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </form>
            )}
          </div>
        </>
      )}

      {/* Footer — CNPJ + policies */}
      {mode === "chat" && storeSettings?.company?.cnpj && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--aacp-line)", background: "var(--aacp-bg)", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap", flex: "none" }}>
          <span style={{ fontSize: "9px", color: "var(--aacp-muted)", fontFamily: "'Space Mono', monospace", letterSpacing: "0.5px" }}>
            {storeSettings.company.razaoSocial && `${storeSettings.company.razaoSocial} · `}CNPJ {storeSettings.company.cnpj}
          </span>
          {storeSettings?.policies?.privacy && (
            <button type="button" onClick={() => setPolicyModal({ title: "Política de Privacidade", content: storeSettings.policies!.privacy || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Privacidade</button>
          )}
          {storeSettings?.policies?.returns && (
            <button type="button" onClick={() => setPolicyModal({ title: "Trocas e Devoluções", content: storeSettings.policies!.returns || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Devoluções</button>
          )}
          {storeSettings?.policies?.terms && (
            <button type="button" onClick={() => setPolicyModal({ title: "Termos de Uso", content: storeSettings.policies!.terms || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Termos</button>
          )}
          {storeSettings?.policies?.shipping && (
            <button type="button" onClick={() => setPolicyModal({ title: "Política de Envio", content: storeSettings.policies!.shipping || "" })} style={{ fontSize: "9px", color: "var(--aacp-muted)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>Envio</button>
          )}
        </div>
      )}

      {/* Policy Modal */}
      {policyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "20px" }} onClick={() => setPolicyModal(null)}>
          <div style={{ background: "var(--aacp-panel-bg)", borderRadius: "16px", border: "1px solid var(--aacp-line)", maxWidth: "520px", width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--aacp-line)", flex: "none" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--aacp-fg)" }}>{policyModal.title}</h2>
              <button type="button" onClick={() => setPolicyModal(null)} style={{ width: "32px", height: "32px", borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--aacp-muted)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px", color: "var(--aacp-fg)", fontSize: "13px", lineHeight: 1.6 }}>
              {policyModal.content ? (
                <div dangerouslySetInnerHTML={{ __html: policyModal.content }} style={{ wordWrap: "break-word" }} />
              ) : (
                <p style={{ color: "var(--aacp-muted)" }}>Política não configurada</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Support FAB + Panel — only in chat mode */}
      {mode === "chat" && (
        <>
          <SupportPanel open={supportOpen} onClose={() => setSupportOpen(false)} merchantId={merchantId} agentName={agentName} />
        </>
      )}

      {/* Native Cart — FAB + lateral drawer, no iframe */}
      {mode === "chat" && (
        <CheckoutWidgetPanel
          merchantId={merchantId}
          onCheckout={async () => {
            const buyerToken = localStorage.getItem("zyon_buyer_token");
            if (!buyerToken) {
              setShowBuyerAuth(true);
              return;
            }

            const widgetBase = process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173";
            const params = new URLSearchParams();
            if (merchantId) params.set("merchantId", merchantId);
            if (cart.cartId) params.set("cartId", cart.cartId);

            // Generate real embed token via storefront API route
            try {
              const tokenRes = await fetch("/api/checkout-token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  merchant_id: merchantId,
                  cart_ref: cart.cartId,
                  allowed_origin: widgetBase,
                }),
              });
              console.log("[checkout] tokenRes status:", tokenRes.status);
              if (tokenRes.ok) {
                const data = await tokenRes.json();
                console.log("[checkout] token received:", data.embed_session_token?.slice(0, 20));
                params.set("embedToken", data.embed_session_token);
              }
            } catch (e) { console.error("[checkout] token fetch error:", e); }

            console.log("[checkout] redirecting to:", `${widgetBase}?${params.toString().slice(0, 80)}...`);
            window.location.href = `${widgetBase}?${params.toString()}`;
          }}
          onViewCart={() => setCartDrawerForceOpen(true)}
          onUpdateQty={handleUpdateQuantity}
          onRemoveItem={(variantId) => handleQuickReply(`Remover item ${variantId} do carrinho`)}
          forceOpen={cartDrawerForceOpen}
        />
      )}

      {/* Buyer Hub Panel */}
      <BuyerHub isOpen={buyerHubOpen} onClose={() => setBuyerHubOpen(false)} merchantId={merchantId} />

      {/* Buyer Auth Gate */}
      {showBuyerAuth && (
        <BuyerAuthGate
          merchantId={merchantId}
          onComplete={async () => {
            setShowBuyerAuth(false);
            // Now proceed with checkout redirect (same logic as existing onCheckout)
            const widgetBase = process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173";
            const params = new URLSearchParams();
            if (merchantId) params.set("merchantId", merchantId);
            if (cart.cartId) params.set("cartId", cart.cartId);

            try {
              const tokenRes = await fetch("/api/checkout-token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  merchant_id: merchantId,
                  cart_ref: cart.cartId,
                  allowed_origin: widgetBase,
                }),
              });
              if (tokenRes.ok) {
                const data = await tokenRes.json();
                params.set("embedToken", data.embed_session_token);
              }
            } catch (e) { console.error("[checkout] token fetch error:", e); }

            window.location.href = `${widgetBase}?${params.toString()}`;
          }}
          onCancel={() => setShowBuyerAuth(false)}
        />
      )}
    </div>
  );
}
