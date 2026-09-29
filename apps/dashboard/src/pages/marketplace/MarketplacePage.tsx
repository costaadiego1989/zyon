import "../../components/configuration-form.css";
import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import React from "react";
import { Store, ShoppingBag, Zap, Clock, TrendingUp, Truck, BarChart3, DollarSign, CheckCircle, AlertCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { EmptyState } from "../../components/EmptyState.js";
import { TabBar } from "../../components/TabBar.js";
import { Button } from "../../components/Button.js";
import { Modal } from "../../components/Modal.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import { PageLoader } from "../../components/PageLoader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { StatCard } from "../overview/components/StatCard.js";
import { FilterToolbar } from "../../components/FilterToolbar.js";
import { useMarketplacePage } from "./useMarketplacePage.js";
import { OrderRow } from "./components/OrderRow.js";
import { SettlementDetailPanel } from "./components/SettlementDetailPanel.js";
import { MarketplaceSettings } from "./components/MarketplaceSettings.js";
import { StoreDiscoveryGrid } from "./components/StoreDiscoveryGrid.js";
import "./marketplace-page.css";

const SETTLEMENT_STATUS_PT: Record<string, string> = {
  awaiting_return_window: "Aguardando devolução",
  awaiting_chargeback_window: "Aguardando contestação",
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

const formatCurrency = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

interface MarketplacePageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function MarketplacePage({ me, apiBaseUrl }: MarketplacePageProps) {
  const { state, actions } = useMarketplacePage(me);
  const { config, orders, stats, loading, saving, tab, settlements, chargebacks, chargebackStats, selectedSettlementId, errors, actionError } = state;
  const { saveConfig, markShipped, markDelivered, setTab, setSelectedSettlementId, retrySection, clearActionError } = actions;

  // Page-based pagination for the data lists, matching the Produtos/Estoque layout.
  const LIST_PAGE_SIZE = 10;
  const [ordersPage, setOrdersPage] = React.useState(1);
  const [settlementsPage, setSettlementsPage] = React.useState(1);
  const [returnsPage, setReturnsPage] = React.useState(1);
  const [chargebacksPage, setChargebacksPage] = React.useState(1);
  const pageSlice = <T,>(arr: T[], page: number): T[] => { const safe = Math.min(page, Math.max(1, Math.ceil(arr.length / LIST_PAGE_SIZE))); return arr.slice((safe - 1) * LIST_PAGE_SIZE, safe * LIST_PAGE_SIZE); };

  // Filters (FilterToolbar) per data list — status chips + search, like the Produtos screen.
  const [ordersStatus, setOrdersStatus] = React.useState("all");
  const [ordersSearch, setOrdersSearch] = React.useState("");
  const [settlementsStatus, setSettlementsStatus] = React.useState("all");
  const [settlementsSearch, setSettlementsSearch] = React.useState("");
  const [returnsSearch, setReturnsSearch] = React.useState("");
  const [chargebacksSearch, setChargebacksSearch] = React.useState("");

  const [settingsDirty, setSettingsDirty] = React.useState(false);
  const [pendingTab, setPendingTab] = React.useState<string | null>(null);
  const sectionError = errors[tab === "returns" ? "settlements" : tab];
  const changeTab = (key: string) => { if (saving || key === tab) return; if (settingsDirty && tab === "settings") { setPendingTab(key); return; } clearActionError(); setTab(key as typeof tab); };
  if (!me) {
    return (
      <div className="marketplace-page">
        <PageHeader title="Marketplace" description="Gerencie como seus produtos aparecem em lojas parceiras" />
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
        <PageHeader title="Marketplace" />
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="marketplace-page">
      <PageHeader title="Marketplace" description={<>{tab === "settings"
              ? "Gerencie comissões, janelas de pagamento e lojas parceiras"
              : tab === "settlements"
              ? "Acompanhe repasses, janelas e status de cada venda entre lojas"
              : tab === "chargebacks"
              ? "Acompanhe contestações e seus efeitos nos repasses"
              : tab === "stores"
              ? "Descubra e habilite lojas parceiras para vender seus produtos"
              : "Pedidos recebidos de lojas parceiras que vendem seus produtos"}</>} />
      <SetupGuide title="Como organizar as vendas com parceiros" steps={[{"title":"Revise as lojas participantes","description":"Confira a conexão com cada loja e quais produtos fazem parte da operação."},{"title":"Defina as condições","description":"Revise comissões, devoluções e repasses. Exemplo: 10% de comissão sobre R$ 100 corresponde a R$ 10, antes de outras condições aplicáveis."},{"title":"Acompanhe a operação","description":"Use Pedidos, Repasses e Devoluções para conferir cada etapa. O estado exibido depende do processamento da operação."}]} />

      <TabBar
        tabs={[
          { key: "stores", label: "Lojas" },
          { key: "orders", label: "Pedidos" },
          { key: "settlements", label: "Repasses" },
          { key: "returns", label: "Devoluções" },
          { key: "chargebacks", label: "Contestações" },
          { key: "settings", label: "Configurações" },
        ]}
        activeTab={tab}
        onTabChange={changeTab}
      />

      {tab === "stores" && (
        <SectionErrorBoundary sectionName="Lojas Parceiras">
          <StoreDiscoveryGrid apiBaseUrl={apiBaseUrl} />
        </SectionErrorBoundary>
      )}

      {sectionError && <EmptyState icon={AlertCircle} title="Esta seção está indisponível" description={sectionError} action={<Button onClick={() => void retrySection()}>Tentar novamente</Button>} />}
      {actionError && <p className="marketplace-error" role="alert">{actionError}</p>}
      {tab === "settings" && !sectionError && <MarketplaceSettings config={config} saving={saving} saveConfig={saveConfig} onDirtyChange={setSettingsDirty} />}

      {tab === "orders" && !sectionError && (
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
              <>
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
<DataPanel
                title="Pedidos recebidos"
                isEmpty={rows.length === 0}
                empty={{ icon: ShoppingBag, title: orders.length ? "Nenhum pedido com estes filtros" : "Nenhum registro por enquanto", description: orders.length ? "Ajuste a busca ou limpe os filtros para ver os registros." : "Quando uma loja parceira vender seus produtos, o pedido aparecerá aqui.", action: orders.length ? <Button variant="outline" onClick={() => { setOrdersSearch(""); setOrdersStatus("all"); setOrdersPage(1); }}>Limpar filtros</Button> : undefined }}
                page={Math.min(ordersPage, Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE)))}
                pageSize={LIST_PAGE_SIZE}
                total={rows.length}
                onPageChange={setOrdersPage}
              >

                <table className="marketplace-orders__table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Loja parceira</th>
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
</>
            );
          })()}
        </div>
        </SectionErrorBoundary>
      )}

      {tab === "settlements" && !sectionError && (
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
          <>
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
<DataPanel
            title="Repasses"
            isEmpty={filteredSettlements.length === 0}
            empty={{ icon: Clock, title: settlements.length ? "Nenhum repasse com estes filtros" : "Nenhum registro por enquanto", description: settlements.length ? "Ajuste a busca ou limpe os filtros para ver os registros." : "Acompanhe aqui os repasses e as etapas de cada pagamento.", action: settlements.length ? <Button variant="outline" onClick={() => { setSettlementsSearch(""); setSettlementsStatus("all"); setSettlementsPage(1); }}>Limpar filtros</Button> : undefined }}
            page={Math.min(settlementsPage, Math.max(1, Math.ceil(filteredSettlements.length / LIST_PAGE_SIZE)))}
            pageSize={LIST_PAGE_SIZE}
            total={filteredSettlements.length}
            onPageChange={setSettlementsPage}
          >

            <table className="marketplace-orders__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Pedido</th>
                  <th>Valor líquido</th>
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
                      {formatCurrency(s.sellerNetCents)}
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
                      <Button variant="outline" onClick={() => setSelectedSettlementId(s.id)}>
                        Detalhes
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
</>
          );
          })()}
        </div>
        </SectionErrorBoundary>
      )}

      {tab === "returns" && !sectionError && (() => {
        const allReturned = settlements.filter((s) => s.status === "return_cancelled");
        const rq = returnsSearch.trim().toLowerCase();
        const returned = rq ? allReturned.filter((s) => `${s.id} ${s.orderId}`.toLowerCase().includes(rq)) : allReturned;
        const returnedValueCents = allReturned.reduce((sum, s) => sum + s.sellerNetCents, 0);
        const returnRate = settlements.length > 0 ? allReturned.length / settlements.length : 0;
        return (
          <div className="marketplace-page__returns" style={{ display: "flex", flexDirection: "column", gap: "var(--page-section-gap, 24px)" }}>
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

            <>
<FilterToolbar
                tabs={[{ key: "all", label: "Todas" }]}
                activeTab="all"
                onTabChange={() => {}}
                search={returnsSearch}
                onSearchChange={(v) => { setReturnsSearch(v); setReturnsPage(1); }}
                searchPlaceholder="Buscar por repasse ou pedido"
              />
<DataPanel
              title="Devoluções de vendas entre lojas"
              isEmpty={returned.length === 0}
              empty={{ icon: Store, title: allReturned.length ? "Nenhuma devolução com estes filtros" : "Nenhum registro por enquanto", description: allReturned.length ? "Ajuste a busca ou limpe os filtros para ver os registros." : "As devoluções de vendas entre lojas aparecerão aqui quando registradas.", action: allReturned.length ? <Button variant="outline" onClick={() => { setReturnsSearch(""); setReturnsPage(1); }}>Limpar filtros</Button> : undefined }}
              page={Math.min(returnsPage, Math.max(1, Math.ceil(returned.length / LIST_PAGE_SIZE)))}
              pageSize={LIST_PAGE_SIZE}
              total={returned.length}
              onPageChange={setReturnsPage}
            >

              <table className="marketplace-orders__table">
                <thead>
                  <tr><th>Repasse</th><th>Pedido</th><th>Valor</th><th>Status</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {pageSlice(returned, returnsPage).map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.id.slice(0, 8)}...</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.orderId.slice(0, 8)}...</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{formatCurrency(s.sellerNetCents)}</td>
                      <td><span className={`settlement-status settlement-status--${s.status}`}>{settlementStatusLabel(s.status)}</span></td>
                      <td style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{new Date(s.createdAt).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
</>
          </div>
        );
      })()}

      {tab === "chargebacks" && !sectionError && (
        <div className="marketplace-page__chargebacks" style={{ display: "flex", flexDirection: "column", gap: "var(--page-section-gap, 24px)" }}>
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
          <>
<FilterToolbar
                tabs={[{ key: "all", label: "Todos" }]}
                activeTab="all"
                onTabChange={() => {}}
                search={chargebacksSearch}
                onSearchChange={(v) => { setChargebacksSearch(v); setChargebacksPage(1); }}
                searchPlaceholder="Buscar por repasse ou pedido"
              />
<DataPanel
            title="Contestações"
            isEmpty={filteredChargebacks.length === 0}
            empty={{ icon: Zap, title: chargebacks.length ? "Nenhuma contestação com estes filtros" : "Nenhum registro por enquanto", description: chargebacks.length ? "Ajuste a busca ou limpe os filtros para ver os registros." : "As contestações de vendas entre lojas aparecerão aqui quando registradas.", action: chargebacks.length ? <Button variant="outline" onClick={() => { setChargebacksSearch(""); setChargebacksPage(1); }}>Limpar filtros</Button> : undefined }}
            page={Math.min(chargebacksPage, Math.max(1, Math.ceil(filteredChargebacks.length / LIST_PAGE_SIZE)))}
            pageSize={LIST_PAGE_SIZE}
            total={filteredChargebacks.length}
            onPageChange={setChargebacksPage}
          >

              <table className="marketplace-orders__table">
                <thead>
                  <tr>
                    <th>Repasse</th>
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
                        {formatCurrency(cb.settlement.sellerNetCents)}
                      </td>
                      <td>
                        <span className={`settlement-status settlement-status--${cb.type}`}>
                          {cb.type === "chargeback_cancelled" ? "Cancelado" : "Débito"}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", color: cb.debt ? "var(--color-error)" : "var(--color-text-muted)" }}>
                        {cb.debt ? formatCurrency(cb.debt.amountCents) : "—"}
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
</>
          );
          })()}
        </div>
      )}

      <Modal isOpen={pendingTab !== null} title="Sair sem salvar as configurações?" subtitle="As alterações desta tela ainda não foram aplicadas." presentation="center" size="md" onClose={() => setPendingTab(null)} footer={<><Button variant="outline" onClick={() => setPendingTab(null)}>Continuar editando</Button><Button variant="danger" onClick={() => { if (pendingTab) setTab(pendingTab as typeof tab); setPendingTab(null); setSettingsDirty(false); clearActionError(); }}>Descartar e sair</Button></>}><p className="marketplace-help">Salve a configuração para aplicar a participação, os prazos e os bloqueios.</p></Modal>
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
