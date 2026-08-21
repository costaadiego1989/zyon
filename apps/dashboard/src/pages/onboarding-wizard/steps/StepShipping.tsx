import React from "react";
import { Truck, ExternalLink, CheckCircle2 } from "lucide-react";

interface StepShippingProps {
  apiBaseUrl: string;
  connected: boolean;
  loading: boolean;
  onConnect: () => void;
  onSkip: () => void;
}

export function StepShipping({ apiBaseUrl, connected, loading, onConnect, onSkip }: StepShippingProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>Configurar envios</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>
          Conecte sua conta do Melhor Envio para cotar fretes, gerar etiquetas e rastrear entregas automaticamente.
        </p>
      </div>

      <div style={{ padding: "20px 24px", borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--surface-2)", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 10, background: "color-mix(in srgb, var(--color-brand) 10%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Truck size={22} color="var(--color-brand)" />
        </div>

        <div style={{ flex: 1 }}>
          <strong style={{ fontSize: 14, display: "block" }}>Melhor Envio</strong>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Cotação, etiquetas e rastreio — Correios, Jadlog, Azul Cargo, Latam Cargo
          </span>
        </div>

        {connected ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--color-brand)", padding: "6px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--color-brand) 8%, transparent)" }}>
            <CheckCircle2 size={14} />
            Conectado
          </span>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--color-brand)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ExternalLink size={13} />
            {loading ? "Conectando..." : "Conectar conta"}
          </button>
        )}
      </div>

      <div style={{ padding: "14px 18px", borderRadius: 10, background: "var(--surface-1)", border: "1px solid var(--color-border)" }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--fg)" }}>Como funciona:</strong> Ao conectar, você autoriza a Zyon a cotar e comprar fretes usando <strong>sua conta</strong> no Melhor Envio. As etiquetas são cobradas na sua carteira do Melhor Envio — não na Zyon.
        </p>
      </div>

      {!connected && (
        <button
          type="button"
          onClick={onSkip}
          style={{ alignSelf: "flex-start", padding: "6px 0", background: "none", border: "none", color: "var(--color-text-muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
        >
          Pular por agora — configurar depois
        </button>
      )}
    </div>
  );
}
