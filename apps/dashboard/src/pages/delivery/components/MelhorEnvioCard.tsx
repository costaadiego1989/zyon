import React from "react";
import { Package, CheckCircle, LogOut } from "lucide-react";
import type { DeliveryConfig } from "../../../api/endpoints/delivery.js";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { Button } from "../../../components/Button.js";

interface MelhorEnvioCardProps {
  config: DeliveryConfig;
  saving: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onConnect: () => void;
}

export function MelhorEnvioCard({
  config,
  saving,
  onToggle,
  onConnect,
}: MelhorEnvioCardProps) {
  const isConnected = config.melhorEnvioConnected;
  const isExpired = isConnected && config.melhorEnvioExpiresAt
    ? new Date(config.melhorEnvioExpiresAt) < new Date()
    : false;

  const formatDate = (date: string | null): string => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("pt-BR");
  };

  return (
    <div className="panel" style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Package size={20} color="var(--color-brand)" />
          <div>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>
              Melhor Envio
            </div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>
              Integração com transportadoras
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={config.melhorEnvioEnabled}
              onChange={(e) => onToggle(e.target.checked)}
              disabled={saving}
              style={{ cursor: saving ? "wait" : "pointer" }}
            />
            <span style={{ font: "12px var(--font-sans)", color: "var(--color-text)" }}>
              {config.melhorEnvioEnabled ? "Ativado" : "Desativado"}
            </span>
          </label>
        </div>
      </div>

      {/* Connection status */}
      <div style={{
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        background: isConnected
          ? isExpired
            ? "var(--warn-soft)"
            : "var(--good-soft)"
          : "var(--surface-1)",
        border: `1px solid ${
          isConnected
            ? isExpired
              ? "var(--warn-soft)"
              : "var(--good-soft)"
            : "var(--color-border)"
        }`,
        marginBottom: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isConnected
              ? isExpired
                ? "var(--warn)"
                : "var(--good)"
              : "var(--color-text-faint)",
            flex: "none",
          }} />
          <span style={{
            font: "12px var(--font-sans)",
            color: isConnected
              ? isExpired
                ? "var(--warn)"
                : "var(--good)"
              : "var(--color-text-muted)",
          }}>
            {isConnected ? "Conectado" : "Desconectado"}
            {isConnected && config.melhorEnvioExpiresAt && (
              <span style={{ marginLeft: 8, font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>
                • Válido até {formatDate(config.melhorEnvioExpiresAt)}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Origin ZIP */}
      {config.originZip && (
        <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", marginBottom: 4 }}>CEP DE ORIGEM</div>
          <div style={{ font: "13px var(--font-mono)", color: "var(--color-text)" }}>
            {config.originZip}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        {isConnected ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onConnect}
              style={{ flex: 1 }}
            >
              Reconectar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Disconnect action would be here
              }}
              style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <LogOut size={14} />
              Desconectar
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={onConnect}
            style={{ width: "100%" }}
          >
            Conectar Melhor Envio
          </Button>
        )}
      </div>
    </div>
  );
}
