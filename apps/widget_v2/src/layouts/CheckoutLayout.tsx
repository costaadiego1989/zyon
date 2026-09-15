import { NEUMORPHIC_THEME } from "../design-system/neumorphism";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { ChannelGate } from "@/components/ChannelGate";
import { ChatPanel } from "@/components/ChatPanel";
import { SmartCart } from "@/components/SmartCart";
import { DiscountBanner } from "@/components/DiscountBanner";
import { PulseAgentOrb } from "@/components/PulseAgentOrb";
import SupportFAB from "@/components/SupportFAB";
import SupportPanel from "@/components/SupportPanel";
import { ShimmerBorder } from "@/components/ShimmerBorder";
import { CampaignContactPreferences } from "@/components/CampaignContactPreferences";

export function CheckoutLayout({ forcedTheme }: { forcedTheme?: "dark" | "light" } = {}) {
  const chatColumnRef = useRef<HTMLDivElement>(null);
  const [composerOffset, setComposerOffset] = useState<number | null>(null);
  const channel = useCheckoutStore((s) => s.channel);
  const [supportOpen, setSupportOpen] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [cartDrawerClosing, setCartDrawerClosing] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 640 : true
  );

  const closeCartDrawer = useCallback(() => {
    setCartDrawerClosing(true);
    window.setTimeout(() => {
      setCartDrawerOpen(false);
      setCartDrawerClosing(false);
    }, 280);
  }, []);
  const status = useCheckoutStore((s) => s.status);
  const brand = useCheckoutStore((s) => s.brand);
  const agent = useCheckoutStore((s) => s.agent);
  const cart = useCheckoutStore((s) => s.cart);
  const activeDiscount = useCheckoutStore((s) => s.activeDiscount);
  const dismissDiscount = useCheckoutStore((s) => s.dismissDiscount);
  const resetSession = useCheckoutStore((s) => s.resetSession);
  const showBranding = useCheckoutStore((s) => s.showBranding);
  const leadRegistered = useCheckoutStore((s) => s.leadRegistered);
  const api = useCheckoutStore((s) => s.api);
  const sessionId = useCheckoutStore((s) => s.sessionId);

  // Follow the actual composer when consent details, voice controls or the
  // viewport change height. Fixed estimates let the FAB cover the send action.
  useEffect(() => {
    const column = chatColumnRef.current;
    const composer = column?.querySelector<HTMLElement>("[data-aacp-checkout-composer]");
    if (!isMobile || status !== "active" || !column || !composer) {
      setComposerOffset(null);
      return;
    }
    const measure = () => setComposerOffset(Math.max(0, Math.ceil(window.innerHeight - composer.getBoundingClientRect().top - 4)));
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(composer);
    if (composer.parentElement) observer.observe(composer.parentElement);
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, [isMobile, status, channel, showBranding]);
  const mobileActionOffset = composerOffset ?? 72 + (showBranding ? 40 : 0);

  const storeName = brand.name || "Loja";
  const agentName = showBranding ? (agent.name || "Assistente") : "Assistente da loja";
  let merchantLogoUrl: string | null = null;
  if (brand.logoUrl) {
    try {
      merchantLogoUrl = new URL(brand.logoUrl).toString();
    } catch {
      merchantLogoUrl = brand.logoUrl;
    }
  }

  const THEME_KEY = "zyon-theme";
  const merchantDefault = brand.mode === "dark" ? "dark" : "light";
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (forcedTheme === "dark" || forcedTheme === "light") return forcedTheme;
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch {}
    return merchantDefault;
  });

  useEffect(() => {
    if (forcedTheme === "dark" || forcedTheme === "light") {
      setTheme(forcedTheme);
    }
  }, [forcedTheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }, [theme]);

  const themeAttr = theme;

  useEffect(() => {
    const bodyBg = theme === "dark" ? "#0d1117" : "#e7e5df";
    document.body.style.background = bodyBg;
  }, [theme]);

  const widgetStyle: React.CSSProperties = {
    width: "100%",
    height: "100dvh",
    maxWidth: "var(--aacp-shell-max-width, 100%)",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--aacp-bg, #F7F8FA)",
    color: "var(--aacp-fg, #111827)",
    fontFamily: "inherit",
    overflow: "hidden",
  };

  const themePalette: Record<string, string> = NEUMORPHIC_THEME[theme];

  return (
    <div
      className="pulse-widget-shell"
      data-skin="pulse"
      data-theme={themeAttr}
      data-neu-theme={themeAttr}
      style={{
        ...widgetStyle,
        ...themePalette,
        "--bg": "var(--aacp-bg)",
        "--tx": "var(--aacp-fg)",
        "--mut": "var(--aacp-muted)",
        "--bd": "var(--aacp-line-strong)",
        "--card": "var(--aacp-surface)",
        "--chip": "var(--aacp-surface-2)",
        boxShadow: "none",
        borderRadius: 0,
        overflow: "hidden",
      } as React.CSSProperties}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "11px",
          padding: "12px 14px",
          borderBottom: "none",
          zIndex: 9,
          background: "var(--bg)",
          flex: "none",
        }}
      >
        <button data-neu="control"
          type="button"
          onClick={() => window.history.back()}
          title="Voltar para o site"
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--mut)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            padding: 0,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {merchantLogoUrl ? (
          <img
            src={merchantLogoUrl}
            alt={storeName}
            style={{ width: "34px", height: "34px", objectFit: "contain", flex: "none" }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: "34px", height: "34px", borderRadius: "50%", background: "var(--chip)",
              color: "var(--tx)", display: "flex", alignItems: "center", justifyContent: "center",
              flex: "none", fontSize: "13px", fontWeight: 800,
            }}
          >
            {storeName.charAt(0).toUpperCase()}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13.5px", fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {storeName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "var(--mut)", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--dot)", animation: "pulseDot 2.2s ease-in-out infinite", flex: "none" }} />
            {agentName} · Checkout
          </div>
        </div>

        <button data-neu="control"
          type="button"
          onClick={toggleTheme}
          title="Alternar tema"
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "50%",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            padding: 0,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" fill="none" stroke="var(--mut)" strokeWidth="1.8" />
            <path d="M12 3a9 9 0 0 0 0 18z" fill="var(--mut)" />
          </svg>
        </button>
      </div>

      {/* Channel Gate: FULL screen, no sidebar */}
      {status === "channel_gate" && (
        <ShimmerBorder radius={brand.borderRadius ? `${brand.borderRadius}px` : "19px"}>
          <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "var(--bg)" }}>
            <ChannelGate />
          </div>
        </ShimmerBorder>
      )}

      {/* Payment success — dedicated confirmation screen */}
      {status === "completed" && (
        <ShimmerBorder radius={brand.borderRadius ? `${brand.borderRadius}px` : "19px"}>
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "20px",
              padding: "32px",
              background: "var(--bg)",
              textAlign: "center",
            }}
          >
            <div style={{ animation: "ckoutBounce 0.6s ease infinite alternate" }}>
              <PulseAgentOrb placement="orderComplete" active />
            </div>
            <div>
              <h2 style={{ margin: "0 0 8px", fontSize: "22px", fontWeight: 700, color: "var(--tx)" }}>
                Pagamento confirmado! 🎉
              </h2>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--mut)", lineHeight: 1.5, maxWidth: "320px" }}>
                Seu pedido foi confirmado com sucesso. Acompanhe os detalhes no seu histórico de compras.
              </p>
            </div>
            <button data-neu="primary"
              type="button"
              onClick={() => {
                resetSession();
                if (typeof window !== "undefined") {
                  const returnUrl = document.referrer || "/";
                  window.location.href = returnUrl.includes("/store/") ? returnUrl : "/";
                }
              }}
              style={{
                marginTop: "8px",
                padding: "12px 28px",
                borderRadius: "12px",
                border: "none",
                background: "var(--ac, var(--aacp-accent, #0f766e))",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Voltar à loja
            </button>
            <style>{`@keyframes ckoutBounce { from { transform: translateY(0); } to { transform: translateY(-10px); } }`}</style>
          </div>
        </ShimmerBorder>
      )}

      {/* Active: split layout — chat left + smart cart right */}
      {status === "active" && (
        <ShimmerBorder radius={brand.borderRadius ? `${brand.borderRadius}px` : "19px"}>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              boxShadow: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                height: "100%",
                overflow: "hidden",
                background: "var(--bg)",
                gap: "14px",
                padding: "14px",
              }}
            >
              {/* Main content area - left side (Chat) */}
              <div ref={chatColumnRef}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {activeDiscount && (
                  <DiscountBanner
                    stage={activeDiscount.stage}
                    percent={activeDiscount.percent}
                    couponCode={activeDiscount.couponCode}
                    message={activeDiscount.message}
                    onDismiss={dismissDiscount}
                  />
                )}

                {/* ChatPanel is the MAIN UI */}
                <ChatPanel />
                {leadRegistered && <CampaignContactPreferences api={api} sessionId={sessionId} merchantName={storeName} />}
              </div>

              {/* SmartCart sidebar - desktop only */}
              {!isMobile && (
                <aside
                  className="smart-cart-sidebar"
                  style={{
                    width: "clamp(304px, 28vw, 360px)",
                    flex: "none",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    borderLeft: "1px solid var(--bd)",
                    paddingLeft: "18px",
                  }}
                >
                  <SmartCart />
                </aside>
              )}
            </div>
          </div>
        </ShimmerBorder>
      )}

      {/* Mobile actions clear the measured composer and footer. */}
      {isMobile && status === "active" && cart.items.length > 0 && (
        <button data-neu="floating"
          type="button"
          className="cart-fab-mobile"
          aria-label="Abrir carrinho"
          onClick={() => setCartDrawerOpen(true)}
          style={{
            position: "fixed",
            bottom: `${16 + mobileActionOffset + 56}px`,
            right: "16px",
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            border: "none",
            background: "var(--aacp-accent, #0f766e)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "var(--aacp-neu-floating)",
            zIndex: 999,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>
          <span data-neu="counter" style={{ position: "absolute", top: "-4px", right: "-4px", width: "18px", height: "18px", borderRadius: "50%", background: "#ef4444", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {cart.items.reduce((s, i) => s + i.quantity, 0)}
          </span>
        </button>
      )}
      {cartDrawerOpen && (
        <>
          {/* Keyframes for the bottom-sheet (same as storefront CartSheet) */}
          <style>{`
            @keyframes ckui-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
            @keyframes ckui-sheet-down { from { transform: translateY(0); } to { transform: translateY(100%); } }
            @keyframes ckui-scrim-in { from { opacity: 0; } to { opacity: 1; } }
            @keyframes ckui-scrim-out { from { opacity: 1; } to { opacity: 0; } }
          `}</style>

          {/* Scrim — fades in on open, fades out on close */}
          <div
            className="smart-cart-drawer-overlay"
            onClick={closeCartDrawer}
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.45)",
              zIndex: 1000,
              animation: `${cartDrawerClosing ? "ckui-scrim-out" : "ckui-scrim-in"} 0.2s ease both`,
            }}
          />

          {/* Bottom sheet — slides up from bottom, slides down to close */}
          <div data-neu="overlay"
            className="smart-cart-drawer"
            role="dialog"
            aria-label="Carrinho"
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              height: "clamp(420px, 64dvh, 560px)",
              maxHeight: "calc(100dvh - 16px)",
              overflow: "hidden",
              background: "var(--aacp-surface, #0f0f16)",
              borderTop: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
              borderRadius: "20px 20px 0 0",
              padding: "0 16px calc(16px + env(safe-area-inset-bottom))",
              zIndex: 1001,
              boxShadow: "0 -8px 40px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
              animation: `${cartDrawerClosing ? "ckui-sheet-down" : "ckui-sheet-up"} 0.28s cubic-bezier(0.22, 1, 0.36, 1) both`,
            }}
          >
            {/* Drag handle */}
            <div style={{ padding: "10px 0 4px", display: "flex", justifyContent: "center", cursor: "grab", touchAction: "none" }}>
              <div style={{ width: "38px", height: "4px", borderRadius: "4px", background: "var(--aacp-muted, #8b8b95)", opacity: 0.4 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--aacp-fg, #f5f5f7)" }}>Carrinho</span>
              <button data-neu="icon"
                onClick={closeCartDrawer}
                aria-label="Fechar"
                style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))", background: "transparent", color: "var(--aacp-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
              >
                ✕
              </button>
            </div>
            <SmartCart />
          </div>
        </>
      )}

      {/* Support FAB and Panel — lift above chat input + whitelabel badge on mobile */}
      {!cartDrawerOpen && <SupportFAB
        open={supportOpen}
        onToggle={() => setSupportOpen(!supportOpen)}
        bottomOffset={isMobile && status === "active" && !supportOpen
          ? mobileActionOffset
          : (!isMobile && status === "active" ? 72 + (showBranding ? 40 : 0) : (showBranding ? 40 : 0))}
        rightOffset={!isMobile && status === "active" ? "clamp(338px, calc(28vw + 40px), 400px)" : undefined}
      />}
      <SupportPanel open={supportOpen} onClose={() => setSupportOpen(false)} />

      {/* Whitelabel badge — free-plan merchants only. Accent background per brand. */}
      {showBranding && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0",
            flex: "none",
            background: "var(--aacp-accent, #0f766e)",
          }}
        >
          <a href="https://www.zyon-payments.com.br" target="_blank" rel="noreferrer" aria-label="Conheça a Zyon"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "#fff",
              letterSpacing: "0.4px",
            }}
          >
            Powered by Zyon
          </a>
        </div>
      )}

      <style>{`
        @keyframes pulseDot { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
