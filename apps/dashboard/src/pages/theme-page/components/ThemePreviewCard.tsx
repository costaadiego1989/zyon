import React, { useEffect } from "react";
import { type MerchantTheme } from "@zyon/shared-types";
import { themePreviewTokens } from "../theme-preview-palette.js";
import "../theme-preview.css";

// First family token of a CSS font stack, e.g. "Poppins, Inter, sans-serif" → "Poppins".
function primaryFamily(stack?: string): string | null {
  if (!stack) return null;
  const first = stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  if (!first || /^(ui-|system|sans-serif|serif|monospace|-apple)/i.test(first)) return null;
  return first;
}

/**
 * Loads the theme's chosen Google Fonts so the preview actually renders in them
 * (the dashboard only bundles its own UI fonts, so a picked font would otherwise
 * fall back to the stack). Mirrors the storefront's font-link injection.
 */
function useThemeFonts(fontFamily?: string, fontDisplay?: string) {
  useEffect(() => {
    const families = [primaryFamily(fontFamily), primaryFamily(fontDisplay)].filter(Boolean) as string[];
    const unique = [...new Set(families)];
    if (unique.length === 0) return;
    const href = `https://fonts.googleapis.com/css2?${unique.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`).join("&")}&display=swap`;
    const id = "theme-preview-fonts";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, [fontFamily, fontDisplay]);
}

/**
 * Live theme preview — a native React replica of the storefront intro screen
 * (apps/storefront ConversationShell "intro" mode). It renders the agent hero
 * ("Oi, eu sou …" + Por chat / Por voz) driven entirely by CSS variables mapped
 * from the theme being edited, so changing any color / font / radius updates the
 * preview in real time. No iframe, no widget bundle — deterministic and always on
 * the initial screen (the widget-in-iframe preview collapsed to a black body in
 * embed mode because its IntroStage is position:absolute inside a 0-height frame).
 *
 * The CSS-var mapping mirrors apps/storefront/src/app/store/[slug]/page.tsx so the
 * preview matches the real store.
 */
export interface ThemePreviewCardProps {
  theme: MerchantTheme;
  storeName: string;
}

export function ThemePreviewCard({ theme, storeName }: ThemePreviewCardProps) {
  const agent = theme.agentName?.trim() || "Assistente";
  useThemeFonts(theme.fontFamily, theme.fontDisplay);
  const tokens = themePreviewTokens(theme);
  const vars = tokens as React.CSSProperties;

  const initial = (storeName || "L").charAt(0).toUpperCase();

  return (
    <div data-testid="theme-preview-frame" className="theme-preview-frame">
    <div
      data-testid="theme-preview"
      className="theme-preview-canvas"
      data-density={theme.density ?? "comfortable"}
      data-preview-mode={theme.mode ?? "light"}
      style={{
        ...vars,
        colorScheme: theme.mode === "light" || !theme.mode ? "light" : "dark",
        width: "100%",
        maxWidth: "var(--theme-preview-shell-max-width)",
        margin: "0 auto",
        borderRadius: "var(--theme-preview-radius)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--theme-preview-bg)",
        backgroundImage: theme.backgroundImageUrl ? `url(${JSON.stringify(theme.backgroundImageUrl)})` : undefined,
        backgroundSize: "cover",
        color: "var(--theme-preview-fg)",
        fontFamily: "var(--theme-preview-font)",
        overflow: "hidden",
      }}
    >
      {/* Orb animations — same keyframes the storefront defines inline. */}
      <style>{`
        @keyframes tpOrbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes tpWaveRing { 0%{transform:scale(0.7);opacity:0.5} 100%{transform:scale(1.5);opacity:0} }
        @keyframes tpEyeBlink { 0%,92%,100%{transform:scaleY(1)} 96%{transform:scaleY(0.12)} }
        @keyframes tpEyeLookLR { 0%,100%{transform:translateX(-2.5px)} 50%{transform:translateX(2.5px)} }
      `}</style>
      {/* Header — matches the storefront chrome (avatar + store + agent · Checkout seguro) */}
      <div className="theme-preview-header" style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "var(--theme-preview-header-bg, var(--theme-preview-bg))", borderBottom: "1px solid var(--theme-preview-line)", flex: "none" }}>
        {theme.logoUrl ? (
          // Logo keeps its natural aspect (not forced round) — contain within a
          // fixed-height box so wordmark/rectangular logos aren't distorted.
          <img data-testid="theme-preview-logo" src={theme.logoUrl} alt="Logo da loja" style={{ height: 28, maxWidth: 100, objectFit: "contain", flex: "none" }} />
        ) : (
          <div style={{ width: 34, height: 34, borderRadius: "var(--theme-preview-radius)", background: "var(--theme-preview-card)", border: "1px solid var(--theme-preview-line)", display: "flex", alignItems: "center", justifyContent: "center", font: "700 14px var(--theme-preview-font-display)", color: "var(--theme-preview-fg)", flex: "none" }}>
            {initial}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="theme-preview-store" style={{ font: "700 14px var(--theme-preview-font-display)", color: "var(--theme-preview-fg)", lineHeight: 1.4, overflowWrap: "anywhere" }}>{storeName || "Sua loja"}</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--theme-preview-muted)", display: "flex", alignItems: "center", gap: 5, marginTop: 1, overflowWrap: "anywhere" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--theme-preview-accent)", flex: "none" }} />
            {agent} · Checkout seguro
          </div>
        </div>
      </div>

      {/* Intro hero — replica of ConversationShell intro mode */}
      <div className="theme-preview-body">
        <div className="theme-preview-intro">

          {/* Agent orb — same markup as the storefront PulseAgentOrb (ring + glow +
              sphere + animated eyes) so the preview matches the real store exactly. */}
          <div style={{ width: "min(100%, 520px)", display: "flex", justifyContent: "center", alignItems: "center", margin: "0 auto 18px", position: "relative", zIndex: 1 }}>
            <PreviewAgentOrb size={96} avatarUrl={theme.agentAvatarUrl} />
          </div>

          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--theme-preview-muted)", marginBottom: 8 }}>
            Gerente de vendas da {storeName || "sua loja"}
          </div>
          <div className="theme-preview-greeting" style={{ fontSize: 26, lineHeight: 1.2, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 12, fontFamily: "var(--theme-preview-font-display)", overflowWrap: "anywhere" }}>
            Oi, eu sou a {agent}.
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--theme-preview-muted)", marginBottom: 22 }}>
            Eu cuido da sua compra do início ao fim. Acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você, passo a passo.
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, fontWeight: 600, color: "var(--theme-preview-muted)", marginBottom: 12 }}>
            Como você prefere comprar?
          </div>
          <div className="theme-preview-choices">
            <div data-testid="theme-preview-chat" className="theme-preview-choice" style={{ border: "1px solid var(--theme-preview-line)", background: "var(--theme-preview-card)", borderRadius: "var(--theme-preview-radius)", padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, color: "var(--theme-preview-fg)" }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--theme-preview-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Por chat</span>
              <span style={{ fontSize: 12, color: "var(--theme-preview-muted)", lineHeight: 1.4 }}>Converse digitando</span>
            </div>
            <div data-testid="theme-preview-voice" className="theme-preview-choice" style={{ border: "1px solid var(--theme-preview-accent)", background: "var(--theme-preview-card)", borderRadius: "var(--theme-preview-radius)", padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, position: "relative", overflow: "hidden", color: "var(--theme-preview-fg)" }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--theme-preview-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Por voz</span>
              <span style={{ fontSize: 12, color: "var(--theme-preview-muted)", lineHeight: 1.4 }}>Fale com a {agent}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

/**
 * Exact replica of apps/storefront PulseAgentOrb (ring + glow + sphere + animated
 * eyes), using the theme-preview-scoped keyframes. Kept in this file so the preview
 * has no cross-app import.
 */
function PreviewAgentOrb({ size = 96, avatarUrl }: { size?: number; avatarUrl?: string }) {
  const eyeW = Math.max(2, Math.round(size * 0.086));
  const eyeH = Math.max(3, Math.round(size * 0.125));
  const eyeGap = Math.max(2, Math.round(size * 0.102));
  const glowInset = -Math.max(12, Math.round(size * 0.14));
  const ringInset = -Math.max(4, Math.round(size * 0.05));

  return (
    <div aria-hidden style={{ position: "relative", width: size, height: size, flexShrink: 0, animation: "tpOrbFloat 6s ease-in-out infinite" }}>
      <div style={{ position: "absolute", inset: ringInset, borderRadius: "50%", border: "1px solid var(--theme-preview-accent, #0f766e)", animation: "tpWaveRing 2.6s ease-out infinite" }} />
      <div style={{ position: "absolute", inset: glowInset, borderRadius: "50%", background: "var(--theme-preview-accent, #0f766e)", filter: "blur(20px)", opacity: 0.38, pointerEvents: "none" }} />
      {avatarUrl ? (
        <img data-testid="theme-preview-avatar" src={avatarUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", zIndex: 1 }} />
      ) : (
        <>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(120% 120% at 30% 25%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 42%), var(--theme-preview-accent, #0f766e)`, boxShadow: "inset 0 0 30px rgba(255, 255, 255, 0.28), 0 0 28px color-mix(in srgb, var(--theme-preview-accent, #0f766e) 50%, transparent)", zIndex: 1 }} />
          <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: `${eyeGap}px`, pointerEvents: "none", animation: "tpEyeLookLR 2.6s ease-in-out infinite" }}>
            <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "tpEyeBlink 4s ease-in-out infinite" }} />
            <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "tpEyeBlink 4s ease-in-out infinite", animationDelay: "0.12s" }} />
          </div>
        </>
      )}
    </div>
  );
}
