import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";
import type { DashboardOverview, SupportTicket } from "@zyon/shared-types";
import { createDashboardApi, type MerchantProfile } from "../api-client.js";

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
  const selectedShippingSessions = recentSessions.filter((s) => Boolean(s.shipping)).length;
  const pendingShippingSessions = recentSessions.filter((s) => !s.shipping).length;
  const shippingPrices = recentSessions
    .map((s) => s.shipping?.customerPrice)
    .filter((v): v is number => typeof v === "number");
  const openSupportTickets = supportTickets
    ? supportTickets.filter((t) => t.status === "open" || t.status === "in_progress").length
    : null;
  const resolvedSupportTickets = supportTickets
    ? supportTickets.filter((t) => t.status === "resolved" || t.status === "closed").length
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
    incrementalRevenue: overview?.incremental_revenue ?? 0,
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function KpiCard({ label, value, muted }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div className={`metric${muted ? " metric-muted" : ""}`}>
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
  const [supportTickets, setSupportTickets] = useState<SupportTicket[] | null>(null);
  const [loading, setLoading] = useState(true);
  const m = useMemo(() => buildPilotMetrics(overview, supportTickets), [overview, supportTickets]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orders, payments] = await Promise.all([
        api.getOrders(100),
        api.getPayments(100),
      ]);
      const approvedPayments = payments.filter((p) => p.status === "approved");
      setOverview({
        merchant_id: props.me?.id ?? props.defaultMerchantId,
        conversations_started: 0,
        orders_completed: orders.filter((o) => o.status === "approved").length,
        conversion_rate_with_agent: 0,
        offers_viewed: 0,
        offers_accepted: 0,
        average_discount: 0,
        average_shipping_subsidy: 0,
        incremental_revenue:
          approvedPayments.reduce((sum, p) => sum + (p.approved_amount ?? p.amount), 0) / 100,
        recent_offers: [],
        recent_sessions: [],
      });
      if (props.me) {
        try {
          setSupportTickets(await api.getSupportTickets());
        } catch {
          setSupportTickets(null);
        }
      }
    } catch {
      setOverview(null);
      setSupportTickets(null);
    } finally {
      setLoading(false);
    }
  }, [api, props.me, props.defaultMerchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      {/* KPI grid — revenue hero first */}
      <div className="metrics">
        <div className="metric metric-hero">
          <span>
            <TrendingUp size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
            Receita atribuída
          </span>
          <strong>{loading ? "—" : formatCurrency(m.incrementalRevenue)}</strong>
        </div>

        <KpiCard label="Pedidos aprovados" value={loading ? "—" : m.completedOrders} />
        <KpiCard label="Conversão agente" value={loading ? "—" : formatPercent(m.conversionRate)} />
        <KpiCard
          label="Ofertas (aceitas/vistas)"
          value={loading ? "—" : `${m.offersAccepted}/${m.offersViewed}`}
        />
        <KpiCard label="Taxa de aceite" value={loading ? "—" : formatPercent(m.offerAcceptanceRate)} />
        <KpiCard label="Frete selecionado" value={loading ? "—" : m.selectedShippingSessions} />
        <KpiCard label="Frete pendente" value={loading ? "—" : m.pendingShippingSessions} />
        <KpiCard
          label="Frete médio"
          value={loading ? "—" : formatCurrency(m.averageSelectedShipping)}
        />
        <KpiCard
          label="Suporte aberto"
          value={loading ? "—" : (m.openSupportTickets ?? "—")}
          muted={m.openSupportTickets === null}
        />
        <KpiCard
          label="Suporte resolvido"
          value={loading ? "—" : (m.resolvedSupportTickets ?? "—")}
          muted={m.resolvedSupportTickets === null}
        />
      </div>

      {/* Activity panels */}
      <div className="layout" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel stacked">
          <div className="panel-title">
            <h2>Ofertas recentes</h2>
            <button type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} />
              Atualizar
            </button>
          </div>

          {loading ? (
            <p className="page-lead">Carregando...</p>
          ) : overview?.recent_offers?.length ? (
            <div className="list">
              {overview.recent_offers.map((offer) => (
                <article key={offer.id}>
                  <strong>{offer.type}</strong>
                  <span>{offer.approved ? "Aprovada" : "Bloqueada"} — {offer.reason}</span>
                  <span className={`badge ${offer.approved ? "ok" : "bad"}`}>
                    {Math.round(offer.marginAfterOffer * 100)}% margem
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: "var(--space-8) var(--space-4)" }}>
              <p>Nenhuma oferta registrada ainda.</p>
            </div>
          )}
        </div>

        <div className="panel stacked">
          <div className="panel-title">
            <h2>Sessões recentes</h2>
          </div>

          {loading ? (
            <p className="page-lead">Carregando...</p>
          ) : overview?.recent_sessions?.length ? (
            <div className="list">
              {overview.recent_sessions.map((session) => (
                <article key={session.sessionId}>
                  <strong style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {session.sessionId.slice(0, 14)}…
                  </strong>
                  <span>{session.globalUserId}</span>
                  <span className="badge">
                    {Math.round(session.abandonmentScore * 100)}% risco
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: "var(--space-8) var(--space-4)" }}>
              <p>Nenhuma sessão registrada ainda.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
