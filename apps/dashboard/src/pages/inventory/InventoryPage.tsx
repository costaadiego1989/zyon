import React, { useState } from "react";
import { Package, AlertTriangle, DollarSign, Boxes, AlertCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { TabBar } from "../../components/TabBar.js";
import { StatCard } from "../overview/components/StatCard.js";
import { DataPanel } from "../../components/DataPanel.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Button } from "../../components/Button.js";
import { useInventoryPage } from "./useInventoryPage.js";

export interface InventoryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

type InventoryTab = "overview" | "movements" | "alerts" | "erp";

const MOVEMENT_KIND_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  ENTRY: { bg: "var(--color-success-bg)", color: "var(--color-success)", label: "Entrada" },
  EXIT: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Saída" },
  ADJUSTMENT: { bg: "var(--surface-2)", color: "var(--color-text-muted)", label: "Ajuste" },
  RESERVATION: { bg: "var(--color-brand-subtle)", color: "var(--color-brand)", label: "Reserva" },
  RELEASE: { bg: "var(--surface-2)", color: "var(--color-text-faint)", label: "Liberação" },
  TRANSFER_IN: { bg: "var(--color-brand-subtle)", color: "var(--color-brand)", label: "Transfer. entrada" },
  TRANSFER_OUT: { bg: "var(--color-warning-bg)", color: "var(--color-warning)", label: "Transfer. saída" },
};

const STOCK_STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  in_stock: { bg: "var(--color-success-bg)", color: "var(--color-success)", label: "Em estoque" },
  low_stock: { bg: "var(--color-warning-bg)", color: "var(--color-warning)", label: "Baixo" },
  out_of_stock: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Sem estoque" },
};

const ALERT_SEVERITY_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  info: { bg: "var(--surface-2)", color: "var(--color-text-muted)", label: "Info" },
  low: { bg: "var(--color-warning-bg)", color: "var(--color-warning)", label: "Baixa" },
  critical: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Crítica" },
  out: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Sem estoque" },
};

function formatCurrency(cents: number | undefined): string {
  if (!cents) return "R$ 0";
  const brl = cents / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(brl);
}

const PAGE_SIZE = 10;

export function InventoryPage(props: InventoryPageProps) {
  const vm = useInventoryPage({ me: props.me, api: undefined });
  const [tab, setTab] = useState<InventoryTab>("overview");
  const [itemPage, setItemPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Estoque</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  const summary = vm.summary ?? {};
  const totalSkus = summary.total_skus ?? 0;
  const lowStockCount = summary.low_stock_count ?? 0;
  const outOfStockCount = summary.out_of_stock_count ?? 0;
  const totalInventoryValue = summary.total_inventory_value_cents ?? 0;

  const itemStartIdx = (itemPage - 1) * PAGE_SIZE;
  const paginatedItems = vm.items.slice(itemStartIdx, itemStartIdx + PAGE_SIZE);

  const movementStartIdx = (movementPage - 1) * PAGE_SIZE;
  const paginatedMovements = vm.movements.slice(movementStartIdx, movementStartIdx + PAGE_SIZE);

  const getItemStatus = (available: number, reserved: number, lowStockThreshold: number): string => {
    if (available <= 0) return "out_of_stock";
    if (available <= lowStockThreshold) return "low_stock";
    return "in_stock";
  };

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Estoque</h1>
          <p className="page-lead">Gerenciamento centralizado de SKUs, estoque e movimentações. Rastreie em tempo real e receba alertas de ruptura.</p>
        </div>
      </header>

      {/* Explanation Card */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        font: "13px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.65,
      }}>
        <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong> Controle total do estoque por SKU com visibilidade de quantidade disponível, reservada e custo médio. O sistema avisa quando o estoque fica baixo ou quando há ruptura. Integre seus dados ERP para sincronização automática.
      </div>

      {/* KPI Stats */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard
          icon={<Package size={16} />}
          value={totalSkus}
          label="Total de SKUs"
          accent="var(--color-brand)"
        />
        <StatCard
          icon={<AlertTriangle size={16} />}
          value={lowStockCount}
          label="Estoque baixo"
          accent="var(--color-warning)"
        />
        <StatCard
          icon={<Boxes size={16} />}
          value={outOfStockCount}
          label="Sem estoque"
          accent="var(--color-error)"
        />
        <StatCard
          icon={<DollarSign size={16} />}
          value={formatCurrency(totalInventoryValue)}
          label="Valor total R$"
          accent="var(--color-success)"
        />
      </div>

      {/* Tabs */}
      <TabBar
        tabs={[
          { key: "overview", label: "Visão geral" },
          { key: "movements", label: "Movimentações" },
          { key: "alerts", label: "Alertas" },
          { key: "erp", label: "Conectores ERP" },
        ]}
        activeTab={tab}
        onTabChange={(k) => setTab(k as InventoryTab)}
      />

      {/* Tab: Visão Geral */}
      {tab === "overview" && (
        <DataPanel
          title="Produtos em estoque"
          page={itemPage}
          pageSize={PAGE_SIZE}
          total={vm.items.length}
          onPageChange={setItemPage}
          isEmpty={vm.items.length === 0}
          empty={{
            icon: Package,
            title: "Nenhum produto registrado",
            description: "Comece a adicionar SKUs ao seu catálogo de estoque.",
          }}
        >
          {vm.items.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>SKU</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Produto</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Local</th>
                    <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Disponível</th>
                    <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Reservado</th>
                    <th style={{ textAlign: "center", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Status</th>
                    <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Custo médio</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item, i) => {
                    const status = getItemStatus(item.available ?? 0, item.reserved ?? 0, item.low_stock_threshold ?? 10);
                    const statusInfo = STOCK_STATUS_COLORS[status] ?? STOCK_STATUS_COLORS.in_stock;
                    return (
                      <tr key={item.id} style={{ borderBottom: i < paginatedItems.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                        <td style={{ padding: "12px 20px", font: "600 12px var(--font-mono)", color: "var(--color-text)" }}>{item.sku ?? "—"}</td>
                        <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>{item.product_name ?? "—"}</td>
                        <td style={{ padding: "12px 20px", font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>{item.location_name ?? "—"}</td>
                        <td style={{ padding: "12px 20px", font: "600 13px var(--font-data)", color: "var(--color-text)", textAlign: "right" }}>{item.available ?? 0}</td>
                        <td style={{ padding: "12px 20px", font: "13px var(--font-data)", color: "var(--color-text-muted)", textAlign: "right" }}>{item.reserved ?? 0}</td>
                        <td style={{ padding: "12px 20px", textAlign: "center" }}>
                          <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: statusInfo.bg, color: statusInfo.color }}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 20px", font: "12px var(--font-data)", color: "var(--color-text-muted)", textAlign: "right" }}>
                          {formatCurrency(item.average_cost_cents ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataPanel>
      )}

      {/* Tab: Movimentações */}
      {tab === "movements" && (
        <DataPanel
          title="Histórico de movimentações"
          page={movementPage}
          pageSize={PAGE_SIZE}
          total={vm.movements.length}
          onPageChange={setMovementPage}
          isEmpty={vm.movements.length === 0}
          empty={{
            icon: Boxes,
            title: "Nenhuma movimentação registrada",
            description: "As movimentações de estoque aparecerão aqui conforme ocorram.",
          }}
        >
          {vm.movements.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>SKU</th>
                    <th style={{ textAlign: "center", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Tipo</th>
                    <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Qtd (+/-)</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Origem</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMovements.map((m, i) => {
                    const kindInfo = MOVEMENT_KIND_COLORS[m.kind ?? "ADJUSTMENT"] ?? MOVEMENT_KIND_COLORS.ADJUSTMENT;
                    const isIncrease = m.kind === "ENTRY" || m.kind === "RELEASE" || m.kind === "TRANSFER_IN";
                    const qtdSign = isIncrease ? "+" : "−";
                    return (
                      <tr key={m.id} style={{ borderBottom: i < paginatedMovements.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                        <td style={{ padding: "12px 20px", font: "12px var(--font-mono)", color: "var(--color-text-faint)" }}>
                          {new Date(m.created_at ?? m.createdAt).toLocaleDateString("pt-BR")}
                        </td>
                        <td style={{ padding: "12px 20px", font: "600 12px var(--font-mono)", color: "var(--color-text)" }}>{m.sku ?? "—"}</td>
                        <td style={{ padding: "12px 20px", textAlign: "center" }}>
                          <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: kindInfo.bg, color: kindInfo.color }}>
                            {kindInfo.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 20px", font: "600 13px var(--font-data)", color: kindInfo.color, textAlign: "right" }}>
                          {qtdSign}{m.quantity ?? 0}
                        </td>
                        <td style={{ padding: "12px 20px", font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>{m.source ?? "—"}</td>
                        <td style={{ padding: "12px 20px", font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>{m.reason ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataPanel>
      )}

      {/* Tab: Alertas */}
      {tab === "alerts" && (
        <DataPanel
          title="Alertas ativos"
          isEmpty={vm.alerts.length === 0}
          empty={{
            icon: AlertCircle,
            title: "Nenhum alerta ativo",
            description: "Alertas aparecerão aqui quando houver situações que exijam atenção (estoque baixo, ruptura, etc).",
          }}
        >
          {vm.alerts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {vm.alerts.map((alert, i) => {
                const severityInfo = ALERT_SEVERITY_COLORS[alert.severity ?? "info"] ?? ALERT_SEVERITY_COLORS.info;
                return (
                  <div
                    key={alert.id}
                    style={{
                      padding: "16px 20px",
                      borderBottom: i < vm.alerts.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: severityInfo.bg, color: severityInfo.color }}>
                          {severityInfo.label}
                        </span>
                        <span style={{ font: "600 12px var(--font-mono)", color: "var(--color-text)" }}>{alert.sku ?? "—"}</span>
                        <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                          {alert.available ?? 0}/{alert.threshold ?? 0} unidades
                        </span>
                      </div>
                      <p style={{ margin: 0, font: "13px var(--font-sans)", color: "var(--color-text)", lineHeight: 1.5 }}>
                        {alert.message ?? "Sem descrição"}
                      </p>
                    </div>
                    {alert.acknowledged_at == null && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => vm.acknowledgeAlert(alert.id)}
                        style={{ flexShrink: 0 }}
                      >
                        Reconhecer
                      </Button>
                    )}
                    {alert.acknowledged_at != null && (
                      <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", flexShrink: 0 }}>
                        Reconhecido
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DataPanel>
      )}

      {/* Tab: Conectores ERP */}
      {tab === "erp" && (
        <div className="panel" style={{ padding: "20px 24px" }}>
          <EmptyState
            icon={AlertCircle}
            title="Conectores ERP em breve"
            description="Em desenvolvimento: integração com Bling, Tiny e Omie para sincronização automática de estoque."
          />
        </div>
      )}
    </div>
  );
}
