import React, { useEffect } from "react";
import type { MerchantTheme } from "@zyon/shared-types";

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

// Mode defaults mirror the storefront exactly (apps/storefront store/[slug]/page.tsx):
// dark/grey override the individual colors; light uses the theme's own colors.
function modeDefaults(mode: MerchantTheme["mode"]): { bg: string; fg: string; card: string; line: string; muted: string; surface: string } | null {
  switch (mode) {
    case "dark":
      return { bg: "#09090b", fg: "#fafafa", card: "rgba(255,255,255,0.05)", line: "rgba(255,255,255,0.1)", muted: "#8b8b95", surface: "#18181b" };
    case "grey":
      return { bg: "#191919", fg: "#fafafa", card: "rgba(255,255,255,0.05)", line: "rgba(255,255,255,0.1)", muted: "#a1a1aa", surface: "#262626" };
    default:
      return null; // light — use the theme's own colors
  }
}

export function ThemePreviewCard({ theme, storeName }: ThemePreviewCardProps) {
  const agent = theme.agentName?.trim() || "Assistente";
  const md = modeDefaults(theme.mode);
  useThemeFonts(theme.fontFamily, theme.fontDisplay);

  // CSS variables — same names + precedence the storefront uses: when a color mode
  // (dark/grey) is chosen it OVERRIDES the individual colors (modeDefaults ?? color);
  // in light mode the theme's own colors apply. Accent/secondary/fonts/radius always
  // come from the theme. New object every render → the preview updates in real time.
  const vars: React.CSSProperties & Record<string, string> = {
    "--aacp-accent": theme.accentColor || "#0f766e",
    "--aacp-accent-2": theme.secondaryColor || theme.accentColor || "#0f766e",
    "--aacp-bg": md?.bg ?? theme.backgroundColor ?? "#f7f8fa",
    "--aacp-fg": md?.fg ?? theme.textColor ?? "#111827",
    "--aacp-card": md?.card ?? theme.surfaceColor ?? "#ffffff",
    // Dark/grey get an elevated header surface; light forces white so the header
    // reads clean with just the subtle border-bottom separating it from the body.
    "--aacp-header-bg": md?.surface ?? "#ffffff",
    "--aacp-line": md?.line ?? theme.borderColor ?? "#e5e7eb",
    "--aacp-muted": md?.muted ?? theme.mutedTextColor ?? "#6b7280",
    "--aacp-font": theme.fontFamily || "Inter, ui-sans-serif, system-ui, sans-serif",
    "--aacp-font-display": theme.fontDisplay || theme.fontFamily || "Inter, ui-sans-serif, system-ui, sans-serif",
    "--aacp-radius": `${theme.borderRadius ?? 8}px`,
  } as React.CSSProperties & Record<string, string>;

  const initial = (storeName || "L").charAt(0).toUpperCase();

  return (
    <div
      style={{
        ...vars,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--aacp-bg)",
        color: "var(--aacp-fg)",
        fontFamily: "var(--aacp-font)",
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "var(--aacp-header-bg, var(--aacp-bg))", borderBottom: "1px solid var(--aacp-line)", flex: "none" }}>
        {theme.logoUrl ? (
          // Logo keeps its natural aspect (not forced round) — contain within a
          // fixed-height box so wordmark/rectangular logos aren't distorted.
          <img src={theme.logoUrl} alt="" style={{ height: 28, maxWidth: 120, objectFit: "contain", flex: "none" }} />
        ) : (
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--aacp-card)", border: "1px solid var(--aacp-line)", display: "flex", alignItems: "center", justifyContent: "center", font: "700 14px var(--aacp-font-display)", color: "var(--aacp-fg)", flex: "none" }}>
            {initial}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "700 14px var(--aacp-font-display)", color: "var(--aacp-fg)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{storeName || "Sua loja"}</div>
          <div style={{ fontSize: 11, color: "var(--aacp-muted)", display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--aacp-accent)", flex: "none" }} />
            {agent} · Checkout seguro
          </div>
        </div>
      </div>

      {/* Intro hero — replica of ConversationShell intro mode */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 24px", overflowY: "auto", position: "relative" }}>
        <div style={{ maxWidth: 520, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", position: "relative" }}>
          <div style={{ position: "absolute", top: -50, left: "50%", transform: "translateX(-50%)", width: 220, height: 220, borderRadius: "50%", background: "var(--aacp-accent)", filter: "blur(80px)", opacity: 0.22, pointerEvents: "none" }} />

          {/* Agent orb — same markup as the storefront PulseAgentOrb (ring + glow +
              sphere + animated eyes) so the preview matches the real store exactly. */}
          <div style={{ width: "min(100%, 520px)", display: "flex", justifyContent: "center", alignItems: "center", margin: "0 auto 18px", position: "relative", zIndex: 1 }}>
            <PreviewAgentOrb size={96} avatarUrl={theme.agentAvatarUrl} />
          </div>

          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, lineHeight: 1.45, letterSpacing: 2, textTransform: "uppercase", color: "var(--aacp-muted)", marginBottom: 6 }}>
            Gerente de vendas da {storeName || "sua loja"}
          </div>
          <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: "-0.5px", marginBottom: 10, fontFamily: "var(--aacp-font-display)" }}>
            Oi, eu sou a {agent}.
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--aacp-muted)", marginBottom: 22 }}>
            Eu cuido da sua compra do início ao fim. Acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você, passo a passo.
          </div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--aacp-muted)", marginBottom: 11 }}>
            Como você prefere comprar?
          </div>
          <div style={{ display: "flex", gap: 10, width: "100%" }}>
            <div style={{ flex: 1, border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", borderRadius: 16, padding: "15px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, color: "var(--aacp-fg)" }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Por chat</span>
              <span style={{ fontSize: 10.5, color: "var(--aacp-muted)", lineHeight: 1.3 }}>Converse digitando</span>
            </div>
            <div style={{ flex: 1, border: "1px solid var(--aacp-accent)", background: "color-mix(in srgb, var(--aacp-accent) 8%, transparent)", borderRadius: 16, padding: "15px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, position: "relative", overflow: "hidden", color: "var(--aacp-fg)" }}>
              <span style={{ position: "absolute", top: 9, right: 9, fontFamily: "'Space Mono', monospace", fontSize: 7.5, letterSpacing: ".5px", color: "var(--aacp-accent)", border: "1px solid var(--aacp-accent)", borderRadius: 5, padding: "1px 4px" }}>IA</span>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Por voz</span>
              <span style={{ fontSize: 10.5, color: "var(--aacp-muted)", lineHeight: 1.3 }}>Fale com a {agent}</span>
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
      <div style={{ position: "absolute", inset: ringInset, borderRadius: "50%", border: "1px solid var(--aacp-accent, #0f766e)", animation: "tpWaveRing 2.6s ease-out infinite" }} />
      <div style={{ position: "absolute", inset: glowInset, borderRadius: "50%", background: "var(--aacp-accent, #0f766e)", filter: "blur(20px)", opacity: 0.38, pointerEvents: "none" }} />
      {avatarUrl ? (
        <img src={avatarUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", zIndex: 1 }} />
      ) : (
        <>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(120% 120% at 30% 25%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 42%), var(--aacp-accent, #0f766e)`, boxShadow: "inset 0 0 30px rgba(255, 255, 255, 0.28), 0 0 28px color-mix(in srgb, var(--aacp-accent, #0f766e) 50%, transparent)", zIndex: 1 }} />
          <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: `${eyeGap}px`, pointerEvents: "none", animation: "tpEyeLookLR 2.6s ease-in-out infinite" }}>
            <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "tpEyeBlink 4s ease-in-out infinite" }} />
            <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "tpEyeBlink 4s ease-in-out infinite", animationDelay: "0.12s" }} />
          </div>
        </>
      )}
    </div>
  );
}
