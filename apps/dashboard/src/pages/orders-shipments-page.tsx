import React from "react";
import {
  CheckCircle,
  DollarSign,
  Download,
  Package,
  PackageSearch,
  Receipt,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { EmptyState } from "../components/EmptyState.js";
import { FilterToolbar } from "../components/FilterToolbar.js";
import { Pagination } from "../components/Pagination.js";
import { StatCard } from "./overview/components/StatCard.js";
import type { MerchantProfile, TenantOrder } from "../api-client.js";
import { useOrdersShipmentsPage } from "./orders-shipments/useOrdersShipmentsPage.js";
import { Button } from "../components/Button.js";
import { STATUS_LABELS, isStatusBefore, formatMinor, formatDate, formatPhone, customerLabel} from "./orders-shipments/utils.js";
import { OrderStatusBadge } from "./orders-shipments/components/OrderStatusBadge.js";

// ── Page Component (View) ───────────────────────────────────────────────────

export { STATUS_LABELS, computeOrderMetrics, filterOrders } from "./orders-shipments/utils.js";

const dateInputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--surface-1)",
  color: "var(--color-text)",
  font: "12px var(--font-sans)",
  outline: "none",
  boxSizing: "border-box",
};

export function OrdersShipmentsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <span className="eyebrow">Pedidos</span>
            <h1>Pedidos e Envios</h1>
            <p className="page-lead">Login necessário</p>
          </div>
        </header>
      </div>
    );
  }

  return <OrdersShipmentsView me={props.me} />;
}

function OrdersShipmentsView({ me }: { me: MerchantProfile }) {
  const vm = useOrdersShipmentsPage({ me });

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Pedidos e Envios</h1>
          <p className="page-lead">Acompanhe pedidos e envios gerados pelo checkout agêntico</p>
        </div>
      </header>

      {/* Stats — StatCard pattern (matches visão geral) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard
          label="Pedidos"
          value={vm.hasLoaded ? vm.metrics.totalOrders : 0}
          icon={<ShoppingCart size={16} />}
        />
        <StatCard
          label="Aprovados"
          value={vm.hasLoaded ? Math.round(vm.metrics.approvalRate * 100) + "%" : "0%"}
          icon={<CheckCircle size={16} />}
          accent="var(--color-success)"
        />
        <StatCard
          label="Receita"
          value={vm.hasLoaded ? formatMinor(vm.metrics.totalRevenue, "BRL") : "R$ 0"}
          icon={<DollarSign size={16} />}
          accent="var(--color-brand)"
        />
        <StatCard
          label="Rastreados"
          value={vm.hasLoaded ? vm.metrics.trackedCount : 0}
          icon={<Truck size={16} />}
        />
        <StatCard
          label="Ticket Médio"
          value={vm.hasLoaded ? formatMinor(vm.metrics.averageOrderValue, "BRL") : "R$ 0"}
          icon={<Receipt size={16} />}
        />
      </div>

      {vm.message ? <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error)", font: "13px var(--font-sans)", color: "var(--color-error)", marginBottom: 16 }}>{vm.message}</div> : null}

      {/* Orders table card */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        {/* Toolbar: tabs + search */}
        <FilterToolbar
          tabs={[
            { key: "all", label: "Todos" },
            { key: "approved", label: "Aprovados" },
            { key: "cancelled", label: "Cancelados" },
            { key: "budgets", label: "Orçamentos" },
          ]}
          activeTab={vm.statusFilter}
          onTabChange={(k) => vm.setStatusFilter(k as "all" | "approved" | "cancelled" | "budgets")}
          search={vm.searchQuery}
          onSearchChange={vm.setSearchQuery}
          searchPlaceholder="Buscar por ID ou cliente..."
          searchWidth={280}
          extra={(
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 8 }}>
              <input
                type="date"
                value={vm.startDate}
                onChange={(e) => vm.setStartDate(e.target.value)}
                aria-label="Data inicial"
                style={dateInputStyle}
              />
              <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>→</span>
              <input
                type="date"
                value={vm.endDate}
                onChange={(e) => vm.setEndDate(e.target.value)}
                aria-label="Data final"
                style={dateInputStyle}
              />
              <button
                type="button"
                onClick={vm.exportCsv}
                disabled={vm.filteredOrders.length === 0}
                style={{
                  height: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border)",
                  background: "var(--surface-1)",
                  color: "var(--color-text)",
                  font: "600 12px var(--font-sans)",
                  cursor: vm.filteredOrders.length === 0 ? "not-allowed" : "pointer",
                  opacity: vm.filteredOrders.length === 0 ? 0.5 : 1,
                }}
              >
                <Download size={14} /> Exportar CSV
              </button>
            </div>
          )}
        />

        {vm.statusFilter === "budgets" ? (
          /* Budget Requests Table */
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["CLIENTE", "ITENS", "TOTAL", "STATUS", "DATA"].map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--font-mono)", letterSpacing: "0.05em", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {vm.budgetRequests.length === 0 && !vm.budgetLoading ? (
                <tr><td colSpan={5} style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Nenhum orçamento recebido ainda.</td></tr>
              ) : vm.budgetRequests.map((b: any) => (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "12px 22px" }}>
                    <strong style={{ fontSize: 13, color: "var(--color-text)" }}>{b.customerName}</strong>
                    <div style={{ fontSize: 11, color: "var(--color-text-faint)" }}>{b.customerEmail}</div>
                  </td>
                  <td style={{ padding: "12px 22px", fontSize: 12, color: "var(--color-text-muted)" }}>
                    {Array.isArray(b.items) ? b.items.length : 0} itens
                  </td>
                  <td style={{ padding: "12px 22px", fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                    R$ {(b.total ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: "12px 22px" }}>
                    <OrderStatusBadge status={b.status === "rejected" ? "cancelled" : b.status} />
                  </td>
                  <td style={{ padding: "12px 22px", fontSize: 11, color: "var(--color-text-faint)" }}>
                    {new Date(b.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : vm.busy && !vm.hasLoaded ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando pedidos...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["PEDIDO", "COMPRADOR", "VALOR", "RASTREIO", "STATUS", "DATA"].map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--font-mono)", letterSpacing: "0.05em", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {vm.paginatedOrders.map((order) => {
                const initial = customerLabel(order.customer).charAt(0).toUpperCase();
                return (
                  <tr
                    key={order.id}
                    onClick={() => vm.setExpandedOrderId(vm.expandedOrderId === order.id ? null : order.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ padding: "12px 22px", font: "600 13px var(--font-mono)", color: "var(--color-text)", borderBottom: "1px solid var(--color-border)" }}>{order.external_order_id}</td>
                    <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--color-border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--color-brand-subtle)", color: "var(--color-brand-hover)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px var(--font-sans)", flex: "none" }}>{initial}</div>
                        <span style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>{customerLabel(order.customer)}</span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 22px", font: "600 13px var(--font-mono)", color: "var(--color-text)", borderBottom: "1px solid var(--color-border)" }}>{formatMinor(order.total, order.currency)}</td>
                    <td style={{ padding: "12px 22px", font: "12.5px var(--font-mono)", color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}>{order.tracking_code ?? "Aguardando"}</td>
                    <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--color-border)" }}>
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td style={{ padding: "12px 22px", font: "13px var(--font-mono)", color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}>{formatDate(order.completed_at)}</td>
                  </tr>
                );
              })}
              {vm.busy && vm.hasLoaded ? (
                <tr><td colSpan={6} style={{ padding: "12px 22px", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando...</td></tr>
              ) : null}
            </tbody>
          </table>
        )}

        {vm.hasLoaded && vm.orders.length === 0 && !vm.message && !vm.busy ? (
          <EmptyState icon={Package} title="Nenhum pedido registrado" description="Pedidos aparecerão aqui quando compradores concluírem o checkout." />
        ) : null}

        {vm.hasLoaded && vm.orders.length > 0 && vm.filteredOrders.length === 0 && !vm.busy ? (
          <div style={{ padding: "30px 22px", textAlign: "center", font: "13px var(--font-sans)", color: "var(--color-text-faint)" }}>Nenhum pedido corresponde ao filtro</div>
        ) : null}

        {/* Pagination — inside card */}
        {vm.hasLoaded && vm.filteredOrders.length > 0 ? (
          <Pagination
            page={vm.page}
            pageSize={vm.PAGE_SIZE}
            total={vm.filteredOrders.length}
            onChange={vm.setPage}
            disabled={vm.busy}
          />
        ) : null}
      </div>

      {/* Side Panel */}
      {vm.expandedOrderId && <OrderSidePanel vm={vm} />}
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
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} />
      <aside style={{ position: "relative", width: 480, maxWidth: "90vw", height: "100vh", overflowY: "auto", background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, animation: "slideInRight 0.2s ease-out" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ font: "600 18px var(--font-sans)", color: "var(--color-brand)", margin: 0 }}>Pedido {order.external_order_id}</h2>
          <button type="button" onClick={() => vm.setExpandedOrderId(null)} aria-label="Fechar" style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text)" }}><X size={20} /></button>
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
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: "var(--color-surface-raised)", border: "1px solid var(--color-border)" }}>
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
              <div style={{ font: "500 11px var(--font-sans)", color: "var(--color-success)", marginTop: 4 }}>Código de rastreio enviado com sucesso</div>
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
              style={{ flex: 1, height: 38, padding: "0 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: order.tracking_code ? "var(--color-surface)" : "var(--color-surface-raised)", color: "var(--color-text)", font: "13px var(--font-mono)", cursor: order.tracking_code ? "not-allowed" : "text" }}
            />
            <Button variant="primary" size="md" arrow disabled={Boolean(order.tracking_code) || vm.busy || !(vm.trackingDrafts[order.id] ?? "").trim()} onClick={() => void vm.saveManualTracking(order)}>
              Salvar e enviar
            </Button>
          </div>
          <button
            type="button"
            onClick={() => void vm.buyLabel(order)}
            disabled={vm.labelBusyOrderId === order.id}
            style={{ marginTop: 10, padding: "9px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-raised)", color: "var(--color-text)", font: "500 12px var(--font-sans)", cursor: vm.labelBusyOrderId === order.id ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <Truck size={14} />
            {vm.labelBusyOrderId === order.id ? "Gerando etiqueta..." : "Gerar etiqueta de envio"}
          </button>
        </div>

        {/* Status update */}
        <div style={{ ...sectionStyle, borderBottom: "none" }}>
          <div style={labelStyle}>Alterar status</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["paid", "shipped", "delivered", "cancelled"] as const).map((status) => {
              const labels: Record<string, string> = { paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado" };
              const isActive = order.status === status;
              const isDelivered = order.status === "delivered";
              const isRegress = status !== "cancelled" && isStatusBefore(order.status, status);
              const disabled = vm.busy || isActive || isDelivered || isRegress;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => void vm.changeOrderStatus(order, status)}
                  disabled={disabled}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: `1px solid ${isActive ? "var(--color-brand)" : "var(--color-border)"}`,
                    background: isActive ? "var(--color-brand)" : "var(--color-surface-raised)",
                    color: isActive ? "white" : "var(--color-text)",
                    font: "600 12px var(--font-sans)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.45 : 1,
                    transition: "all 0.15s ease",
                  }}
                >
                  {labels[status]}
                </button>
              );
            })}
          </div>
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
