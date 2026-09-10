import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { PeriodFilter } from "../components/PeriodFilter.js";
import { EmptyState } from "../components/EmptyState.js";
import { PageLoader } from "../components/PageLoader.js";
import { StatCard, StatCardGroup } from "./overview/components/StatCard.js";
import type { MerchantProfile, OrderTimelineEntry, TenantOrder, TenantOrderDetail } from "../api-client.js";
import { useOrdersShipmentsPage } from "./orders-shipments/useOrdersShipmentsPage.js";
import { Button } from "../components/Button.js";
import { STATUS_LABELS, computeOrderMetrics, filterOrdersByPeriod, formatMinor, formatDate, formatPhone } from "./orders-shipments/utils.js";
import { OrderStatusBadge } from "./orders-shipments/components/OrderStatusBadge.js";
import { useApi } from "../hooks/useApi.js";
import { createIdempotencyKey, DashboardHttpError } from "../api/http/index.js";
import type { PurchaseShippingLabelPayload, PurchasedShippingLabel } from "../api/endpoints/order.js";

export { STATUS_LABELS, computeOrderMetrics, filterOrders, filterOrdersByPeriod } from "./orders-shipments/utils.js";

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
  { id: "cancelled", label: "Cancelado", statuses: ["cancelled", "failed", "refunded", "returned"], color: "var(--color-error)", acceptsFrom: [] },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: "PIX",
  credit_card: "Cartão",
  boleto: "Boleto",
  crypto: "Crypto",
};

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  asaas: "Asaas",
  stripe: "Stripe",
  mercado_pago: "Mercado Pago",
  unknown: "—",
};

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
    return filterOrdersByPeriod(vm.orders, period, dateRange);
  }, [vm.orders, period, dateRange]);
  const metrics = useMemo(() => computeOrderMetrics(filteredOrders), [filteredOrders]);

  function handleDragStart(e: React.DragEvent, order: TenantOrder) {
    if (vm.busy) return;
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

  async function handleDrop(e: React.DragEvent, columnId: string) {
    e.preventDefault();
    setDropTarget(null);
    if (!draggedOrder) return;
    if (!canDrop(draggedOrder.status, columnId)) return;

    const targetStatus = columnId === "pending" ? "pending" : columnId;
    await vm.changeOrderStatus(draggedOrder, targetStatus);
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
        <Button variant="outline" size="sm" onClick={() => vm.exportCsv(filteredOrders)}>
          <Download size={14} /> CSV
        </Button>
      </header>

      {/* Stats */}
      <StatCardGroup>
        <StatCard label="Pedidos" value={vm.hasLoaded ? metrics.totalOrders : 0} icon={<ShoppingCart size={16} />} />
        <StatCard label="Aprovados" value={vm.hasLoaded ? Math.round(metrics.approvalRate * 100) + "%" : "0%"} icon={<CheckCircle size={16} />} accent="var(--color-success)" />
        <StatCard label="Receita" value={vm.hasLoaded ? formatMinor(metrics.totalRevenue, "BRL") : "R$ 0"} icon={<DollarSign size={16} />} accent="var(--color-brand)" />
        <StatCard label="Rastreados" value={vm.hasLoaded ? metrics.trackedCount : 0} icon={<Truck size={16} />} />
        <StatCard label="Ticket Médio" value={vm.hasLoaded ? formatMinor(metrics.averageOrderValue, "BRL") : "R$ 0"} icon={<Receipt size={16} />} accent="var(--color-brand)" />
      </StatCardGroup>

      {vm.message ? <div className="panel-error">{vm.message}</div> : null}

      <PeriodFilter
        presets={[{ key: "all", label: "Todos" }, { key: "today", label: "Hoje" }, { key: "7d", label: "Últimos 7 dias" }, { key: "15d", label: "Últimos 15 dias" }, { key: "30d", label: "Últimos 30 dias" }]}
        active={period}
        onPreset={key => { setPeriod(key as typeof period); setDateRange({ from: "", to: "" }); }}
        from={dateRange.from} to={dateRange.to}
        onDate={(field, value) => { setDateRange(range => ({ ...range, [field]: value })); setPeriod("all"); }}
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
                        onClick={() => vm.openOrderDetails(order.id)}
                        isDragging={draggedOrder?.id === order.id}
                        disabled={vm.busy}
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

function KanbanCard({ order, onDragStart, onDragEnd, onClick, isDragging, disabled }: {
  order: TenantOrder;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  isDragging: boolean;
  disabled: boolean;
}) {
  const customer = order.customer as { full_name?: string; email?: string } | null;
  const name = customer?.full_name || customer?.email || "—";

  return (
    <div
      draggable={!disabled}
      aria-disabled={disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        cursor: disabled ? "not-allowed" : "grab",
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

  const detail = vm.orderDetail?.id === order.id ? vm.orderDetail : null;

  const cart = order.cart as { items?: Array<{ name?: string; title?: string; quantity?: number; price?: number; unit_price?: number }> };
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const customer = order.customer as {
    full_name?: string;
    email?: string;
    phone?: string;
    address?: {
      zip?: string;
      street?: string;
      number?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
    };
  } | null;
  const address = customer?.address;
  const hasAddress = Boolean(
    address && (address.street || address.city || address.zip),
  );

  const sectionStyle: React.CSSProperties = { padding: "16px 0", borderBottom: "1px solid var(--color-border)" };
  const labelStyle: React.CSSProperties = { font: "600 11px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-muted)", marginBottom: 10, textTransform: "uppercase" as const };
  const valueStyle: React.CSSProperties = { font: "13px var(--font-sans)", color: "var(--color-text)" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", justifyContent: "flex-end" }} onClick={vm.closeOrderDetails}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <aside style={{ position: "relative", width: 480, maxWidth: "90vw", height: "100vh", overflowY: "auto", background: "var(--surface-2)", borderLeft: "1px solid var(--color-border)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, animation: "slideInRight 0.2s ease-out", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ font: "600 18px var(--font-sans)", color: "var(--color-brand)", margin: 0 }}>Pedido {order.external_order_id}</h2>
          <button type="button" onClick={vm.closeOrderDetails} aria-label="Fechar" style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text)" }}><X size={20} /></button>
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

        {/* Payment */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Pagamento</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
            <div>
              <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Método</span>
              <div style={valueStyle}>{order.payment_method ? PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method : "—"}</div>
            </div>
            <div>
              <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Provider</span>
              <div style={valueStyle}>{order.payment_provider ? PAYMENT_PROVIDER_LABELS[order.payment_provider] || order.payment_provider : "—"}</div>
            </div>
            {order.paid_at && (
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Data pagamento</span>
                <div style={valueStyle}>{formatDate(order.paid_at)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Address */}
        {hasAddress && (
          <div style={sectionStyle}>
            <div style={labelStyle}>Endereço</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
              {address?.street && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Rua</span><div style={valueStyle}>{address.street}{address.number ? `, ${address.number}` : ""}</div></div>}
              {address?.complement && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Complemento</span><div style={valueStyle}>{address.complement}</div></div>}
              {address?.neighborhood && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Bairro</span><div style={valueStyle}>{address.neighborhood}</div></div>}
              {address?.city && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Cidade</span><div style={valueStyle}>{address.city}/{address.state}</div></div>}
              {address?.zip && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>CEP</span><div style={valueStyle}>{address.zip}</div></div>}
            </div>
          </div>
        )}

        <OrderTimelineSection
          detail={detail}
          loading={vm.orderDetailLoading}
          error={vm.orderDetailError}
          onRetry={vm.reloadOrderDetail}
          sectionStyle={sectionStyle}
          labelStyle={labelStyle}
        />

        {/* Tracking */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Rastreamento</div>
          {order.tracking_code ? (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-success-bg)", border: "1px solid var(--color-success)", marginBottom: 12 }}>
              <div style={{ font: "600 13px var(--font-mono)", color: "var(--color-success)" }}>{order.tracking_code}</div>
              <div style={{ font: "500 11px var(--font-sans)", color: "var(--color-success)", marginTop: 4 }}>Código registrado no pedido</div>
            </div>
          ) : (
            <p style={{ ...valueStyle, color: "var(--color-text-muted)", marginBottom: 12 }}>Sem código de rastreio</p>
          )}
          <ShippingLabelPurchaseAction
            order={order}
            customer={customer}
            vm={vm}
          />
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
          <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 10 }}>
            A etiqueta exige uma cotação confirmada e as dimensões reais dos itens. Este painel não gera etiquetas com dados estimados.
          </p>
        </div>

        {/* Status — info only, change via drag on board */}
        <div style={{ ...sectionStyle, borderBottom: "none" }}>
          <div style={labelStyle}>Status atual</div>
          <OrderStatusBadge status={order.status} />
          <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 8 }}>Arraste o card no board para atualizar o fluxo. Cancelamentos exigem motivo e usam a ação abaixo.</p>
        </div>

        <CancelOrderAction order={order} vm={vm} />

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

function CancelOrderAction({ order, vm }: { order: TenantOrder; vm: ReturnType<typeof useOrdersShipmentsPage> }) {
  const [reason, setReason] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [restock, setRestock] = useState(false);
  const cancellable = ["pending", "processing", "approved", "paid"].includes(order.status);

  if (!cancellable) return null;

  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--color-border)" }}>
      <div style={{ font: "600 11px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-error)", marginBottom: 10, textTransform: "uppercase" }}>Cancelar pedido</div>
      <label style={{ display: "block", font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 8 }}>
        Motivo
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Explique o cancelamento" style={{ width: "100%", height: 38, marginTop: 6, padding: "0 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-3)", color: "var(--color-text)", font: "13px var(--font-sans)" }} />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 8 }}><input type="checkbox" checked={notifyCustomer} onChange={(event) => setNotifyCustomer(event.target.checked)} /> Solicitar notificação ao cliente</label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 12 }}><input type="checkbox" checked={restock} onChange={(event) => setRestock(event.target.checked)} /> Solicitar reposição de estoque</label>
      <Button variant="danger" size="md" loading={vm.cancelBusyOrderId === order.id} disabled={!reason.trim() || vm.busy} onClick={() => void vm.cancelOrder(order, { reason, notifyCustomer, restock })}>Cancelar pedido</Button>
    </div>
  );
}

type ShippingLabelForm = {
  service_id: string;
  from_zip: string;
  to_zip: string;
  to_name: string;
  to_document: string;
  invoice_key: string;
  packages: Array<{
    weightKg: string;
    widthCm: string;
    heightCm: string;
    lengthCm: string;
    quantity: string;
  }>;
};

function ShippingLabelPurchaseAction({
  order,
  customer,
  vm,
}: {
  order: TenantOrder;
  customer: {
    full_name?: string;
    address?: { zip?: string };
  } | null;
  vm: ReturnType<typeof useOrdersShipmentsPage>;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [carrierReady, setCarrierReady] = useState(false);
  const [confirmed, setConfirmed] = useState<PurchasedShippingLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());
  const [form, setForm] = useState<ShippingLabelForm>(() => ({
    service_id: "",
    from_zip: "",
    to_zip: customer?.address?.zip ?? "",
    to_name: customer?.full_name ?? "",
    to_document: "",
    invoice_key: "",
    packages: [{ weightKg: "", widthCm: "", heightCm: "", lengthCm: "", quantity: "1" }],
  }));

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingConfig(true);
    setConfigError(null);
    void api.getDeliveryConfig()
      .then((config) => {
        if (!active) return;
        setCarrierReady(config.melhorEnvioEnabled && config.melhorEnvioConnected);
        setForm((current) => ({
          ...current,
          from_zip: current.from_zip || config.originZip,
        }));
      })
      .catch(() => {
        if (active) setConfigError("Não foi possível confirmar a conexão do Melhor Envio.");
      })
      .finally(() => {
        if (active) setLoadingConfig(false);
      });
    return () => { active = false; };
  }, [api, open]);

  function updateField<K extends Exclude<keyof ShippingLabelForm, "packages">>(key: K, value: ShippingLabelForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updatePackage(key: keyof ShippingLabelForm["packages"][number], value: string) {
    setForm((current) => ({
      ...current,
      packages: current.packages.map((pkg, index) => index === 0 ? { ...pkg, [key]: value } : pkg),
    }));
  }

  function preparedPayload(): Omit<PurchaseShippingLabelPayload, "order_id"> | null {
    const serviceId = Number(form.service_id);
    const fields = [form.from_zip, form.to_zip, form.to_name, form.to_document];
    const pkg = form.packages[0];
    const packageValues = pkg
      ? [Number(pkg.weightKg), Number(pkg.widthCm), Number(pkg.heightCm), Number(pkg.lengthCm), Number(pkg.quantity)]
      : [];

    if (!Number.isInteger(serviceId) || serviceId <= 0 || fields.some((value) => !value.trim()) || packageValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      return null;
    }

    return {
      service_id: serviceId,
      from_zip: form.from_zip.trim(),
      to_zip: form.to_zip.trim(),
      to_name: form.to_name.trim(),
      to_document: form.to_document.trim(),
      packages: [{
        weightKg: packageValues[0]!,
        widthCm: packageValues[1]!,
        heightCm: packageValues[2]!,
        lengthCm: packageValues[3]!,
        quantity: packageValues[4]!,
      }],
      ...(form.invoice_key.trim() ? { invoice_key: form.invoice_key.trim() } : {}),
    };
  }

  async function purchase() {
    const payload = preparedPayload();
    if (!payload) {
      setError("Informe o serviço da cotação, CEPs, destinatário, documento e dimensões reais do pacote.");
      return;
    }
    if (!acknowledged) {
      setError("Confirme que deseja solicitar a compra da etiqueta.");
      return;
    }
    setError(null);
    try {
      const result = await vm.purchaseShippingLabel(order, payload, idempotencyKey.current);
      setConfirmed(result);
    } catch (cause) {
      const isUnknown = !(cause instanceof DashboardHttpError) || cause.status === 0 || cause.status >= 500;
      setUncertain(isUnknown);
      setError(
        isUnknown
          ? "A compra não foi confirmada. Consulte o Melhor Envio antes de tentar novamente para evitar uma etiqueta duplicada."
          : "A compra não foi confirmada. Revise os dados da cotação e tente novamente.",
      );
      // A rejected HTTP request can be corrected and submitted with a fresh
      // key. Unknown outcomes keep the key and block another charge attempt.
      if (!isUnknown) idempotencyKey.current = createIdempotencyKey();
    }
  }

  if (confirmed) {
    return (
      <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--color-success-bg)", border: "1px solid var(--color-success)", marginBottom: 12 }}>
        <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-success)" }}>Etiqueta confirmada</div>
        <div style={{ font: "12px var(--font-mono)", color: "var(--color-success)", marginTop: 4 }}>{confirmed.tracking_code}</div>
        {confirmed.label_url && <a href={confirmed.label_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, font: "600 12px var(--font-sans)", color: "var(--color-success)" }}>Abrir etiqueta</a>}
      </div>
    );
  }

  if (order.tracking_code) return null;

  if (!open) {
    return <Button variant="outline" size="sm" disabled={vm.shippingLabelBusyOrderId === order.id} onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>Comprar e gerar etiqueta</Button>;
  }

  const packageDraft = form.packages[0]!;
  const disabled = loadingConfig || !carrierReady || uncertain || vm.shippingLabelBusyOrderId === order.id;
  const fieldStyle: React.CSSProperties = { width: "100%", height: 36, padding: "0 10px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--surface-3)", color: "var(--color-text)", font: "13px var(--font-sans)" };
  const labelStyle: React.CSSProperties = { display: "grid", gap: 5, font: "600 11px var(--font-sans)", color: "var(--color-text-muted)" };

  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)" }}>
      <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)", marginBottom: 6 }}>Comprar etiqueta via Melhor Envio</div>
      <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", margin: "0 0 12px" }}>Use somente o serviço da cotação confirmada e as medidas reais do pacote. Esta ação pode gerar cobrança no Melhor Envio.</p>
      {loadingConfig && <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>Verificando conexão do Melhor Envio…</p>}
      {configError && <p className="panel-error" role="alert">{configError}</p>}
      {!loadingConfig && !configError && !carrierReady && <p className="panel-error" role="alert">Conecte e ative o Melhor Envio em Entregas antes de comprar uma etiqueta.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={labelStyle}>Serviço da cotação<input type="number" min="1" value={form.service_id} onChange={(event) => updateField("service_id", event.target.value)} placeholder="Ex.: 1" style={fieldStyle} /></label>
        <label style={labelStyle}>CEP de origem<input value={form.from_zip} onChange={(event) => updateField("from_zip", event.target.value)} placeholder="00000-000" style={fieldStyle} /></label>
        <label style={labelStyle}>CEP do destinatário<input value={form.to_zip} onChange={(event) => updateField("to_zip", event.target.value)} placeholder="00000-000" style={fieldStyle} /></label>
        <label style={labelStyle}>CPF/CNPJ destinatário<input value={form.to_document} onChange={(event) => updateField("to_document", event.target.value)} placeholder="Somente números" style={fieldStyle} /></label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Nome do destinatário<input value={form.to_name} onChange={(event) => updateField("to_name", event.target.value)} style={fieldStyle} /></label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Chave NF-e (opcional)<input value={form.invoice_key ?? ""} onChange={(event) => updateField("invoice_key", event.target.value)} style={fieldStyle} /></label>
      </div>
      <div style={{ marginTop: 12, font: "600 11px var(--font-sans)", color: "var(--color-text-muted)" }}>Pacote (medidas reais)</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 6 }}>
        <label style={labelStyle}>kg<input type="number" min="0.001" step="0.001" value={packageDraft.weightKg} onChange={(event) => updatePackage("weightKg", event.target.value)} style={fieldStyle} /></label>
        <label style={labelStyle}>Larg. cm<input type="number" min="0.1" step="0.1" value={packageDraft.widthCm} onChange={(event) => updatePackage("widthCm", event.target.value)} style={fieldStyle} /></label>
        <label style={labelStyle}>Alt. cm<input type="number" min="0.1" step="0.1" value={packageDraft.heightCm} onChange={(event) => updatePackage("heightCm", event.target.value)} style={fieldStyle} /></label>
        <label style={labelStyle}>Comp. cm<input type="number" min="0.1" step="0.1" value={packageDraft.lengthCm} onChange={(event) => updatePackage("lengthCm", event.target.value)} style={fieldStyle} /></label>
        <label style={labelStyle}>Qtd.<input type="number" min="1" step="1" value={packageDraft.quantity} onChange={(event) => updatePackage("quantity", event.target.value)} style={fieldStyle} /></label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>Confirmo que os dados e a cotação foram revisados e quero solicitar a compra desta etiqueta.</span>
      </label>
      {error && <p className="panel-error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button variant="primary" size="sm" disabled={disabled || !acknowledged} onClick={() => void purchase()}>{vm.shippingLabelBusyOrderId === order.id ? "Solicitando…" : "Comprar e gerar"}</Button>
        <Button variant="outline" size="sm" disabled={vm.shippingLabelBusyOrderId === order.id} onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </div>
  );
}

function OrderTimelineSection({
  detail,
  loading,
  error,
  onRetry,
  sectionStyle,
  labelStyle,
}: {
  detail: TenantOrderDetail | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sectionStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}) {
  return (
    <section style={sectionStyle} aria-labelledby="order-timeline-title">
      <div id="order-timeline-title" style={labelStyle}>Histórico do pedido</div>
      {loading ? <PageLoader variant="section" /> : null}
      {!loading && error ? (
        <div role="alert" style={{ display: "grid", gap: 10, padding: 12, borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)" }}>
          <span style={{ font: "12px/1.5 var(--font-sans)", color: "var(--color-text)" }}>{error}</span>
          <div><Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button></div>
        </div>
      ) : null}
      {!loading && !error && detail ? (
        detail.timeline.length > 0 ? (
          <ol style={{ display: "grid", gap: 0, margin: 0, padding: 0, listStyle: "none" }}>
            {detail.timeline.map((event) => <TimelineEntry key={event.id} event={event} />)}
          </ol>
        ) : <p style={{ margin: 0, font: "12px/1.5 var(--font-sans)", color: "var(--color-text-muted)" }}>Ainda não há eventos registrados para este pedido.</p>
      ) : null}
    </section>
  );
}

function TimelineEntry({ event }: { event: OrderTimelineEntry }) {
  const location = typeof event.data?.location === "string" ? event.data.location : null;
  const label = timelineLabel(event);
  const description = event.description?.trim();
  return (
    <li style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr)", gap: 10, padding: "10px 0", borderTop: "1px solid var(--color-border)" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, background: event.type === "tracking" ? "var(--color-brand)" : "var(--color-text-faint)" }} />
      <div style={{ display: "grid", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>{label}</span>
          <time dateTime={event.occurredAt} style={{ flex: "0 0 auto", font: "10px var(--font-mono)", color: "var(--color-text-faint)" }}>{formatDate(event.occurredAt)}</time>
        </div>
        {description ? <span style={{ font: "12px/1.45 var(--font-sans)", color: "var(--color-text-muted)" }}>{description}</span> : null}
        {location ? <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>{location}</span> : null}
      </div>
    </li>
  );
}

function timelineLabel(event: OrderTimelineEntry): string {
  const status = event.status?.trim();
  const statusLabel = status ? STATUS_LABELS[status] ?? status.replaceAll("_", " ") : undefined;
  if (event.type === "tracking") return statusLabel ? `Rastreio: ${statusLabel}` : "Atualização de rastreio";
  if (event.type === "payment") return statusLabel ? `Pagamento: ${statusLabel}` : "Atualização de pagamento";
  if (event.type === "checkout") return statusLabel ? `Checkout: ${statusLabel}` : "Atualização do checkout";
  if (event.type === "order") return statusLabel ? `Pedido: ${statusLabel}` : "Atualização do pedido";
  return statusLabel ?? "Atualização registrada";
}
