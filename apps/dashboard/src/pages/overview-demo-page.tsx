import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import type { DashboardOverview, MerchantRules, SupportTicket } from "@zyon/shared-types";
import { createDashboardApi, type MerchantProfile } from "../api-client.js";
import { RulesForm } from "../components/rules-form.js";

export interface PilotDashboardMetrics {
  completedOrders: number;
  conversionRate: number;
  offersAccepted: number;
  offersViewed: number;
  offerAcceptanceRate: number;
  selectedShippingSessions: number;
  pendingShippingSessions: number;
  averageSelectedShipping: number;
  openSupportTickets: number | null;
  resolvedSupportTickets: number | null;
  incrementalRevenue: number;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function buildPilotMetrics(
  overview: DashboardOverview | null,
  supportTickets: SupportTicket[] | null
): PilotDashboardMetrics {
  const recentSessions = overview?.recent_sessions ?? [];
  const selectedShippingSessions = recentSessions.filter((session) => Boolean(session.shipping)).length;
  const pendingShippingSessions = recentSessions.filter((session) => !session.shipping).length;
  const shippingPrices = recentSessions
    .map((session) => session.shipping?.customerPrice)
    .filter((value): value is number => typeof value === "number");
  const openSupportTickets = supportTickets
    ? supportTickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress").length
    : null;
  const resolvedSupportTickets = supportTickets
    ? supportTickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "closed").length
    : null;
  const offersViewed = overview?.offers_viewed ?? 0;
  const offersAccepted = overview?.offers_accepted ?? 0;

  return {
    completedOrders: overview?.orders_completed ?? 0,
    conversionRate: overview?.conversion_rate_with_agent ?? 0,
    offersAccepted,
    offersViewed,
    offerAcceptanceRate: offersViewed ? offersAccepted / offersViewed : 0,
    selectedShippingSessions,
    pendingShippingSessions,
    averageSelectedShipping: average(shippingPrices),
    openSupportTickets,
    resolvedSupportTickets,
    incrementalRevenue: overview?.incremental_revenue ?? 0
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2)}`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function OverviewDemoPage(props: {
  apiBaseUrl: string;
  defaultMerchantId: string;
  me?: MerchantProfile | null;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);

  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [rules, setRules] = useState<MerchantRules | null>(null);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[] | null>(null);
  const [saving, setSaving] = useState(false);
  const pilotMetrics = useMemo(() => buildPilotMetrics(overview, supportTickets), [overview, supportTickets]);

  const load = useCallback(async () => {
    try {
      const [orders, payments, rl] = await Promise.all([
        api.getOrders(100),
        api.getPayments(100),
        api.getMerchantRules(),
      ]);
      const approvedPayments = payments.filter((payment) => payment.status === "approved");
      setOverview({
        merchant_id: props.me?.id ?? props.defaultMerchantId,
        conversations_started: 0,
        orders_completed: orders.filter((order) => order.status === "approved").length,
        conversion_rate_with_agent: 0,
        offers_viewed: 0,
        offers_accepted: 0,
        average_discount: 0,
        average_shipping_subsidy: 0,
        incremental_revenue: approvedPayments.reduce(
          (sum, payment) => sum + (payment.approved_amount ?? payment.amount),
          0,
        ) / 100,
        recent_offers: [],
        recent_sessions: [],
      });
      setRules(rl);
      if (props.me) {
        try {
          setSupportTickets(await api.getSupportTickets());
        } catch {
          setSupportTickets(null);
        }
      } else {
        setSupportTickets(null);
      }
    } catch {
      setOverview(null);
      setRules(null);
      setSupportTickets(null);
    }
  }, [api, props.me]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRules() {
    if (!rules) return;
    setSaving(true);
    try {
      const saved = await api.putMerchantRules(rules);
      setRules(saved);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Operacao do tenant</h1>
          <p>Metricas derivadas dos read models autenticados de pedidos, pagamentos e suporte.</p>
        </div>
      </header>

      <section className="metrics">
        <Metric label="Conversas" value={overview?.conversations_started ?? "-"} />
        <Metric label="Pedidos concluidos" value={overview ? pilotMetrics.completedOrders : "-"} />
        <Metric label="Conversao agente" value={overview ? formatPercent(pilotMetrics.conversionRate) : "-"} />
        <Metric label="Ofertas" value={overview ? `${pilotMetrics.offersAccepted}/${pilotMetrics.offersViewed}` : "-"} />
        <Metric label="Aceite ofertas" value={overview ? formatPercent(pilotMetrics.offerAcceptanceRate) : "-"} />
        <Metric label="Frete selecionado" value={overview ? pilotMetrics.selectedShippingSessions : "-"} />
        <Metric label="Frete pendente" value={overview ? pilotMetrics.pendingShippingSessions : "-"} />
        <Metric label="Frete medio" value={overview ? formatCurrency(pilotMetrics.averageSelectedShipping) : "-"} />
        <Metric label="Suporte aberto" value={pilotMetrics.openSupportTickets ?? "login"} />
        <Metric label="Suporte resolvido" value={pilotMetrics.resolvedSupportTickets ?? "login"} />
        <Metric label="Receita atribuida" value={overview ? formatCurrency(pilotMetrics.incrementalRevenue) : "-"} />
      </section>

      <section className="layout">
        <div className="panel">
          <div className="panel-title">
            <h2>Regras comerciais</h2>
            <button onClick={() => void saveRules()} disabled={saving || !rules}>
              <Save size={16} />
              Salvar
            </button>
          </div>
          {rules ? <RulesForm rules={rules} onChange={setRules} /> : <p>Carregando regras...</p>}
        </div>

        <div className="panel">
          <div className="panel-title">
            <h2>Atividade</h2>
            <button type="button" onClick={() => void load()}>
              <RefreshCw size={16} />
              Atualizar
            </button>
          </div>
          <h3>Ofertas recentes</h3>
          <div className="list">
            {overview?.recent_offers?.length ? (
              overview.recent_offers.map((offer) => (
                <article key={offer.id}>
                  <strong>{offer.type}</strong>
                  <span>
                    {offer.approved ? "Aprovada" : "Bloqueada"} - {offer.reason}
                  </span>
                  <span>Margem: {Math.round(offer.marginAfterOffer * 100)}%</span>
                </article>
              ))
            ) : (
              <p>Nenhuma oferta registrada.</p>
            )}
          </div>
          <h3>Sessoes recentes</h3>
          <div className="list">
            {overview?.recent_sessions?.length ? (
              overview.recent_sessions.map((session) => (
                <article key={session.sessionId}>
                  <strong>{session.sessionId}</strong>
                  <span>{session.globalUserId}</span>
                  <span>Score: {Math.round(session.abandonmentScore * 100)}%</span>
                </article>
              ))
            ) : (
              <p>Nenhuma sessao registrada.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
