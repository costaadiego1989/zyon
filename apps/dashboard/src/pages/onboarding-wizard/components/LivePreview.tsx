import React from "react";
import type { ThemeDraft } from "../useOnboardingWizard.js";
import { AgentOrb } from "./AgentOrb.js";

interface LivePreviewProps {
  themeDraft: ThemeDraft;
}

export function LivePreview({ themeDraft }: LivePreviewProps) {
  const headingFontName = themeDraft.headingFont?.split(",")[0]?.trim() || "Manrope";
  const bodyFontName = themeDraft.bodyFont?.split(",")[0]?.trim() || "Inter";

  return (
    <aside className="onb-preview">
      <link
        rel="stylesheet"
        href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(headingFontName)}:wght@400;600;700&family=${encodeURIComponent(bodyFontName)}:wght@400;500;600&display=swap`}
      />
      <div className="onb-preview-frame">
        <span className="onb-preview-tag">Visualização em tempo real</span>
        <div
          className="onb-preview-live"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            padding: "28px 20px",
            background: "#0a0f0a",
            gap: 14,
            textAlign: "center",
            borderRadius: 12,
            overflow: "hidden",
            fontFamily: bodyFontName,
          }}
        >
          <AgentOrb color={themeDraft.accentColor} />
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", fontWeight: 600, letterSpacing: "0.1em", color: themeDraft.accentColor }}>
            GERENTE DE VENDAS{themeDraft.headerTitle ? ` DA ${themeDraft.headerTitle.toUpperCase()}` : ""}
          </div>
          <div style={{ fontFamily: headingFontName, fontSize: "18px", fontWeight: 700, color: "#f0fdf4", letterSpacing: "-0.02em" }}>
            Oi, eu sou a {themeDraft.agentName || "Assistente"}.
          </div>
          <div style={{ fontFamily: bodyFontName, fontSize: "12px", lineHeight: 1.5, color: "#6b7280", maxWidth: 240 }}>
            Eu cuido da sua compra do início ao fim: acho a melhor opção, aplico promoções, organizo a entrega e finalizo o pagamento com você.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 260, marginTop: 6 }}>
            {[
              { text: "Acho a melhor opção e aplico promoções", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={themeDraft.accentColor} strokeWidth="2"><path d="M12 3l1.5 4.5H18l-3.5 2.5L16 14.5 12 12l-4 2.5 1.5-4.5L6 7.5h4.5z"/></svg> },
              { text: "Calculo o frete e organizo a entrega", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={themeDraft.secondaryColor || themeDraft.accentColor} strokeWidth="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
              { text: "Pago com Pix, cartão ou crypto", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={themeDraft.secondaryColor || themeDraft.accentColor} strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
            ].map((cap) => (
              <div key={cap.text} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, background: "#111827", border: "1px solid #1f2937" }}>
                <div style={{ width: 22, height: 22, borderRadius: 5, background: `${themeDraft.accentColor}20`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {cap.icon}
                </div>
                <span style={{ fontFamily: bodyFontName, fontSize: "11px", fontWeight: 500, color: "#e5e7eb" }}>{cap.text}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, width: "100%", maxWidth: 260, padding: "11px 16px", borderRadius: 12, background: themeDraft.secondaryColor || themeDraft.accentColor, color: "#fff", fontFamily: headingFontName, fontSize: "13px", fontWeight: 600, textAlign: "center" }}>
            Começar a comprar →
          </div>
        </div>
      </div>
    </aside>
  );
}
