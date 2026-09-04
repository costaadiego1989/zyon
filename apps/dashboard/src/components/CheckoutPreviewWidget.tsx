import React from "react";
import { Tag, Truck, CreditCard } from "lucide-react";
import type { MerchantTheme } from "@zyon/shared-types";
import { AgentOrb } from "../pages/onboarding-wizard/components/AgentOrb.js";

export interface CheckoutPreviewProps {
  theme: MerchantTheme;
  merchantName?: string;
}

/**
 * Reusable checkout widget preview — mirrors onboarding LivePreview.
 * Fully inline-styled (no external CSS class dependencies).
 * Reacts to ALL theme fields in real-time via props.
 */
export function CheckoutPreviewWidget({ theme, merchantName }: CheckoutPreviewProps) {
  const headingFont = (theme.fontDisplay ?? theme.fontFamily).split(",")[0]?.trim() || "Manrope";
  const bodyFont = theme.fontFamily.split(",")[0]?.trim() || "Inter";

  const widthMap: Record<string, string> = { compact: "280px", comfortable: "340px", spacious: "100%" };
  const previewWidth = widthMap[theme.density ?? "comfortable"] ?? "340px";

  // Mode-based defaults (Dark = OLED black, Grey = Notion-style slate, Light = clean white)
  const mode = theme.mode ?? "dark";
  const modeBg = mode === "light" ? "#ffffff" : mode === "grey" ? "#191919" : "#09090b";
  const modeText = mode === "light" ? "#18181b" : "#fafafa";
  const modeMuted = mode === "light" ? "#71717a" : mode === "grey" ? "#a1a1aa" : "#71717a";
  const modeSurface = mode === "light" ? "#f4f4f5" : mode === "grey" ? "#262626" : "#18181b";
  const modeBorder = mode === "light" ? "#e4e4e7" : mode === "grey" ? "#333333" : "#27272a";

  // Text color: use mode default unless user explicitly set a custom color different from the light-mode default
  const defaultLightText = "#111827";
  const textColor = (theme.textColor && theme.textColor !== defaultLightText) ? theme.textColor : modeText;
  const mutedColor = (theme.mutedTextColor && theme.mutedTextColor !== "#64748B") ? theme.mutedTextColor : modeMuted;

  // Surface/border: fall back to mode-based colors when the stored value is the light-mode default
  const defaultLightSurface = "#FFFFFF";
  const defaultLightBorder = "#D9E2EC";
  const surfaceColor = (theme.surfaceColor && theme.surfaceColor !== defaultLightSurface) ? theme.surfaceColor : modeSurface;
  const borderColor = (theme.borderColor && theme.borderColor !== defaultLightBorder) ? theme.borderColor : modeBorder;

  return (
    <div style={{ width: "100%" }}>
      <link
        rel="stylesheet"
        href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(headingFont)}:wght@400;600;700&family=${encodeURIComponent(bodyFont)}:wght@400;500;600&display=swap`}
      />
      {/* Outer frame — background image goes HERE */}
      <div style={{
        position: "relative",
        border: "1px solid var(--rule, #2a2a2a)",
        borderRadius: 14,
        padding: 16,
        overflow: "hidden",
        background: theme.backgroundImageUrl
          ? `url(${theme.backgroundImageUrl}) center/cover no-repeat`
          : "var(--card, #111)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 12, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "var(--faint, #666)" }}>
          Visualização em tempo real
        </div>
        {/* Inner widget container — solid mode color, NO background image */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            padding: "28px 20px",
            background: modeBg,
            gap: 14,
            textAlign: "center",
            borderRadius: theme.borderRadius ?? 12,
            overflow: "hidden",
            fontFamily: bodyFont,
            maxWidth: previewWidth,
            margin: "0 auto",
            transition: "max-width 0.3s ease, border-radius 0.3s ease, background 0.3s ease",
          }}
        >
          <AgentOrb color={theme.accentColor} />

          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", color: theme.accentColor, textTransform: "uppercase" as const }}>
            GERENTE DE VENDAS{merchantName ? ` DA ${merchantName.toUpperCase()}` : ""}
          </div>

          <div style={{ fontFamily: headingFont, fontSize: 18, fontWeight: 700, color: textColor, letterSpacing: "-0.02em", lineHeight: 1.3 }}>
            Oi, eu sou a {theme.agentName || "Assistente"}.
          </div>

          <div style={{ fontFamily: bodyFont, fontSize: 12, lineHeight: 1.5, color: mutedColor, maxWidth: 240 }}>
            Eu cuido da sua compra do início ao fim: acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 260, marginTop: 6 }}>
            {[
              { Icon: Tag, text: "Acho a melhor opção e aplico promoções", color: theme.accentColor },
              { Icon: Truck, text: "Calculo o frete e organizo a entrega", color: theme.secondaryColor || theme.accentColor },
              { Icon: CreditCard, text: "Pago com Pix, cartão ou crypto", color: theme.secondaryColor || theme.accentColor },
            ].map(({ Icon, text, color }) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: theme.borderRadius ?? 8, background: surfaceColor, border: `1px solid ${borderColor}`, textAlign: "left" }}>
                <div style={{ width: 22, height: 22, borderRadius: 5, background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Icon size={12} color={color} strokeWidth={2.25} />
                </div>
                <span style={{ fontFamily: bodyFont, fontSize: 11, fontWeight: 500, color: textColor }}>{text}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, width: "100%", maxWidth: 260, padding: "11px 16px", borderRadius: theme.borderRadius ?? 12, background: theme.secondaryColor || theme.accentColor, color: "#fff", fontFamily: headingFont, fontSize: 13, fontWeight: 600, textAlign: "center", transition: "background 0.2s, border-radius 0.2s" }}>
            Começar a comprar →
          </div>

          {theme.trustBadges && theme.trustBadges.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
              {theme.trustBadges.slice(0, 4).map((badge) => (
                <span key={badge} style={{ fontSize: 9, fontWeight: 600, padding: "4px 8px", borderRadius: 4, background: `${theme.successColor || "#047857"}15`, color: theme.successColor || "#047857", fontFamily: bodyFont }}>{badge}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
