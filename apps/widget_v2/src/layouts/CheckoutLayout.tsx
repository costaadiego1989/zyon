import { useCallback, useEffect, useState } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { ChannelGate } from "@/components/ChannelGate";
import { ChatPanel } from "@/components/ChatPanel";
import { SmartCart } from "@/components/SmartCart";
import { DiscountBanner } from "@/components/DiscountBanner";
import { PulseAgentOrb } from "@/components/PulseAgentOrb";
import SupportFAB from "@/components/SupportFAB";
import SupportPanel from "@/components/SupportPanel";
import { ShimmerBorder } from "@/components/ShimmerBorder";

export function CheckoutLayout({ forcedTheme }: { forcedTheme?: "dark" | "light" } = {}) {
  const [supportOpen, setSupportOpen] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const status = useCheckoutStore((s) => s.status);
  const brand = useCheckoutStore((s) => s.brand);
  const agent = useCheckoutStore((s) => s.agent);
  const cart = useCheckoutStore((s) => s.cart);
  const activeDiscount = useCheckoutStore((s) => s.activeDiscount);
  const dismissDiscount = useCheckoutStore((s) => s.dismissDiscount);
  const resetSession = useCheckoutStore((s) => s.resetSession);
  const showBranding = useCheckoutStore((s) => s.showBranding);

  const storeName = brand.name || "Loja";
  const agentName = agent.name || "Assistente";
  let merchantLogoUrl: string | null = null;
  if (brand.logoUrl) {
    try {
      merchantLogoUrl = new URL(brand.logoUrl).toString();
    } catch {
      merchantLogoUrl = brand.logoUrl;
    }
  }

  // Theme priority: forcedTheme (from embedding storefront) > localStorage (shared key) > merchant default.
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

  // Follow the embedding storefront's theme when it changes (light/dark toggle).
  useEffect(() => {
    if (forcedTheme === "dark" || forcedTheme === "light") {
      setTheme(forcedTheme);
    }
  }, [forcedTheme]);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }, [theme]);

  const themeAttr = theme;

  // Sync body background with theme
  useEffect(() => {
    const bodyBg = theme === "dark" ? "#0d1117" : "#e7e5df";
    document.body.style.background = bodyBg;
  }, [theme]);

  // Widget style from brand theme
  const widgetStyle: React.CSSProperties = {
    width: "100%",
    height: "100dvh",
    maxWidth: "var(--aacp-shell-max-width, 100%)",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--bg)",
    color: "var(--tx)",
    fontFamily: "inherit",
    overflow: "hidden",
  };

  return (
    <div
      className="pulse-widget-shell"
      data-skin="pulse"
      data-theme={themeAttr}
      style={{
        ...widgetStyle,
        boxShadow: "none",
        borderRadius: 0,
        overflow: "hidden",
      }}
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
        <button
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

        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "12px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            overflow: "hidden",
            fontSize: "13px",
            fontWeight: 800,
            letterSpacing: "-.2px",
          }}
        >
          {merchantLogoUrl ? (
            <img src={merchantLogoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            storeName.charAt(0).toUpperCase()
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13.5px", fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {storeName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "var(--mut)", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--dot)", animation: "pulseDot 2.2s ease-in-out infinite", flex: "none" }} />
            {agentName} · Checkout
          </div>
        </div>

        <button
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
                Seu pedido foi confirmado com sucesso. Você receberá os detalhes por e-mail e WhatsApp.
              </p>
            </div>
            <button
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
              <div
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
                    onDismiss={dismissDiscount}
                  />
                )}

                {/* ChatPanel is the MAIN UI */}
                <ChatPanel />
              </div>

              {/* SmartCart sidebar - desktop only, drawer on mobile */}
              <aside
                className="smart-cart-sidebar"
                style={{
                  width: "280px",
                  flex: "none",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  borderLeft: "1px solid var(--bd)",
                  paddingLeft: "14px",
                }}
              >
                <SmartCart />
              </aside>
            </div>
          </div>
        </ShimmerBorder>
      )}

      {/* Mobile Cart FAB + Drawer */}
      {status === "active" && cart.items.length > 0 && (
        <button
          type="button"
          className="cart-fab-mobile"
          onClick={() => setCartDrawerOpen(true)}
          style={{
            position: "fixed",
            bottom: "80px",
            right: "16px",
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            border: "none",
            background: "var(--aacp-accent, #0f766e)",
            color: "#fff",
            cursor: "pointer",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            zIndex: 999,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>
          <span style={{ position: "absolute", top: "-4px", right: "-4px", width: "18px", height: "18px", borderRadius: "50%", background: "#ef4444", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {cart.items.reduce((s, i) => s + i.quantity, 0)}
          </span>
        </button>
      )}
      {cartDrawerOpen && (
        <>
          <div className="smart-cart-drawer-overlay" onClick={() => setCartDrawerOpen(false)} />
          <div className="smart-cart-drawer">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontSize: "15px", fontWeight: 700 }}>Carrinho</span>
              <button onClick={() => setCartDrawerOpen(false)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "var(--tx)" }}>✕</button>
            </div>
            <SmartCart />
          </div>
        </>
      )}

      {/* Support FAB and Panel */}
      <SupportFAB
        open={supportOpen}
        onToggle={() => setSupportOpen(!supportOpen)}
        cartItemCount={cart.items.length}
      />
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
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "#fff",
              letterSpacing: "0.4px",
            }}
          >
            Powered by Zyon
          </span>
        </div>
      )}

      <style>{`
        @keyframes pulseDot { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
