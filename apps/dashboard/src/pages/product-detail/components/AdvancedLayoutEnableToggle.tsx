import React from "react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { useAdvancedLayout } from "../hooks/useAdvancedLayout.js";

/**
 * Header toggle for the "Conteúdo Avançado" section.
 *
 * Visual contract matches `PromotionSection`: a single `<label>` row with
 * ToggleSwitch + title (600 12px, color-text) + stateful subtitle
 * (11px, color-text-muted). When the merchant enables the section the
 * tabs + draft surface mount inside the same card; when disabled only
 * the toggle row stays visible.
 *
 * State lives on the shared `useAdvancedLayout` hook (per
 * merchantId+productId, persisted to localStorage) so the choice survives
 * reloads and product switches.
 */
export function AdvancedLayoutEnableToggle({
  layout,
}: {
  layout: ReturnType<typeof useAdvancedLayout>;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: layout.status === "saving" ? "not-allowed" : "pointer",
        opacity: layout.status === "saving" ? 0.6 : 1,
      }}
    >
      <ToggleSwitch
        checked={layout.enabled}
        disabled={layout.status === "saving"}
        onChange={layout.setEnabled}
      />
      <div style={{ flex: 1 }}>
        <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>
          Conteúdo avançado
        </div>
        <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>
          {layout.enabled
            ? "Blocos, FAQ, depoimentos e vídeos serão exibidos na página do produto."
            : "Ative para exibir o conteúdo avançado na loja."}
        </div>
      </div>
    </label>
  );
}
