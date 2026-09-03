import React from "react";
import { Truck, CheckCircle2 } from "lucide-react";
import { Button } from "../../../components/Button.js";

interface StepShippingProps {
  apiBaseUrl: string;
  connected: boolean;
  loading: boolean;
  onConnect: () => void;
  onSkip: () => void;
}

/**
 * Onboarding step 3 — connect Melhor Envio via OAuth so the store can quote
 * freight, buy labels and track deliveries. Optional: the merchant can skip and
 * configure it later. Matches the wizard's .onb-field card language.
 */
export function StepShipping({ connected, loading, onConnect, onSkip }: StepShippingProps) {
  return (
    <div className="onb-fields">
      <p className="onb-help">
        Conecte sua conta do Melhor Envio para cotar fretes, gerar etiquetas e
        rastrear entregas automaticamente. Você pode pular e configurar depois.
      </p>

      <div className="onb-field" style={{ padding: "var(--space-4)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--color-brand) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Truck size={20} color="var(--color-brand)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: "14px", color: "var(--color-text)", display: "block" }}>Melhor Envio</strong>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Cotação, etiquetas e rastreio — Correios, Jadlog, Azul Cargo, Latam Cargo
            </span>
          </div>
          {connected ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "12px", fontWeight: 600, color: "var(--color-success)" }}>
              <CheckCircle2 size={14} /> Conectado
            </span>
          ) : (
            <Button variant="outline" size="sm" disabled={loading} onClick={onConnect}>
              {loading ? "Conectando..." : "Conectar conta"}
            </Button>
          )}
        </div>
      </div>

      <p style={{ fontSize: "12px", color: "var(--color-text-muted)", padding: "var(--space-3)", background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--color-border)", margin: 0, lineHeight: 1.6 }}>
        <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong> ao conectar, você autoriza a
        Zyon a cotar e comprar fretes usando <strong>sua conta</strong> no Melhor Envio. As etiquetas são
        cobradas na sua carteira do Melhor Envio — não na Zyon.
      </p>

      {!connected && (
        <button
          type="button"
          onClick={onSkip}
          style={{ alignSelf: "flex-start", padding: 0, background: "none", border: "none", color: "var(--color-text-muted)", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}
        >
          Pular por agora — configurar depois
        </button>
      )}
    </div>
  );
}
