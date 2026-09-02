import React from "react";
import { Store, ShoppingBag, Zap, Clock, TrendingUp, Truck, BarChart3, DollarSign, CheckCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { EmptyState } from "../../components/EmptyState.js";
import { TabBar } from "../../components/TabBar.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import { PageLoader } from "../../components/PageLoader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { StatCard } from "../overview/components/StatCard.js";
import { FilterToolbar } from "../../components/FilterToolbar.js";
import { useMarketplacePage } from "./useMarketplacePage.js";
import { OrderRow } from "./components/OrderRow.js";
import { SettlementDetailPanel } from "./components/SettlementDetailPanel.js";
import { BlockedMerchantForm } from "./components/BlockedMerchantForm.js";
import { StoreDiscoveryGrid } from "./components/StoreDiscoveryGrid.js";
import "./marketplace-page.css";

const SETTLEMENT_STATUS_PT: Record<string, string> = {
  awaiting_return_window: "Aguardando devolução",
  awaiting_chargeback_window: "Aguardando chargeback",
  transfer_scheduled: "Repasse agendado",
  transferred: "Repasse executado",
  finalized: "Finalizado",
  return_cancelled: "Devolvido",
  chargeback_cancelled: "Chargeback cancelado",
  chargeback_debt: "Débito por chargeback",
  chargeback_filed: "Chargeback aberto",
  chargeback_resolved: "Chargeback resolvido",
};
const settlementStatusLabel = (status: string): string =>
  SETTLEMENT_STATUS_PT[status] ?? status.replace(/_/g, " ");

interface MarketplacePageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function MarketplacePage({ me, apiBaseUrl }: MarketplacePageProps) {
  const { state, actions } = useMarketplacePage(me);
  const { config, orders, stats, loading, saving, tab, settlements, chargebacks, chargebackStats, selectedSettlementId } = state;
  const { saveConfig, markShipped, markDelivered, setTab, setSelectedSettlementId } = actions;

  // Page-based pagination for the data lists, matching the Produtos/Estoque layout.
  const LIST_PAGE_SIZE = 10;
  const [ordersPage, setOrdersPage] = React.useState(1);
  const [settlementsPage, setSettlementsPage] = React.useState(1);
  const [returnsPage, setReturnsPage] = React.useState(1);
  const [chargebacksPage, setChargebacksPage] = React.useState(1);
  const pageSlice = <T,>(arr: T[], page: number): T[] => arr.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);

  // Filters (FilterToolbar) per data list — status chips + search, like the Produtos screen.
  const [ordersStatus, setOrdersStatus] = React.useState("all");
  const [ordersSearch, setOrdersSearch] = React.useState("");
  const [settlementsStatus, setSettlementsStatus] = React.useState("all");
  const [settlementsSearch, setSettlementsSearch] = React.useState("");
  const [returnsSearch, setReturnsSearch] = React.useState("");
  const [chargebacksSearch, setChargebacksSearch] = React.useState("");

  if (!me) {
    return (
      <div className="marketplace-page">
        <header className="page-head">
          <div>
            <span className="eyebrow">INTEGRAÇÕES</span>
            <h1>Marketplace</h1>
            <p className="page-lead">Gerencie como seus produtos aparecem em lojas parceiras</p>
          </div>
        </header>
        <EmptyState
          icon={Store}
          title="Login necessário"
          description="Faça login para gerenciar seu marketplace."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="marketplace-page">
        <header className="page-head">
          <div>
            <span className="eyebrow">INTEGRAÇÕES</span>
            <h1>Marketplace</h1>
          </div>
        </header>
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="marketplace-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">INTEGRAÇÕES</span>
          <h1>Marketplace</h1>
          <p className="page-lead">
            {tab === "settings"
              ? "Gerencie comissões, janelas de pagamento e lojas parceiras"
              : tab === "settlements"
              ? "Acompanhe repasses, janelas e status de cada transação cross-store"
              : tab === "chargebacks"
              ? "Visualize chargebacks recebidos e impacto nos repasses"
              : tab === "stores"
              ? "Descubra e habilite lojas parceiras para vender seus produtos"
              : "Pedidos recebidos de lojas parceiras que vendem seus produtos"}
          </p>
        </div>
      </header>

      <TabBar
        tabs={[
          { key: "stores", label: "Lojas" },
          { key: "orders", label: "Pedidos" },
          { key: "settlements", label: "Repasses" },
          { key: "returns", label: "Devoluções" },
          { key: "chargebacks", label: "Chargebacks" },
          { key: "settings", label: "Configurações" },
        ]}
        activeTab={tab}
        onTabChange={(key) => setTab(key as any)}
      />

      {tab === "stores" && (
        <SectionErrorBoundary sectionName="Lojas Parceiras">
          <StoreDiscoveryGrid apiBaseUrl={apiBaseUrl} />
        </SectionErrorBoundary>
      )}

      {tab === "settings" && (
        <div className="marketplace-page__settings">
          <div className="panel">
            <div className="marketplace-section__header">
              <h2 className="marketplace-section__title">Habilitar Marketplace</h2>
            </div>
            <div className="marketplace-enable">
              <div className="marketplace-enable__checkbox">
                <ToggleSwitch
                  id="marketplace-enabled"
                  checked={config.enabled}
                  onChange={(v) => void saveConfig({ enabled: v })}
                  disabled={saving}
                />
              </div>
              <div className="marketplace-enable__content">
                <label htmlFor="marketplace-enabled" className="marketplace-enable__label">
                  Permitir marketplace
                </label>
                <p className="marketplace-enable__description">
                  Permitir que lojas parceiras vendam seus produtos e vice-versa.
                </p>
                <span className="marketplace-enable__status marketplace-enable__status-active">
                  <span className="status-dot status-dot--active" />
                  {config.enabled ? "Ativo" : "Inativo"}
                </span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="marketplace-section__header">
              <h2 className="marketplace-section__title">Comissão e Janelas de Pagamento</h2>
            </div>

            <div className="marketplace-config__grid">
              <div className="marketplace-config__field">
                <label className="marketplace-config__label">Comissão (%)</label>
                <input
                  type="number"
                  className="marketplace-config__input"
                  value={config.commission_percent}
                  onChange={(e) =>
                    void saveConfig({
                      commission_percent: Math.max(1, Math.min(50, Number(e.target.value))),
                    })
                  }
                  min="1"
                  max="50"
                  disabled={saving}
                />
                <span style={{ font: "400 10px var(--font-sans)", color: "var(--color-text-muted)" }}>
                  Intervalo: 1-50%
                </span>
              </div>

              <div className="marketplace-config__field">
                <label className="marketplace-config__label">Prazo de Devolução (dias)</label>
                <input
                  type="number"
                  className="marketplace-config__input"
                  value={config.return_window_days}
                  onChange={(e) =>
                    void saveConfig({
                      return_window_days: Math.max(1, Math.min(30, Number(e.target.value))),
                    })
                  }
                  min="1"
                  max="30"
                  disabled={saving}
                />
                <span style={{ font: "400 10px var(--font-sans)", color: "var(--color-text-muted)" }}>
                  Intervalo: 1-30 dias
                </span>
              </div>

              <div className="marketplace-config__field">
                <label className="marketplace-config__label">Prazo de Repasse (dias)</label>
                <input
                  type="number"
                  className="marketplace-config__input"
                  value={config.settlement_window_days}
                  onChange={(e) =>
                    void saveConfig({
                      settlement_window_days: Math.max(1, Math.min(30, Number(e.target.value))),
                    })
                  }
                  min="1"
                  max="30"
                  disabled={saving}
                />
                <span style={{ font: "400 10px var(--font-sans)", color: "var(--color-text-muted)" }}>
                  Intervalo: 1-30 dias
                </span>
              </div>

              <div className="marketplace-config__field">
                <label className="marketplace-config__label">Janela de Chargeback (dias)</label>
                <input
                  type="number"
                  className="marketplace-config__input"
                  value={config.chargeback_window_days}
                  onChange={(e) =>
                    void saveConfig({
                      chargeback_window_days: Math.max(7, Math.min(30, Number(e.target.value))),
                    })
                  }
                  min="7"
                  max="30"
                  disabled={saving}
                />
                <span style={{ font: "400 10px var(--font-sans)", color: "var(--color-text-muted)" }}>
                  Intervalo: 7-30 dias
                </span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="marketplace-section__header">
              <h2 className="marketplace-section__title">Lojas Bloqueadas</h2>
            </div>
            <p className="marketplace-enable__description" style={{ marginTop: 0 }}>
              Merchants que você não quer que vendam em sua loja
            </p>

            {/* Add Blocked Merchant Form */}
            <BlockedMerchantForm
              blockedIds={config.blocked_merchant_ids}
              saving={saving}
              onAdd={(merchantId) => {
                const updated = [...config.blocked_merchant_ids, merchantId];
                void saveConfig({ blocked_merchant_ids: updated });
              }}
              onRemove={(merchantId) => {
                const updated = config.blocked_merchant_ids.filter((id) => id !== merchantId);
                void saveConfig({ blocked_merchant_ids: updated });
              }}
            />
          </div>
        </div>
      )}

      {tab === "orders" && (
        <SectionErrorBoundary sectionName="Pedidos Marketplace">
        <div className="marketplace-page__orders">
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <StatCard
                label="Pedidos Pendentes"
                value={stats.pending_orders}
                icon={<Clock size={16} />}
              />
              <StatCard
                label="Receita (mês)"
                value={new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(stats.monthly_revenue)}
                icon={<TrendingUp size={16} />}
                accent="var(--color-brand)"
              />
              <StatCard
                label="Itens Enviados"
                value={stats.items_shipped}
                icon={<Truck size={16} />}
              />
              <StatCard
                label="Taxa Fulfillment"
                value={`${Math.round(stats.fulfillment_rate * 100)}%`}
                icon={<BarChart3 size={16} />}
                accent="var(--color-success)"
              />
            </div>
          )}

          {(() => {
            const q = ordersSearch.trim().toLowerCase();
            const rows = orders.flatMap((order) =>
              (order.line_items ?? []).map((item) => ({ order, item }))
            ).filter(({ order, item }) => {
              if (ordersStatus !== "all" && item.status !== ordersStatus) return false;
              if (q && !(`${order.id} ${item.product_name ?? ""} ${order.host_store_name ?? ""}`.toLowerCase().includes(q))) return false;
              return true;
            });
            return (
              <DataPanel
                title="Pedidos Recebidos"
                isEmpty={rows.length === 0}
                empty={{ icon: ShoppingBag, title: "Você ainda não recebeu pedidos via marketplace", description: "Quando lojas parceiras venderem seus produtos, os pedidos aparecerão aqui." }}
                page={ordersPage}
                pageSize={LIST_PAGE_SIZE}
                total={rows.length}
                onPageChange={setOrdersPage}
              >
                <FilterToolbar
                  tabs={[
                    { key: "all", label: "Todos" },
                    { key: "pending", label: "Pendente" },
                    { key: "shipped", label: "Enviado" },
                    { key: "delivered", label: "Entregue" },
                  ]}
                  activeTab={ordersStatus}
                  onTabChange={(k) => { setOrdersStatus(k); setOrdersPage(1); }}
                  search={ordersSearch}
                  onSearchChange={(v) => { setOrdersSearch(v); setOrdersPage(1); }}
                  searchPlaceholder="Buscar por pedido, produto ou loja..."
                />
                <table className="marketplace-orders__table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Loja Host</th>
                      <th>Produto</th>
                      <th>Valor</th>
                      <th>Status</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice(rows, ordersPage).map(({ order, item }) => (
                      <OrderRow
                        key={item.id}
                        orderId={order.id}
                        storeName={order.host_store_name}
                        item={item}
                        onMarkShipped={markShipped}
                        onMarkDelivered={markDelivered}
                      />
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            );
          })()}
        </div>
        </SectionErrorBoundary>
      )}

      {tab === "settlements" && (
        <SectionErrorBoundary sectionName="Repasses">
        <div className="marketplace-page__settlements">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <StatCard
              label="Total repassado"
              value={new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(settlements.reduce((sum, s) => sum + s.sellerNetCents, 0) / 100)}
              icon={<DollarSign size={16} />}
              accent="var(--color-brand)"
            />
            <StatCard
              label="Comissão arrecadada"
              value={new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(settlements.reduce((sum, s) => sum + s.commissionCents, 0) / 100)}
              icon={<TrendingUp size={16} />}
              accent="var(--color-success)"
            />
            <StatCard
              label="Repasses pendentes"
              value={settlements.filter(s => s.status === "awaiting_return_window" || s.status === "transfer_scheduled").length}
              icon={<Clock size={16} />}
            />
            <StatCard
              label="Repasses concluídos"
              value={settlements.filter(s => s.status === "transferred" || s.status === "finalized").length}
              icon={<CheckCircle size={16} />}
              accent="var(--color-success)"
            />
          </div>
          {(() => {
          const sq = settlementsSearch.trim().toLowerCase();
          const filteredSettlements = settlements.filter((s) => {
            if (settlementsStatus !== "all" && s.status !== settlementsStatus) return false;
            if (sq && !(`${s.id} ${s.orderId}`.toLowerCase().includes(sq))) return false;
            return true;
          });
          return (
          <DataPanel
            title="Repasses"
            isEmpty={filteredSettlements.length === 0}
            empty={{ icon: Clock, title: "Nenhum repasse registrado", description: "Quando pedidos forem finalizados, os repasses aparecerão aqui com a timeline completa." }}
            page={settlementsPage}
            pageSize={LIST_PAGE_SIZE}
            total={filteredSettlements.length}
            onPageChange={setSettlementsPage}
          >
            <FilterToolbar
              tabs={[
                { key: "all", label: "Todos" },
                { key: "awaiting_return_window", label: "Aguardando devolução" },
                { key: "transfer_scheduled", label: "Agendado" },
                { key: "transferred", label: "Transferido" },
                { key: "finalized", label: "Finalizado" },
              ]}
              activeTab={settlementsStatus}
              onTabChange={(k) => { setSettlementsStatus(k); setSettlementsPage(1); }}
              search={settlementsSearch}
              onSearchChange={(v) => { setSettlementsSearch(v); setSettlementsPage(1); }}
              searchPlaceholder="Buscar por ID ou pedido..."
            />
            <table className="marketplace-orders__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Pedido</th>
                  <th>Valor Líquido</th>
                  <th>Status</th>
                  <th>Criado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice(filteredSettlements, settlementsPage).map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.id.slice(0, 8)}...</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.orderId.slice(0, 8)}...</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                      R$ {(s.sellerNetCents / 100).toFixed(2)}
                    </td>
                    <td>
                      <span className={`settlement-status settlement-status--${s.status}`}>
                        {settlementStatusLabel(s.status)}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                      {new Date(s.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                    <td>
                      <button className="btn-sm" onClick={() => setSelectedSettlementId(s.id)}>
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
          );
          })()}
        </div>
        </SectionErrorBoundary>
      )}

      {tab === "returns" && (() => {
        const allReturned = settlements.filter((s) => s.status === "return_cancelled");
        const rq = returnsSearch.trim().toLowerCase();
        const returned = rq ? allReturned.filter((s) => `${s.id} ${s.orderId}`.toLowerCase().includes(rq)) : allReturned;
        const returnedValueCents = allReturned.reduce((sum, s) => sum + s.sellerNetCents, 0);
        const returnRate = settlements.length > 0 ? allReturned.length / settlements.length : 0;
        return (
          <div className="marketplace-page__returns" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* KPIs — padronizado com as demais abas */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <StatCard label="Devoluções" value={allReturned.length} icon={<Store size={16} />} accent="var(--warning)" />
              <StatCard
                label="Valor Devolvido"
                value={new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(returnedValueCents / 100)}
                icon={<TrendingUp size={16} />}
                accent="var(--color-error)"
              />
              <StatCard label="Taxa de Devolução" value={`${Math.round(returnRate * 100)}%`} icon={<BarChart3 size={16} />} accent="var(--info)" />
            </div>

            <DataPanel
              title="Devoluções de Marketplace"
              isEmpty={returned.length === 0}
              empty={{ icon: Store, title: "Nenhuma devolução de marketplace", description: "Quando compradores de pedidos cross-store solicitarem devoluções, elas aparecerão aqui." }}
              page={returnsPage}
              pageSize={LIST_PAGE_SIZE}
              total={returned.length}
              onPageChange={setReturnsPage}
            >
              <FilterToolbar
                tabs={[{ key: "all", label: "Todas" }]}
                activeTab="all"
                onTabChange={() => {}}
                search={returnsSearch}
                onSearchChange={(v) => { setReturnsSearch(v); setReturnsPage(1); }}
                searchPlaceholder="Buscar por settlement ou pedido..."
              />
              <table className="marketplace-orders__table">
                <thead>
                  <tr><th>Settlement</th><th>Pedido</th><th>Valor</th><th>Status</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {pageSlice(returned, returnsPage).map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.id.slice(0, 8)}...</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.orderId.slice(0, 8)}...</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>R$ {(s.sellerNetCents / 100).toFixed(2)}</td>
                      <td><span className={`settlement-status settlement-status--${s.status}`}>{settlementStatusLabel(s.status)}</span></td>
                      <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{new Date(s.createdAt).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          </div>
        );
      })()}

      {tab === "chargebacks" && (
        <div className="marketplace-page__chargebacks" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Stats Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <StatCard
              label="Cancelados"
              value={chargebackStats.totalCancelled}
              icon={<Zap size={16} />}
              accent="var(--warning)"
            />
            <StatCard
              label="Com Débito"
              value={chargebackStats.totalWithDebt}
              icon={<Zap size={16} />}
              accent="var(--color-error)"
            />
            <StatCard
              label="Total Débitos"
              value={new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(chargebackStats.totalDebtCents / 100)}
              icon={<TrendingUp size={16} />}
              accent="var(--color-error)"
            />
          </div>

          {(() => {
          const cq = chargebacksSearch.trim().toLowerCase();
          const filteredChargebacks = cq
            ? chargebacks.filter((cb) => `${cb.settlement.id} ${cb.settlement.orderId}`.toLowerCase().includes(cq))
            : chargebacks;
          return (
          <DataPanel
            title="Chargebacks"
            isEmpty={filteredChargebacks.length === 0}
            empty={{ icon: Zap, title: "Nenhum chargeback registrado", description: "Chargebacks recebidos de pedidos cross-store aparecerão aqui." }}
            page={chargebacksPage}
            pageSize={LIST_PAGE_SIZE}
            total={filteredChargebacks.length}
            onPageChange={setChargebacksPage}
          >
              <FilterToolbar
                tabs={[{ key: "all", label: "Todos" }]}
                activeTab="all"
                onTabChange={() => {}}
                search={chargebacksSearch}
                onSearchChange={(v) => { setChargebacksSearch(v); setChargebacksPage(1); }}
                searchPlaceholder="Buscar por settlement ou pedido..."
              />
              <table className="marketplace-orders__table">
                <thead>
                  <tr>
                    <th>Settlement</th>
                    <th>Pedido</th>
                    <th>Valor</th>
                    <th>Tipo</th>
                    <th>Débito</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice(filteredChargebacks, chargebacksPage).map((cb) => (
                    <tr key={cb.settlement.id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {cb.settlement.id.slice(0, 8)}...
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {cb.settlement.orderId.slice(0, 8)}...
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                        R$ {(cb.settlement.sellerNetCents / 100).toFixed(2)}
                      </td>
                      <td>
                        <span className={`settlement-status settlement-status--${cb.type}`}>
                          {cb.type === "chargeback_cancelled" ? "Cancelado" : "Débito"}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", color: cb.debt ? "var(--color-error)" : "var(--color-text-muted)" }}>
                        {cb.debt ? `R$ ${(cb.debt.amountCents / 100).toFixed(2)}` : "—"}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                        {cb.settlement.chargebackAt
                          ? new Date(cb.settlement.chargebackAt).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </DataPanel>
          );
          })()}
        </div>
      )}

      {/* Settlement Detail Panel */}
      {selectedSettlementId && (
        <SettlementDetailPanel
          settlementId={selectedSettlementId}
          apiBaseUrl={apiBaseUrl}
          onClose={() => setSelectedSettlementId(null)}
        />
      )}
    </div>
  );
}
