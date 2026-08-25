import React, { useState } from "react";
import { Package, AlertCircle, Check, Calendar, DollarSign, MapPin, Link2, Unlink2 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { useDeliveryPage } from "./useDeliveryPage.js";
import { MelhorEnvioCard } from "./components/MelhorEnvioCard.js";
import { OwnDeliveryCard } from "./components/OwnDeliveryCard.js";

export interface DeliveryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const SHIPMENT_STATUSES = [
  { value: "all", label: "Todos" },
  { value: "created", label: "Criado" },
  { value: "sent", label: "Enviado" },
  { value: "in_transit", label: "Em trânsito" },
  { value: "delivered", label: "Entregue" },
];

export function DeliveryPage(props: DeliveryPageProps) {
  const {
    config,
    loading,
    saving,
    updateMelhorEnvio,
    connectMelhorEnvio,
    updateOwnDelivery,
    shipments,
    shipmentsLoading,
    shipmentsFilter,
    setShipmentsFilter,
    loadMoreShipments,
    hasMore,
    buyLabel,
  } = useDeliveryPage();

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Logística</span>
          <h1>Frete & Entregas</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  if (loading) {
    return (
      <div className="panel" style={{ padding: "60px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
        Carregando...
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Logística</span>
          <h1>Frete & Entregas</h1>
          <p className="page-lead">Configure suas transportadoras e gerencie entregas</p>
        </div>
      </header>

      {/* Informação geral */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        font: "13px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.65,
      }}>
        <strong style={{ color: "var(--color-text)" }}>Configuração de frete:</strong>{" "}
        Ative o Melhor Envio para integração automática com transportadoras. Ou configure entregas próprias com valor fixo ou por bairro.
      </div>

      {/* Melhor Envio Card */}
      <MelhorEnvioCard
        config={config}
        saving={saving}
        onToggle={updateMelhorEnvio}
        onConnect={connectMelhorEnvio}
      />

      {/* Own Delivery Card */}
      <OwnDeliveryCard
        config={config.ownDelivery}
        saving={saving}
        onUpdate={updateOwnDelivery}
      />

      {/* Entregas Recentes */}
      <DataPanel
        title="Entregas Recentes"
        isEmpty={shipments.length === 0}
        empty={{
          icon: Package,
          title: "Nenhuma entrega registrada",
          description: "As entregas aparecerão aqui conforme forem geradas.",
        }}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>Filtrar:</span>
            <select
              value={shipmentsFilter}
              onChange={(e) => setShipmentsFilter(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                font: "12px var(--font-sans)",
                color: "var(--color-text)",
                cursor: "pointer",
              }}
            >
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <span style={{ font: "12px var(--color-text-muted)" }}>
            Total: {shipments.length} de {shipments.length}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Pedido</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Transportadora</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Rastreio</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Status</th>
                <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: i < shipments.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                  <td style={{ padding: "12px 20px", color: "var(--color-text-muted)", font: "12px var(--font-mono)" }}>#{s.orderId.slice(0, 8)}</td>
                  <td style={{ padding: "12px 20px", font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                    {s.carrier || "—"}
                  </td>
                  <td style={{ padding: "12px 20px", font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>
                    {s.trackingCode ? (
                      <span title={s.trackingCode}>{s.trackingCode.slice(0, 12)}{s.trackingCode.length > 12 ? "..." : ""}</span>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 20px" }}>
                    <span style={{
                      padding: "4px 8px",
                      borderRadius: "var(--radius-full)",
                      font: "11px var(--font-mono)",
                      fontWeight: 600,
                      background: s.status === "delivered"
                        ? "var(--color-success-bg)"
                        : s.status === "in_transit"
                          ? "var(--color-brand-subtle)"
                          : s.status === "sent"
                            ? "var(--color-brand-subtle)"
                            : "var(--surface-1)",
                      color: s.status === "delivered"
                        ? "var(--color-success)"
                        : s.status === "in_transit" || s.status === "sent"
                          ? "var(--color-brand)"
                          : "var(--color-text-muted)",
                    }}>
                      {s.status === "created" ? "Criado" : s.status === "sent" ? "Enviado" : s.status === "in_transit" ? "Em trânsito" : "Entregue"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 20px", textAlign: "right" }}>
                    {s.status === "created" ? (
                      <button
                        onClick={() => buyLabel(s.id)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--color-border)",
                          background: "var(--surface-1)",
                          cursor: "pointer",
                          font: "11px var(--font-sans)",
                          color: "var(--color-brand)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                        title="Gerar etiqueta"
                      >
                        <Package size={12} />
                        Gerar etiqueta
                      </button>
                    ) : s.trackingCode ? (
                      <button
                        onClick={() => {
                          if (s.trackingCode) navigator.clipboard.writeText(s.trackingCode);
                        }}
                        style={{
                          padding: "4px 8px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--color-border)",
                          background: "var(--surface-1)",
                          cursor: "pointer",
                          font: "11px var(--font-sans)",
                          color: "var(--color-text-muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                        title="Copiar rastreio"
                      >
                        <Link2 size={12} />
                        Copiar
                      </button>
                    ) : (
                      <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <Button
              variant="outline"
              size="sm"
              onClick={loadMoreShipments}
              disabled={shipmentsLoading}
            >
              {shipmentsLoading ? "Carregando..." : "Carregar mais"}
            </Button>
          </div>
        )}
      </DataPanel>
    </div>
  );
}
