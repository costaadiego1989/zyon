import React from "react";
import { Package, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import type { DeliveryConfig } from "../../../api/endpoints/delivery.js";

interface MelhorEnvioCardProps {
  config: DeliveryConfig;
  saving: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onConnect: () => void;
}

export function MelhorEnvioCard({ config, saving, onToggle, onConnect }: MelhorEnvioCardProps) {
  const isConnected = config.melhorEnvioConnected;
  const isExpired = isConnected && config.melhorEnvioExpiresAt
    ? new Date(config.melhorEnvioExpiresAt) < new Date()
    : false;

  return (
    <div style={{ padding: "20px 24px", borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--surface-1)" }}>
      {/* Header with toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Package size={20} color="var(--color-brand)" />
          <div>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>Melhor Envio</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>Correios, Jadlog, transportadoras</div>
          </div>
        </div>
        <ToggleSwitch checked={config.melhorEnvioEnabled} onChange={onToggle} disabled={saving} />
      </div>

      {/* Status (only shown if enabled) */}
      {config.melhorEnvioEnabled && (
        <>
          <div style={{
            padding: "12px 14px",
            borderRadius: 8,
            background: isConnected && !isExpired ? "var(--good-soft)" : "var(--surface-2, oklch(20% 0.005 145))",
            border: `1px solid ${isConnected && !isExpired ? "var(--good-soft)" : "var(--color-border)"}`,
            marginBottom: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isConnected && !isExpired ? (
                <CheckCircle size={16} color="var(--good)" />
              ) : (
                <AlertCircle size={16} color={isExpired ? "var(--warn)" : "var(--color-text-muted)"} />
              )}
              <span style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                {isConnected && !isExpired ? "Conectado" : isExpired ? "Token expirado — reconecte" : "Desconectado"}
              </span>
            </div>
            {isConnected && config.melhorEnvioExpiresAt && (
              <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-muted)", marginTop: 6, paddingLeft: 24 }}>
                Válido até: {new Date(config.melhorEnvioExpiresAt).toLocaleDateString("pt-BR")}
              </div>
            )}
          </div>

          {/* Connect/reconnect button */}
          {(!isConnected || isExpired) && (
            <button
              type="button"
              onClick={onConnect}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 16px", borderRadius: 8,
                border: "1px solid var(--color-brand)",
                background: "transparent", color: "var(--color-brand)",
                font: "600 13px var(--font-sans)", cursor: "pointer",
              }}
            >
              <ExternalLink size={14} />
              {isExpired ? "Reconectar Melhor Envio" : "Conectar Melhor Envio"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
