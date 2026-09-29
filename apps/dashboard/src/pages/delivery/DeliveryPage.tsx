import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import React from "react";
import { Package, Link2 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterSelect } from "../../components/FilterToolbar.js";
import { EmptyState } from "../../components/EmptyState.js";
import { showToast } from "../../components/Toast.js";
import { Button } from "../../components/Button.js";
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
  { value: "label_generated", label: "Etiqueta gerada" },
  { value: "dispatched", label: "Despachado" },
  { value: "in_transit", label: "Em trânsito" },
  { value: "out_for_delivery", label: "Saiu para entrega" },
  { value: "delivered", label: "Entregue" },
  { value: "returned", label: "Devolvido" },
  { value: "cancelled", label: "Cancelado" },
];

const SHIPMENT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  SHIPMENT_STATUSES.filter((status) => status.value !== "all").map((status) => [status.value, status.label]),
);

function shipmentStatusLabel(status: string): string {
  return SHIPMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

function shipmentStatusColor(status: string): string {
  if (status === "delivered") return "var(--good)";
  if (status === "returned" || status === "cancelled") return "var(--color-error)";
  return "var(--color-text-muted)";
}

const OWN_DELIVERY_CARRIERS = new Set(["flat-rate", "flat_rate", "flat", "own", "own-delivery", "local", "motoboy"]);
const isCarrierShipment = (carrier: string | null | undefined): boolean =>
  !!carrier && !OWN_DELIVERY_CARRIERS.has(carrier.trim().toLowerCase());

const isRealTrackingCode = (code: string | null | undefined): boolean =>
  !!code && !/^pending:/i.test(code.trim());

const carrierLabel = (carrier: string | null | undefined): string =>
  isCarrierShipment(carrier) ? carrier!.trim() : "Entrega própria";

export function DeliveryPage(props: DeliveryPageProps) {
  const vm = useDeliveryPage();
  const unavailable = vm.shipmentsLoading || !!vm.shipmentsError;
  const header = <PageHeader title="Frete e entregas" description="Configure a entrega da loja e acompanhe os envios dos pedidos." />;
  async function copyTracking(code: string) {
    try { await navigator.clipboard.writeText(code); showToast("success", "Código de rastreio copiado"); }
    catch { showToast("error", "Não foi possível copiar. Selecione o código de rastreio e copie manualmente."); }
  }
  if (!props.me) return <div>{header}<p className="delivery-state">Entre na sua conta para configurar as entregas.</p></div>;
  if (vm.loading) return <div>{header}<p className="delivery-state" role="status">Carregando configuração de entregas…</p></div>;
  if (vm.configError) return <div>{header}<EmptyState icon={Package} title="Não foi possível carregar a configuração" description={vm.configError} action={<Button onClick={() => void vm.reloadConfig()}>Tentar novamente</Button>} /></div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    {header}
    <SetupGuide title="Como preparar as entregas" steps={[
      { title: "Escolha a modalidade", description: "Conecte o Melhor Envio ou configure a entrega própria. O frete é uma etapa necessária para preparar a loja." },
      { title: "Revise os dados", description: "Confira o endereço de origem, os preços e os prazos antes de ativar a modalidade." },
      { title: "Acompanhe os pedidos", description: "Veja o status de cada envio e copie o rastreio quando estiver disponível." },
    ]} />
    <div className="delivery-provider-grid">
      <MelhorEnvioCard config={vm.config} saving={vm.saving} onToggle={vm.toggleMelhorEnvio} onConnect={vm.connectMelhorEnvio} />
      <OwnDeliveryCard config={vm.config.ownDelivery} saving={vm.saving} onToggle={vm.toggleOwnDelivery} onOpenConfig={() => vm.setOwnDeliveryPanelOpen(true)} />
    </div>
    <DataPanel title="Entregas recentes" trailing={<FilterSelect ariaLabel="Status das entregas" value={vm.shipmentsFilter} onChange={vm.setShipmentsFilter} options={SHIPMENT_STATUSES} />}
      isEmpty={!unavailable && vm.shipments.length === 0}
      empty={{ icon: Package, title: vm.shipmentsFilter === "all" ? "Nenhuma entrega registrada" : "Nenhuma entrega com este status", description: vm.shipmentsFilter === "all" ? "Os envios dos pedidos aparecerão aqui conforme forem registrados." : "Escolha outro status ou veja todas as entregas.", action: vm.shipmentsFilter !== "all" ? <Button variant="outline" onClick={() => vm.setShipmentsFilter("all")}>Ver todas as entregas</Button> : undefined }}
      page={vm.shipmentsPage} pageSize={vm.shipmentsPageSize} total={unavailable ? 0 : vm.shipmentsTotal} onPageChange={vm.setShipmentsPage}>
      {vm.shipmentsLoading ? <p className="delivery-state" role="status">Carregando entregas…</p> : vm.shipmentsError ? <EmptyState icon={Package} title="Não foi possível carregar as entregas" description="Tente novamente para consultar os envios da loja." action={<Button variant="outline" onClick={vm.reloadShipments}>Tentar novamente</Button>} /> : <div className="delivery-table-scroll" tabIndex={0} role="region" aria-label="Lista de entregas">
        <table className="delivery-table"><thead><tr>{["Pedido", "Transportadora", "Rastreio", "Status", "Ação"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{vm.shipments.map(shipment => <tr key={shipment.id}>
            <td>#{(shipment.orderId ?? shipment.externalOrderId ?? shipment.id).slice(0, 8)}</td>
            <td>{carrierLabel(shipment.carrier)}</td><td>{isRealTrackingCode(shipment.trackingCode) ? shipment.trackingCode : "—"}</td>
            <td><span style={{ color: shipmentStatusColor(shipment.status) }}>{shipmentStatusLabel(shipment.status)}</span></td>
            <td>{isRealTrackingCode(shipment.trackingCode) ? <Button variant="outline" size="sm" onClick={() => void copyTracking(shipment.trackingCode!)} aria-label={"Copiar rastreio " + shipment.trackingCode}><Link2 size={14} /> Copiar</Button> : <span>{isCarrierShipment(shipment.carrier) ? "Aguardando rastreio" : "Entrega própria"}</span>}</td>
          </tr>)}</tbody></table>
      </div>}
    </DataPanel>
    {vm.ownDeliveryPanelOpen && <OwnDeliveryConfigPanel config={vm.config.ownDelivery} saving={vm.saving} onSave={vm.saveOwnDeliveryConfig} onClose={() => vm.setOwnDeliveryPanelOpen(false)} originZip={vm.config.originZip} />}
  </div>;
}
