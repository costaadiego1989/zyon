import React from "react";
import { Package, Link2 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { SidePanel } from "../../components/SidePanel.js";
import { useDeliveryPage } from "./useDeliveryPage.js";
import { MelhorEnvioCard } from "./components/MelhorEnvioCard.js";
import { OwnDeliveryCard, OwnDeliveryConfigPanel } from "./components/OwnDeliveryCard.js";

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
  const vm = useDeliveryPage();

  if (!props.me) {
    return (
      <div style={{ padding: "60px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
        Login necessário
      </div>
    );
  }

  if (vm.loading) {
    return (
      <div style={{ padding: "60px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
        Carregando...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase", marginBottom: 4 }}>
          Logística
        </div>
        <h1 style={{ font: "600 22px var(--font-serif)", color: "var(--color-text)", margin: 0, letterSpacing: "-0.005em" }}>
          Frete & Entregas
        </h1>
        <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", margin: "6px 0 0" }}>
          Configure transportadoras, entrega própria e gerencie envios
        </p>
      </div>

      {/* Info banner */}
      <div style={{
        padding: "14px 18px", borderRadius: 10,
        background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
        font: "13px var(--font-sans)", color: "var(--color-text)", lineHeight: 1.6,
      }}>
        <strong>Atenção:</strong> Apenas um modo pode estar ativo por vez. Ao ativar Melhor Envio, a entrega própria é desativada e vice-versa.
      </div>

      {/* Cards side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <MelhorEnvioCard
          config={vm.config}
          saving={vm.saving}
          onToggle={vm.toggleMelhorEnvio}
          onConnect={vm.connectMelhorEnvio}
        />
        <OwnDeliveryCard
          config={vm.config.ownDelivery}
          saving={vm.saving}
          onToggle={vm.toggleOwnDelivery}
          onOpenConfig={() => vm.setOwnDeliveryPanelOpen(true)}
        />
      </div>

      {/* Entregas list */}
      <DataPanel
        title="Entregas Recentes"
        isEmpty={vm.shipments.length === 0}
        empty={{
          icon: Package,
          title: "Nenhuma entrega registrada",
          description: "As entregas aparecerão aqui conforme pedidos forem concluídos.",
        }}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", justifyContent: "space-between" }}>
          <select
            value={vm.shipmentsFilter}
            onChange={(e) => vm.setShipmentsFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-1)", font: "12px var(--font-sans)", color: "var(--color-text)", cursor: "pointer" }}
          >
            {SHIPMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Pedido", "Transportadora", "Rastreio", "Status", "Ação"].map((h, i) => (
                <th key={h} style={{ textAlign: i === 4 ? "right" : "left", padding: "10px 16px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vm.shipments.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" }}>
                <td style={{ padding: "12px 16px", font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>#{s.orderId.slice(0, 8)}</td>
                <td style={{ padding: "12px 16px", font: "13px var(--font-sans)", color: "var(--color-text)" }}>{s.carrier || "—"}</td>
                <td style={{ padding: "12px 16px", font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>{s.trackingCode || "—"}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 8px", borderRadius: 99, font: "11px var(--font-mono)", fontWeight: 600, background: s.status === "delivered" ? "var(--good-soft)" : "var(--surface-2)", color: s.status === "delivered" ? "var(--good)" : "var(--color-text-muted)" }}>
                    {s.status === "created" ? "Criado" : s.status === "sent" ? "Enviado" : s.status === "in_transit" ? "Em trânsito" : "Entregue"}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  {s.status === "created" ? (
                    <button onClick={() => vm.buyLabel(s.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-brand)", background: "transparent", color: "var(--color-brand)", font: "11px var(--font-sans)", cursor: "pointer" }}>
                      Gerar etiqueta
                    </button>
                  ) : s.trackingCode ? (
                    <button onClick={() => navigator.clipboard.writeText(s.trackingCode!)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-muted)", font: "11px var(--font-sans)", cursor: "pointer" }}>
                      <Link2 size={11} /> Copiar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {vm.hasMore && (
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <Button variant="outline" size="sm" onClick={vm.loadMoreShipments} disabled={vm.shipmentsLoading}>
              {vm.shipmentsLoading ? "Carregando..." : "Carregar mais"}
            </Button>
          </div>
        )}
      </DataPanel>

      {/* Side panel for own delivery config */}
      <SidePanel
        isOpen={vm.ownDeliveryPanelOpen}
        title="Configurar Entrega Própria"
        onClose={() => vm.setOwnDeliveryPanelOpen(false)}
      >
        <OwnDeliveryConfigPanel
          config={vm.config.ownDelivery}
          saving={vm.saving}
          onSave={vm.saveOwnDeliveryConfig}
          onClose={() => vm.setOwnDeliveryPanelOpen(false)}
        />
      </SidePanel>
    </div>
  );
}
