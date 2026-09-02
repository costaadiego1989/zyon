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

const OWN_DELIVERY_CARRIERS = new Set(["flat-rate", "flat_rate", "flat", "own", "own-delivery", "local", "motoboy"]);
const isCarrierShipment = (carrier: string | null | undefined): boolean =>
  !!carrier && !OWN_DELIVERY_CARRIERS.has(carrier.trim().toLowerCase());

const isRealTrackingCode = (code: string | null | undefined): boolean =>
  !!code && !/^pending:/i.test(code.trim());

const carrierLabel = (carrier: string | null | undefined): string =>
  isCarrierShipment(carrier) ? carrier!.trim() : "Entrega própria";

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
      <header className="page-head">
        <div>
          <span className="eyebrow">Logística</span>
          <h1>Frete & Entregas</h1>
          <p className="page-lead">Configure transportadoras, entrega própria e gerencie envios</p>
        </div>
      </header>

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
                <td style={{ padding: "12px 16px", font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>#{(s.orderId ?? s.externalOrderId ?? s.id).slice(0, 8)}</td>
                <td style={{ padding: "12px 16px", font: "13px var(--font-sans)", color: "var(--color-text)" }}>{carrierLabel(s.carrier)}</td>
                <td style={{ padding: "12px 16px", font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>{isRealTrackingCode(s.trackingCode) ? s.trackingCode : "—"}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span style={{ padding: "3px 8px", borderRadius: 99, font: "11px var(--font-mono)", fontWeight: 600, background: s.status === "delivered" ? "var(--good-soft)" : "var(--surface-2)", color: s.status === "delivered" ? "var(--good)" : "var(--color-text-muted)" }}>
                    {s.status === "created" ? "Criado" : s.status === "sent" ? "Enviado" : s.status === "in_transit" ? "Em trânsito" : "Entregue"}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}>
                  {s.status === "created" && isCarrierShipment(s.carrier) ? (
                    <button onClick={() => vm.buyLabel(s.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-brand)", background: "transparent", color: "var(--color-brand)", font: "11px var(--font-sans)", cursor: "pointer" }}>
                      Gerar etiqueta
                    </button>
                  ) : isRealTrackingCode(s.trackingCode) ? (
                    <button onClick={() => navigator.clipboard.writeText(s.trackingCode!)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-muted)", font: "11px var(--font-sans)", cursor: "pointer" }}>
                      <Link2 size={11} /> Copiar
                    </button>
                  ) : (
                    <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Entrega própria</span>
                  )}
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
          originZip={vm.config.originZip}
        />
      </SidePanel>
    </div>
  );
}
