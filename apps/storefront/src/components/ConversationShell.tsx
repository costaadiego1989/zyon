"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import type { ConversationBlock } from "@/lib/types";
import { useWidgetConfig } from "@/lib/widget-config";
import { useCart } from "@/lib/cart-store";
import { useConversationViewModel, type Message } from "@/lib/viewmodels/useConversationViewModel";
import { getValidBuyer } from "@/lib/buyer-auth";
import BlockRenderer from "./blocks/BlockRenderer";
import { BuyerHub } from "./BuyerHub";
import { BuyerHubTrigger } from "./BuyerHubTrigger";
import SupportPanel from "./SupportPanel";
import StoriesRow from "./StoriesRow";
import CheckoutWidgetPanel from "./CheckoutWidgetPanel";
import CheckoutPanel from "./CheckoutPanel";
import BuyerAuthGate from "./BuyerAuthGate";
import { PulseAgentOrb } from "./conversation/PulseAgentOrb";
import { THEME_TOKENS, type Theme } from "./conversation/theme-tokens";

type Channel = "chat" | "voice";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

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
  themeMode,
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
  themeMode?: "dark" | "light" | "grey";
  storeSettings?: {
    social?: { instagram?: string; facebook?: string; linkedin?: string; youtube?: string; googleMaps?: string };
    company?: { cnpj?: string; razaoSocial?: string; email?: string; phone?: string; businessHours?: string; address?: { city?: string; state?: string } };
    policies?: { privacy?: string; returns?: string; terms?: string; shipping?: string };
  };
}) {
  // ─── MVVM: All logic delegated to ViewModel ───
  const vm = useConversationViewModel({
    storeName,
    merchantId,
    merchantSlug,
    agentName,
    agentGreeting,
    quickReplies,
    returnOrderId,
    themeMode,
  });

  const {
    mode, channel, theme, messages, input, isLoading, listening,
    conversationId, supportOpen, buyerHubOpen, cartDrawerForceOpen,
    showBuyerAuth, checkoutIntent, policyModal,
    selectChannel, toggleChannel, toggleTheme, sendMessage,
    handleQuickReply, handleUpdateQuantity, setInput,
    setSupportOpen, setBuyerHubOpen, setShowBuyerAuth, setCheckoutIntent, setPolicyModal,
    setCartDrawerForceOpen, startListening, stopListening,
  } = vm;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const agent = agentName || "Assistente";
  const { cart } = useCart();

  // Inline checkout state (replaces cross-origin redirect to widget app)
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [checkoutUserId, setCheckoutUserId] = useState("");

  // React to checkoutIntent from viewmodel — valid token skipped the gate, go straight to checkout
  useEffect(() => {
    if (checkoutIntent) {
      setCheckoutUserId(checkoutIntent);
      setCheckoutOpen(true);
      setCheckoutIntent(null);
    }
  }, [checkoutIntent, setCheckoutIntent]);

  // Session persistence: restore buyer session from localStorage on mount
  useEffect(() => {
    const buyerToken = localStorage.getItem("zyon_buyer_token");
    if (buyerToken && !showBuyerAuth && !checkoutUserId) {
      try {
        // Decode JWT payload to extract globalUserId
        const payload = JSON.parse(atob(buyerToken.split(".")[1]));
        const globalUserId = payload.sub || payload.globalUserId;
        if (globalUserId) {
          setCheckoutUserId(globalUserId);
        }
      } catch (err) {
        // Invalid token, clear it and force re-auth
        localStorage.removeItem("zyon_buyer_token");
      }
    }
  }, []);

  // Focus input when chat mode activates
  useEffect(() => {
    if (mode === "chat" && !isLoading) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [mode, isLoading]);

  // Analytics: track product views from blocks
  const trackedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (!m.blocks) continue;
      for (const block of m.blocks) {
        const id = `${m.id}::${block.type}`;
        if (trackedIdsRef.current.has(id)) continue;
        trackedIdsRef.current.add(id);
      }
    }
  }, [messages]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    });
  };

  // Auto-scroll + refocus input every time messages change (user sends OR LLM replies)
  useEffect(() => {
    if (messages.length === 0) return;
    scrollToBottom();
    // Refocus input after LLM response so user can type immediately
    if (!isLoading && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [messages, isLoading]);

  // Keep pinned to bottom while rendered blocks grow (product cards, carousels,
  // images loading async). A plain scroll on [messages] fires before block
  // layout settles, so also observe the thread's size and re-scroll on growth.
  useEffect(() => {
    const el = threadRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastHeight = el.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (!threadRef.current) return;
      const grew = threadRef.current.scrollHeight > lastHeight;
      lastHeight = threadRef.current.scrollHeight;
      // Only auto-scroll if the user is already near the bottom (don't yank
      // them down while they scroll up to read history).
      const nearBottom =
        threadRef.current.scrollHeight - threadRef.current.scrollTop - threadRef.current.clientHeight < 240;
      if (grew && nearBottom) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
    scrollToBottom();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const chatQuickReplies = [
    "Ver Produtos",
    "Encontrar Produto",
    "Categorias",
    "Prazo de Entrega",
    ...(cart.itemCount > 0 ? ["Ver Carrinho", "Aplicar Cupom", "Finalizar Compra"] : []),
    "Trocas e Devoluções",
    "Rastrear Pedido",
    "Meus Dados",
    "Ofertas",
  ];

  return (
    <div className="pulse-widget-shell" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, width: "100%", position: "relative", borderRadius: "19px", padding: "1.5px" }}>
      {/* Shimmer border — rotating conic gradient around entire chat container */}
      <div style={{ position: "absolute", inset: 0, borderRadius: "19px", overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: "-50%", background: "conic-gradient(from 0deg, transparent 0%, transparent 70%, var(--aacp-accent, #0f766e) 80%, transparent 90%, transparent 100%)", animation: "shimmerRotate 4s linear infinite", opacity: 0.7 }} />
        <div style={{ position: "absolute", inset: "1.5px", borderRadius: "17.5px", background: "var(--aacp-bg, #08080c)" }} />
      </div>
      {/* Static border */}
      <div style={{ position: "absolute", inset: 0, borderRadius: "19px", border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))", pointerEvents: "none", zIndex: 1 }} />
      {/* Content */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, width: "100%", borderRadius: "17.5px", overflow: "hidden", background: "var(--aacp-bg, #08080c)", zIndex: 2 }}>
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
        @keyframes shimmerRotate { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
      `}</style>

      {mode === "chat" && (
        <>
        <header style={{ display: "flex", alignItems: "center", gap: "11px", padding: "8px 14px", borderBottom: "none", zIndex: 9, background: "var(--aacp-bg)", flex: "none" }}>
          {logo && !logoError ? (
            <img
              src={logo}
              alt={storeName}
              width={80}
              height={80}
              loading="eager"
              onError={() => setLogoError(true)}
              style={{ maxWidth: "80px", maxHeight: "80px", objectFit: "contain", flex: "none" }}
            />
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
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--aacp-accent, #0f766e)", marginTop: "14px" }}>
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
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(policyModal.content) }} style={{ wordWrap: "break-word" }} />
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
            const buyer = getValidBuyer();
            if (!buyer) {
              setShowBuyerAuth(true);
              return;
            }
            setCheckoutUserId(buyer.globalUserId);
            setCheckoutOpen(true);
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
          merchantName={storeName}
          onComplete={async (globalUserId) => {
            setShowBuyerAuth(false);
            // Track login_completed funnel event
            if (merchantId && conversationId) {
              const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
              fetch(`${API_BASE}/storefront/conversations/${encodeURIComponent(conversationId)}/events`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ merchant_id: merchantId, event: "login_completed", metadata: { timestamp: new Date().toISOString() } }),
              }).catch(() => {});
            }
            setCheckoutUserId(globalUserId);
            setCheckoutOpen(true);
          }}
          onCancel={() => setShowBuyerAuth(false)}
        />
      )}

      {/* Inline Checkout Panel — replaces redirect to widget app */}
      {checkoutOpen && merchantId && (
        <CheckoutPanel
          merchantId={merchantId}
          globalUserId={checkoutUserId}
          cartRef={cart.cartId ?? undefined}
          theme={theme}
          onClose={() => setCheckoutOpen(false)}
        />
      )}
      </div>{/* end content wrapper */}
    </div>
  );
}
