import React, { useState, useRef, useMemo } from "react";
import {
  CheckCircle,
  DollarSign,
  Download,
  Package,
  Receipt,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState.js";
import { StatCard } from "./overview/components/StatCard.js";
import type { MerchantProfile, TenantOrder } from "../api-client.js";
import { useOrdersShipmentsPage } from "./orders-shipments/useOrdersShipmentsPage.js";
import { Button } from "../components/Button.js";
import { showToast } from "../components/Toast.js";
import { STATUS_LABELS, formatMinor, formatDate, formatPhone } from "./orders-shipments/utils.js";
import { OrderStatusBadge } from "./orders-shipments/components/OrderStatusBadge.js";
import { FilterToolbar } from "../components/FilterToolbar.js";

export { STATUS_LABELS, computeOrderMetrics, filterOrders } from "./orders-shipments/utils.js";

// ── Kanban Column Definitions ───────────────────────────────────────────────

type KanbanColumnDef = {
  id: string;
  label: string;
  statuses: string[];
  color: string;
  acceptsFrom: string[];
};

const KANBAN_COLUMNS: KanbanColumnDef[] = [
  { id: "pending", label: "Aguardando", statuses: ["pending", "processing"], color: "var(--color-warning)", acceptsFrom: [] },
  { id: "paid", label: "Pago", statuses: ["paid", "approved"], color: "var(--color-brand)", acceptsFrom: ["pending", "processing"] },
  { id: "shipped", label: "Enviado", statuses: ["shipped"], color: "oklch(70% 0.14 250)", acceptsFrom: ["paid", "approved"] },
  { id: "delivered", label: "Entregue", statuses: ["delivered"], color: "var(--color-success)", acceptsFrom: ["shipped"] },
  { id: "cancelled", label: "Cancelado", statuses: ["cancelled", "failed", "refunded", "returned"], color: "var(--color-error)", acceptsFrom: ["pending", "approved", "processing", "paid"] },
];

function getColumnForStatus(status: string): string {
  for (const col of KANBAN_COLUMNS) {
    if (col.statuses.includes(status)) return col.id;
  }
  return "pending";
}

function canDrop(fromStatus: string, toColumnId: string): boolean {
  const col = KANBAN_COLUMNS.find((c) => c.id === toColumnId);
  if (!col) return false;
  return col.acceptsFrom.includes(fromStatus);
}

// ── Page Component ──────────────────────────────────────────────────────────

export function OrdersShipmentsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Pedidos e Envios</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }
  return <OrdersShipmentsView me={props.me} />;
}

function OrdersShipmentsView({ me }: { me: MerchantProfile }) {
  const vm = useOrdersShipmentsPage({ me });
  const [draggedOrder, setDraggedOrder] = useState<TenantOrder | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [period, setPeriod] = useState<"all" | "today" | "7d" | "15d" | "30d">("all");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: "", to: "" });

  const filteredOrders = useMemo(() => {
    let result = vm.orders;

    // Preset period filter (relative to now)
    if (period !== "all") {
      const days = period === "today" ? 0 : period === "7d" ? 7 : period === "15d" ? 15 : 30;
      const cutoff = new Date();
      if (period === "today") cutoff.setHours(0, 0, 0, 0);
      else cutoff.setDate(cutoff.getDate() - days);
      const cutoffIso = cutoff.toISOString();
      result = result.filter((o) => o.completed_at >= cutoffIso);
    }

    // Custom date range (overrides/combines with preset)
    if (dateRange.from) result = result.filter((o) => o.completed_at >= dateRange.from);
    if (dateRange.to) result = result.filter((o) => o.completed_at <= dateRange.to + "T23:59:59");

    return result;
  }, [vm.orders, period, dateRange]);

  function handleDragStart(e: React.DragEvent, order: TenantOrder) {
    setDraggedOrder(order);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", order.id);
  }

  function handleDragEnd() {
    setDraggedOrder(null);
    setDropTarget(null);
  }

  function handleDragOver(e: React.DragEvent, columnId: string) {
    if (!draggedOrder) return;
    if (!canDrop(draggedOrder.status, columnId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(columnId);
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  function handleDrop(e: React.DragEvent, columnId: string) {
    e.preventDefault();
    setDropTarget(null);
    if (!draggedOrder) return;
    if (!canDrop(draggedOrder.status, columnId)) return;

    const targetStatus = columnId === "pending" ? "pending" : columnId;
    const col = KANBAN_COLUMNS.find((c) => c.id === columnId);
    void vm.changeOrderStatus(draggedOrder, targetStatus);
    showToast("success", `Pedido #${draggedOrder.external_order_id.slice(-6)} → ${col?.label ?? targetStatus}`);
    setDraggedOrder(null);
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Pedidos e Envios</h1>
          <p className="page-lead">Arraste os cards entre colunas para atualizar o status do pedido</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => vm.exportCsv()}>
          <Download size={14} /> CSV
        </Button>
      </header>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
        <StatCard label="Pedidos" value={vm.hasLoaded ? vm.metrics.totalOrders : 0} icon={<ShoppingCart size={16} />} />
        <StatCard label="Aprovados" value={vm.hasLoaded ? Math.round(vm.metrics.approvalRate * 100) + "%" : "0%"} icon={<CheckCircle size={16} />} accent="var(--color-success)" />
        <StatCard label="Receita" value={vm.hasLoaded ? formatMinor(vm.metrics.totalRevenue, "BRL") : "R$ 0"} icon={<DollarSign size={16} />} accent="var(--color-brand)" />
        <StatCard label="Rastreados" value={vm.hasLoaded ? vm.metrics.trackedCount : 0} icon={<Truck size={16} />} />
        <StatCard label="Ticket Médio" value={vm.hasLoaded ? formatMinor(vm.metrics.averageOrderValue, "BRL") : "R$ 0"} icon={<Receipt size={16} />} />
      </div>

      {vm.message ? <div className="panel-error">{vm.message}</div> : null}

      {/* Period presets + custom date range — aligned to kanban width */}
      <FilterToolbar
        tabs={[
          { key: "all", label: "Todos" },
          { key: "today", label: "Hoje" },
          { key: "7d", label: "Últimos 7 dias" },
          { key: "15d", label: "Últimos 15 dias" },
          { key: "30d", label: "Últimos 30 dias" },
        ]}
        activeTab={period}
        onTabChange={(k) => { setPeriod(k as typeof period); setDateRange({ from: "", to: "" }); }}
        extra={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => { setDateRange((d) => ({ ...d, from: e.target.value })); setPeriod("all"); }}
              style={{ padding: "7px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "12px var(--font-sans)", colorScheme: "dark" }}
            />
            <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>até</span>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => { setDateRange((d) => ({ ...d, to: e.target.value })); setPeriod("all"); }}
              style={{ padding: "7px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "12px var(--font-sans)", colorScheme: "dark" }}
            />
          </div>
        }
      />

      {/* Kanban Board */}
      {!vm.hasLoaded ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", height: 400, animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="panel">
          <EmptyState icon={Package} title="Nenhum pedido encontrado" description="Pedidos aparecerão aqui após vendas concluídas no checkout." />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, alignItems: "flex-start", minHeight: 500 }}>
          {KANBAN_COLUMNS.map((col) => {
            const colOrders = filteredOrders.filter((o) => col.statuses.includes(o.status));
            const isValidTarget = draggedOrder ? canDrop(draggedOrder.status, col.id) : false;
            const isHovering = dropTarget === col.id;

            return (
              <div
                key={col.id}
                onDragOver={(e) => handleDragOver(e, col.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.id)}
                style={{
                  background: isHovering ? "var(--surface-3)" : "var(--surface-1)",
                  border: `1px solid ${isHovering ? col.color : isValidTarget && draggedOrder ? "var(--color-border-strong)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minHeight: 400,
                  transition: "all 0.15s ease",
                  boxShadow: isHovering ? `0 0 0 2px ${col.color}40` : "none",
                }}
              >
                {/* Column header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 8px", borderBottom: `2px solid ${col.color}` }}>
                  <span style={{ font: "600 12px var(--font-sans)", color: col.color }}>{col.label}</span>
                  <span style={{ font: "700 11px var(--font-mono)", color: "var(--color-text-muted)", background: "var(--surface-2)", borderRadius: "var(--radius-full)", padding: "2px 8px" }}>
                    {colOrders.length}
                  </span>
                </div>

                {/* Cards */}
                {colOrders.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-faint)", font: "12px var(--font-sans)", padding: "40px 8px", textAlign: "center" }}>
                    {draggedOrder && isValidTarget ? "Solte aqui" : "Nenhum pedido"}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {colOrders.map((order) => (
                      <KanbanCard
                        key={order.id}
                        order={order}
                        onDragStart={(e) => handleDragStart(e, order)}
                        onDragEnd={handleDragEnd}
                        onClick={() => vm.setExpandedOrderId(order.id)}
                        isDragging={draggedOrder?.id === order.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Side Panel */}
      {vm.expandedOrderId && <OrderSidePanel vm={vm} />}
    </div>
  );
}

// ── Kanban Card ─────────────────────────────────────────────────────────────

function KanbanCard({ order, onDragStart, onDragEnd, onClick, isDragging }: {
  order: TenantOrder;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  isDragging: boolean;
}) {
  const customer = order.customer as { full_name?: string; email?: string } | null;
  const name = customer?.full_name || customer?.email || "—";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        cursor: "grab",
        opacity: isDragging ? 0.5 : 1,
        transition: "all 0.15s ease",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onMouseEnter={(e) => { if (!isDragging) { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border-strong)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)"; } }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)" }}>
          #{order.external_order_id.slice(-6)}
        </span>
        <span style={{ font: "700 12px var(--font-mono)", color: "var(--color-text)" }}>
          {formatMinor(order.total, order.currency)}
        </span>
      </div>

      <div style={{ font: "500 12px var(--font-sans)", color: "var(--color-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {name}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>
          {formatDate(order.completed_at)}
        </span>
        {order.tracking_code && (
          <span style={{ font: "600 9px var(--font-mono)", color: "var(--color-success)", background: "var(--color-success-bg)", padding: "2px 6px", borderRadius: 4 }}>
            RASTREADO
          </span>
        )}
      </div>
    </div>
  );
}

// ── Side Panel ──────────────────────────────────────────────────────────────

function OrderSidePanel({ vm }: { vm: ReturnType<typeof useOrdersShipmentsPage> }) {
  const order = vm.orders.find((o) => o.id === vm.expandedOrderId);
  if (!order) return null;

  const cart = order.cart as { items?: Array<{ name?: string; title?: string; quantity?: number; price?: number; unit_price?: number }> };
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const customer = order.customer as { full_name?: string; email?: string; phone?: string } | null;

  const sectionStyle: React.CSSProperties = { padding: "16px 0", borderBottom: "1px solid var(--color-border)" };
  const labelStyle: React.CSSProperties = { font: "600 11px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-muted)", marginBottom: 10, textTransform: "uppercase" as const };
  const valueStyle: React.CSSProperties = { font: "13px var(--font-sans)", color: "var(--color-text)" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", justifyContent: "flex-end" }} onClick={() => vm.setExpandedOrderId(null)}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <aside style={{ position: "relative", width: 480, maxWidth: "90vw", height: "100vh", overflowY: "auto", background: "var(--surface-2)", borderLeft: "1px solid var(--color-border)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, animation: "slideInRight 0.2s ease-out", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ font: "600 18px var(--font-sans)", color: "var(--color-brand)", margin: 0 }}>Pedido {order.external_order_id}</h2>
          <button type="button" onClick={() => vm.setExpandedOrderId(null)} aria-label="Fechar" style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text)" }}><X size={20} /></button>
        </div>

        {/* Status + Total */}
        <div style={{ ...sectionStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={labelStyle}>Status atual</div>
            <OrderStatusBadge status={order.status} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={labelStyle}>Total</div>
            <span style={{ font: "700 18px var(--font-mono)", color: "var(--color-text)" }}>{formatMinor(order.total, order.currency)}</span>
          </div>
        </div>

        {/* Items */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Itens ({items.length})</div>
          {items.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: "var(--surface-3)", border: "1px solid var(--color-border)" }}>
                  <span style={valueStyle}>{item.name ?? item.title ?? "Item"} <span style={{ color: "var(--color-text-muted)" }}>×{item.quantity ?? 1}</span></span>
                  <span style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-secondary)" }}>{item.price || item.unit_price ? formatMinor(item.price ?? item.unit_price ?? 0, order.currency) : ""}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ ...valueStyle, color: "var(--color-text-muted)" }}>Nenhum item</p>}
        </div>

        {/* Customer */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Cliente</div>
          {customer ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
              {customer.full_name && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Nome</span><div style={valueStyle}>{customer.full_name}</div></div>}
              {customer.email && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Email</span><div style={valueStyle}>{customer.email}</div></div>}
              {customer.phone && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Telefone</span><div style={valueStyle}>{formatPhone(customer.phone)}</div></div>}
            </div>
          ) : <p style={{ ...valueStyle, color: "var(--color-text-muted)" }}>Sem dados do cliente</p>}
        </div>

        {/* Tracking */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Rastreamento</div>
          {order.tracking_code ? (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-success-bg)", border: "1px solid var(--color-success)", marginBottom: 12 }}>
              <div style={{ font: "600 13px var(--font-mono)", color: "var(--color-success)" }}>{order.tracking_code}</div>
              <div style={{ font: "500 11px var(--font-sans)", color: "var(--color-success)", marginTop: 4 }}>Código de rastreio enviado</div>
            </div>
          ) : (
            <p style={{ ...valueStyle, color: "var(--color-text-muted)", marginBottom: 12 }}>Sem código de rastreio</p>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              placeholder="Inserir código de rastreio"
              value={vm.trackingDrafts[order.id] ?? ""}
              onChange={(e) => vm.updateTrackingDraft(order.id, e.target.value)}
              readOnly={Boolean(order.tracking_code)}
              style={{ flex: 1, height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: order.tracking_code ? "var(--surface-1)" : "var(--surface-3)", color: "var(--color-text)", font: "13px var(--font-mono)", cursor: order.tracking_code ? "not-allowed" : "text" }}
            />
            <Button variant="primary" size="md" arrow disabled={Boolean(order.tracking_code) || vm.busy || !(vm.trackingDrafts[order.id] ?? "").trim()} onClick={() => void vm.saveManualTracking(order)}>
              Salvar
            </Button>
          </div>
          <button
            type="button"
            onClick={() => void vm.buyLabel(order)}
            disabled={vm.labelBusyOrderId === order.id}
            style={{ marginTop: 10, padding: "9px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "500 12px var(--font-sans)", cursor: vm.labelBusyOrderId === order.id ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}
          >
            <Truck size={14} />
            {vm.labelBusyOrderId === order.id ? "Gerando etiqueta..." : "Gerar etiqueta de envio"}
          </button>
        </div>

        {/* Status — info only, change via drag on board */}
        <div style={{ ...sectionStyle, borderBottom: "none" }}>
          <div style={labelStyle}>Status atual</div>
          <OrderStatusBadge status={order.status} />
          <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 8 }}>Arraste o card no board para alterar o status</p>
        </div>

        {order.cancellation_reason ? (
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", marginTop: 12 }}>
            <div style={{ font: "600 11px var(--font-sans)", color: "var(--color-error)", marginBottom: 4 }}>Motivo do cancelamento</div>
            <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>{order.cancellation_reason}</div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
