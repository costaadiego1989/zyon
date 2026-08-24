import React from "react";
import { Store, ShoppingBag, Zap, Clock, TrendingUp, Truck, BarChart3, DollarSign, CheckCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { EmptyState } from "../../components/EmptyState.js";
import { TabBar } from "../../components/TabBar.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import { PageLoader } from "../../components/PageLoader.js";
import { StatCard } from "../overview/components/StatCard.js";
import { useMarketplacePage } from "./useMarketplacePage.js";
import { OrderRow } from "./components/OrderRow.js";
import { SettlementDetailPanel } from "./components/SettlementDetailPanel.js";
import { BlockedMerchantForm } from "./components/BlockedMerchantForm.js";
import { StoreDiscoveryGrid } from "./components/StoreDiscoveryGrid.js";
import "./marketplace-page.css";

interface MarketplacePageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function MarketplacePage({ me, apiBaseUrl }: MarketplacePageProps) {
  const { state, actions } = useMarketplacePage(me);
  const { config, orders, stats, loading, saving, tab, settlements, chargebacks, chargebackStats, selectedSettlementId } = state;
  const { saveConfig, markShipped, markDelivered, setTab, setSelectedSettlementId } = actions;

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
          { key: "chargebacks", label: "Chargebacks" },
          { key: "settings", label: "Configurações" },
        ]}
        activeTab={tab}
        onTabChange={(key) => setTab(key as "stores" | "orders" | "settlements" | "chargebacks" | "settings")}
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

          {orders.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={ShoppingBag}
                title="Você ainda não recebeu pedidos via marketplace"
                description="Quando lojas parceiras venderem seus produtos, os pedidos aparecerão aqui."
              />
            </div>
          ) : (
            <div className="panel">
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
                  {orders.flatMap((order) =>
                    order.line_items.map((item) => (
                      <OrderRow
                        key={item.id}
                        orderId={order.id}
                        storeName={order.host_store_name}
                        item={item}
                        onMarkShipped={markShipped}
                        onMarkDelivered={markDelivered}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
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
          {settlements.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={Clock}
                title="Nenhum repasse registrado"
                description="Quando pedidos forem finalizados, os repasses aparecerão aqui com a timeline completa."
              />
            </div>
          ) : (
            <div className="panel">
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
                  {settlements.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.id.slice(0, 8)}...</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.orderId.slice(0, 8)}...</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                        R$ {(s.sellerNetCents / 100).toFixed(2)}
                      </td>
                      <td>
                        <span className={`settlement-status settlement-status--${s.status}`}>
                          {s.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                        {new Date(s.createdAt).toLocaleDateString("pt-BR")}
                      </td>
                      <td>
                        <button
                          className="btn-sm"
                          onClick={() => setSelectedSettlementId(s.id)}
                        >
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </SectionErrorBoundary>
      )}

      {tab === "chargebacks" && (
        <div className="marketplace-page__chargebacks">
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

          {chargebacks.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={Zap}
                title="Nenhum chargeback registrado"
                description="Chargebacks recebidos de pedidos cross-store aparecerão aqui."
              />
            </div>
          ) : (
            <div className="panel">
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
                  {chargebacks.map((cb) => (
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
            </div>
          )}
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
