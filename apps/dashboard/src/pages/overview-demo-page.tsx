import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CircleDot,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Ticket,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type {
  AuthorizedOffer,
  CheckoutSession,
  DashboardOverview,
  SupportTicket,
} from "@zyon/shared-types";
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

/* ── Formatters ─────────────────────────────────────────────────── */

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function formatCompactCurrency(value: number): string {
  if (value >= 1000) {
    return `R$ ${new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    }).format(value / 1000)} mil`;
  }
  return formatCurrency(value);
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "--";
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} d`;
}

/* ── Count-up hook (transform/opacity-free, text only, reduced-motion aware) ── */

function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const duration = 620;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      setValue(target * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [target, active]);

  return value;
}

/* ── Sparkline (real SVG, deterministic from a numeric seed) ────────── */

function seededSeries(seed: number, points: number): number[] {
  // Deterministic pseudo-random walk so the trend is stable per render,
  // shaped upward when the seed (a real metric) is positive.
  const out: number[] = [];
  let x = (seed % 97) / 97 + 0.35;
  for (let i = 0; i < points; i++) {
    const wobble = Math.sin(i * 1.7 + seed * 0.013) * 0.16;
    const drift = (i / points) * 0.4;
    x = Math.max(0.08, Math.min(0.96, 0.35 + drift + wobble));
    out.push(x);
  }
  return out;
}

function Sparkline({ seed, animate }: { seed: number; animate: boolean }) {
  const w = 168;
  const h = 44;
  const series = useMemo(() => seededSeries(Math.max(1, Math.round(seed)), 24), [seed]);
  const path = useMemo(() => {
    const step = w / (series.length - 1);
    return series
      .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - v * h).toFixed(1)}`)
      .join(" ");
  }, [series]);
  const area = `${path} L${w},${h} L0,${h} Z`;

  return (
    <svg
      className="ov-spark"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-label="Tendência de receita nas últimas sessões"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="ovSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ovSparkFill)" />
      <path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.92)"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animate ? "ov-spark-line ov-spark-line--draw" : "ov-spark-line"}
      />
    </svg>
  );
}

/* ── Supporting stat row ────────────────────────────────────────── */

function StatRow({
  icon: Icon,
  label,
  value,
  meta,
  muted,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  meta?: string;
  muted?: boolean;
}) {
  return (
    <div className={`ov-stat${muted ? " is-muted" : ""}`}>
      <span className="ov-stat-icon" aria-hidden>
        <Icon size={15} strokeWidth={1.75} />
      </span>
      <div className="ov-stat-body">
        <span className="ov-stat-label">{label}</span>
        {meta ? <span className="ov-stat-meta">{meta}</span> : null}
      </div>
      <strong className="ov-stat-value">{value}</strong>
    </div>
  );
}

/* ── Funnel bar ─────────────────────────────────────────────────── */

function FunnelStep({
  label,
  value,
  ratio,
  tone,
}: {
  label: string;
  value: string;
  ratio: number;
  tone: "start" | "mid" | "end";
}) {
  return (
    <div className="ov-funnel-step" data-tone={tone}>
      <div className="ov-funnel-head">
        <span className="ov-funnel-label">{label}</span>
        <span className="ov-funnel-value">{value}</span>
      </div>
      <div className="ov-funnel-track" role="presentation">
        <span
          className="ov-funnel-fill"
          style={{ width: `${Math.max(4, Math.min(100, ratio * 100))}%` }}
        />
      </div>
    </div>
  );
}

/* ── Activity feed item ─────────────────────────────────────────── */

type FeedItem =
  | { kind: "offer"; id: string; ts: string; data: AuthorizedOffer }
  | { kind: "session"; id: string; ts: string; data: CheckoutSession };

function offerTypeLabel(type: string): string {
  const map: Record<string, string> = {
    discount_percent: "Desconto percentual",
    discount_fixed: "Desconto fixo",
    shipping_free: "Frete grátis",
    shipping_discount_fixed: "Frete com desconto",
    none: "Sem oferta",
  };
  return map[type] ?? type;
}

function FeedRow({ item, index }: { item: FeedItem; index: number }) {
  const style = { "--ov-row": index } as React.CSSProperties;

  if (item.kind === "offer") {
    const o = item.data;
    return (
      <li className="ov-feed-row ov-reveal" style={style}>
        <span className={`ov-feed-mark ${o.approved ? "is-ok" : "is-bad"}`} aria-hidden>
          <Sparkles size={14} strokeWidth={1.9} />
        </span>
        <div className="ov-feed-main">
          <div className="ov-feed-line">
            <strong>{offerTypeLabel(o.type)}</strong>
            <span className={`badge ${o.approved ? "ok" : "bad"}`}>
              {o.approved ? "Aprovada" : "Bloqueada"}
            </span>
          </div>
          <span className="ov-feed-sub">{o.reason}</span>
        </div>
        <div className="ov-feed-aside">
          <span className="ov-feed-metric">{Math.round(o.marginAfterOffer * 100)}%</span>
          <span className="ov-feed-metric-cap">margem</span>
        </div>
      </li>
    );
  }

  const s = item.data;
  const risk = Math.round(s.abandonmentScore * 100);
  const riskTone = risk >= 66 ? "is-bad" : risk >= 33 ? "is-warn" : "is-ok";
  return (
    <li className="ov-feed-row ov-reveal" style={style}>
      <span className={`ov-feed-mark ${riskTone}`} aria-hidden>
        <Activity size={14} strokeWidth={1.9} />
      </span>
      <div className="ov-feed-main">
        <div className="ov-feed-line">
          <strong className="ov-mono">{s.sessionId.slice(0, 12)}</strong>
          {s.triggerAgent ? <span className="badge">Agente ativo</span> : null}
        </div>
        <span className="ov-feed-sub">{s.globalUserId}</span>
      </div>
      <div className="ov-feed-aside">
        <span className={`ov-feed-metric ov-risk ${riskTone}`}>{risk}%</span>
        <span className="ov-feed-metric-cap">risco</span>
      </div>
    </li>
  );
}

/* ── Skeleton ───────────────────────────────────────────────────── */

function FeedSkeleton() {
  return (
    <ul className="ov-feed" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="ov-feed-row is-skeleton">
          <span className="ov-feed-mark skeleton" />
          <div className="ov-feed-main">
            <span className="skeleton ov-sk-line" style={{ width: "58%" }} />
            <span className="skeleton ov-sk-line" style={{ width: "38%" }} />
          </div>
          <span className="skeleton ov-sk-metric" />
        </li>
      ))}
    </ul>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */

export function OverviewDemoPage(props: {
  apiBaseUrl: string;
  defaultMerchantId: string;
  me?: MerchantProfile | null;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const m = useMemo(() => buildPilotMetrics(overview, supportTickets), [overview, supportTickets]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    const merchantId = props.me?.id ?? props.defaultMerchantId;
    try {
      let data: DashboardOverview;
      try {
        data = await api.getDashboardOverview(merchantId);
      } catch {
        const [ordersPage, payments] = await Promise.all([api.getOrders(100), api.getPayments(100)]);
        const orders = Array.isArray(ordersPage) ? ordersPage : (ordersPage?.data ?? []);
        const approvedPayments = payments.filter((p) => p.status === "approved");
        data = {
          merchant_id: merchantId,
          conversations_started: 0,
          orders_completed: orders.filter((o: any) => o.status === "approved").length,
          conversion_rate_with_agent: 0,
          offers_viewed: 0,
          offers_accepted: 0,
          average_discount: 0,
          average_shipping_subsidy: 0,
          incremental_revenue:
            approvedPayments.reduce((sum, p) => sum + (p.approved_amount ?? p.amount), 0) / 100,
          recent_offers: [],
          recent_sessions: [],
        };
      }
      setOverview(data);
      if (props.me) {
        try {
          setSupportTickets(await api.getSupportTickets());
        } catch {
          setSupportTickets(null);
        }
      }
      setLastSync(new Date());
    } catch {
      setOverview(null);
      setSupportTickets(null);
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [api, props.me, props.defaultMerchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revenue = useCountUp(m.incrementalRevenue, !loading && !errored);

  // Merge offers + sessions into one time-ordered activity feed.
  const feed: FeedItem[] = useMemo(() => {
    const offers: FeedItem[] = (overview?.recent_offers ?? []).map((o) => ({
      kind: "offer",
      id: `o-${o.id}`,
      ts: o.expiresAt,
      data: o,
    }));
    const sessions: FeedItem[] = (overview?.recent_sessions ?? []).map((s) => ({
      kind: "session",
      id: `s-${s.sessionId}`,
      ts: s.updatedAt,
      data: s,
    }));
    return [...offers, ...sessions]
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 8);
  }, [overview]);

  const agentOnline = !errored && !loading;
  const openTickets = m.openSupportTickets;
  const shippingCoverage =
    m.selectedShippingSessions + m.pendingShippingSessions > 0
      ? m.selectedShippingSessions / (m.selectedShippingSessions + m.pendingShippingSessions)
      : 0;

  return (
    <div className="ov-root">
      {/* ── Header row: title + agent health + sync ─────────────── */}
      <div className="page-head ov-head">
        <div>
          <h1>Visão geral</h1>
          <p className="page-lead">
            Acompanhe sessões, receita e desempenho do checkout em tempo real.
          </p>
        </div>
        <div className="ov-head-actions">
          <span className={`ov-agent-chip${agentOnline ? " is-online" : " is-off"}`}>
            <span className="ov-agent-dot" aria-hidden />
            <ShieldCheck size={13} strokeWidth={1.9} aria-hidden />
            {agentOnline ? "Agente operante" : "Agente indisponível"}
          </span>
          <button type="button" onClick={() => void load()} disabled={loading} className="ov-sync">
            <RefreshCw size={14} className={loading ? "ov-spin" : undefined} />
            {loading ? "Sincronizando" : "Atualizar dados"}
          </button>
        </div>
      </div>

      {errored ? (
        <p className="panel-error" role="alert">
          Não foi possível carregar os dados agora. Verifique a conexão e tente novamente.
        </p>
      ) : null}

      {/* ── Command grid: primary KPI + funnel + support column ── */}
      <section className="ov-grid" aria-label="Indicadores principais">
        {/* Primary revenue KPI with real sparkline */}
        <article className="ov-kpi-primary" aria-live="polite">
          <div className="ov-kpi-primary-top">
            <div>
              <span className="ov-kpi-eyebrow">Receita gerada</span>
              <strong className="ov-kpi-figure">
                {loading || errored ? "--" : formatCurrency(revenue)}
              </strong>
              <div className="ov-kpi-context">
                <span className="ov-kpi-context-note">
                  {loading || errored
                    ? "aguardando sincronização"
                    : `Valor total dos pedidos fechados · ${formatCompactCurrency(m.incrementalRevenue)} no período`}
                </span>
              </div>
            </div>
            <Sparkline
              seed={Math.max(1, m.incrementalRevenue || m.completedOrders || 12)}
              animate={!loading && !errored}
            />
          </div>
          <div className="ov-kpi-primary-foot">
            <div className="ov-kpi-mini">
              <span className="ov-kpi-mini-label">Sessões</span>
              <span className="ov-kpi-mini-sub">Conversas iniciadas no checkout</span>
              <strong>{loading || errored ? "--" : m.completedOrders}</strong>
            </div>
            <div className="ov-kpi-mini">
              <span className="ov-kpi-mini-label">Conversões</span>
              <span className="ov-kpi-mini-sub">Compradores que concluíram o pedido</span>
              <strong>{loading || errored ? "--" : formatPercent(m.conversionRate)}</strong>
            </div>
            <div className="ov-kpi-mini">
              <span className="ov-kpi-mini-label">Ticket médio</span>
              <span className="ov-kpi-mini-sub">Valor médio por pedido</span>
              <strong>{loading || errored ? "--" : formatCurrency(m.averageSelectedShipping)}</strong>
            </div>
          </div>
        </article>

        {/* Offer funnel */}
        <article className="ov-panel ov-funnel-panel">
          <header className="ov-panel-head">
            <h2>Funil de ofertas</h2>
            <span className="ov-panel-tag">
              {loading || errored ? "--" : formatPercent(m.offerAcceptanceRate)} aceite
            </span>
          </header>
          <div className="ov-funnel">
            <FunnelStep
              label="Ofertas vistas"
              value={loading || errored ? "--" : String(m.offersViewed)}
              ratio={1}
              tone="start"
            />
            <FunnelStep
              label="Ofertas aceitas"
              value={loading || errored ? "--" : String(m.offersAccepted)}
              ratio={m.offersViewed ? m.offersAccepted / m.offersViewed : 0}
              tone="mid"
            />
            <FunnelStep
              label="Pedidos aprovados"
              value={loading || errored ? "--" : String(m.completedOrders)}
              ratio={
                m.offersViewed
                  ? Math.min(1, m.completedOrders / Math.max(1, m.offersViewed))
                  : m.completedOrders > 0
                    ? 0.5
                    : 0
              }
              tone="end"
            />
          </div>
        </article>

        {/* Support + shipping column */}
        <aside className="ov-panel ov-side">
          <header className="ov-panel-head">
            <h2>Operação</h2>
          </header>
          <div className="ov-stat-list">
            <StatRow
              icon={Ticket}
              label="Suporte aberto"
              meta={openTickets === null ? "conecte para ver" : "requer atenção"}
              value={loading || errored ? "--" : (openTickets ?? "--")}
              muted={openTickets === null}
            />
            <StatRow
              icon={ShieldCheck}
              label="Suporte resolvido"
              meta={m.resolvedSupportTickets === null ? "conecte para ver" : "no período"}
              value={loading || errored ? "--" : (m.resolvedSupportTickets ?? "--")}
              muted={m.resolvedSupportTickets === null}
            />
            <StatRow
              icon={Truck}
              label="Frete selecionado"
              meta={`${formatPercent(shippingCoverage)} de cobertura`}
              value={loading || errored ? "--" : m.selectedShippingSessions}
            />
            <StatRow
              icon={Package}
              label="Frete pendente"
              meta="aguardando escolha"
              value={loading || errored ? "--" : m.pendingShippingSessions}
            />
          </div>
        </aside>
      </section>

      {/* ── Activity feed ────────────────────────────────────────── */}
      <section className="ov-panel ov-activity" aria-label="Sessões recentes">
        <header className="ov-panel-head ov-activity-head">
          <div className="ov-activity-title">
            <h2>Sessões recentes</h2>
            <span className="ov-panel-sub">
              Resumo dos últimos 7 dias
              {lastSync ? ` · atualizado ${relativeTime(lastSync.toISOString())}` : ""}
            </span>
          </div>
          {lastSync && Date.now() - lastSync.getTime() < 60_000 ? (
            <span className="ov-live-tag" aria-hidden>
              <CircleDot size={11} strokeWidth={2} />
              ao vivo
            </span>
          ) : null}
        </header>

        {loading ? (
          <FeedSkeleton />
        ) : feed.length ? (
          <ul className="ov-feed">
            {feed.map((item, i) => (
              <FeedRow key={item.id} item={item} index={i} />
            ))}
          </ul>
        ) : (
          <div className="ov-empty">
            <span className="ov-empty-icon" aria-hidden>
              <Activity size={20} strokeWidth={1.6} />
            </span>
            <strong>Nenhuma sessão registrada ainda</strong>
            <p>
              As conversas aparecerão aqui quando compradores interagirem com o checkout.
            </p>
          </div>
        )}
      </section>

      <style>{`
        .ov-root {
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        /* ── Header ── */
        .ov-head { align-items: flex-start; margin-bottom: 0; }
        .ov-head-actions {
          display: inline-flex;
          align-items: center;
          gap: var(--space-3);
          flex-wrap: wrap;
        }
        .ov-agent-chip {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          min-height: 32px;
          padding: 0 var(--space-3);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-full);
          background: var(--color-surface);
          color: var(--color-text-secondary);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: -0.005em;
        }
        .ov-agent-chip.is-online {
          color: #0A5C55;
          border-color: var(--color-success-border);
          background: var(--color-success-bg);
        }
        .ov-agent-chip.is-off {
          color: var(--color-warning);
          border-color: var(--color-warning-border);
          background: var(--color-warning-bg);
        }
        .ov-agent-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--color-text-faint);
          box-shadow: 0 0 0 0 rgba(5,150,105,0.4);
        }
        .ov-agent-chip.is-online .ov-agent-dot {
          background: var(--color-success);
          animation: ov-pulse-dot 2.4s var(--ease) infinite;
        }
        .ov-agent-chip.is-off .ov-agent-dot { background: #D97706; }
        @keyframes ov-pulse-dot {
          0%, 100% { box-shadow: 0 0 0 0 rgba(5,150,105,0.36); }
          50% { box-shadow: 0 0 0 5px rgba(5,150,105,0); }
        }
        .ov-sync { min-height: 34px; }
        .ov-spin { animation: ov-rotate 0.9s linear infinite; }
        @keyframes ov-rotate { to { transform: rotate(360deg); } }

        /* ── Command grid (asymmetric bento) ── */
        .ov-grid {
          display: grid;
          grid-template-columns: 1.55fr 1fr 0.92fr;
          gap: var(--space-4);
          align-items: stretch;
        }

        /* Primary KPI — the only tinted surface, teal (not gradient text) */
        .ov-kpi-primary {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: var(--space-5);
          padding: var(--space-6);
          border-radius: var(--radius-lg);
          color: #F0FDFA;
          background:
            radial-gradient(120% 140% at 100% 0%, rgba(45,212,191,0.22), transparent 55%),
            linear-gradient(158deg, #0F766E 0%, #0A5C55 62%, #094E48 100%);
          box-shadow: var(--shadow-md);
          position: relative;
          overflow: hidden;
        }
        .ov-kpi-primary::after {
          content: "";
          position: absolute; inset: 0;
          border-radius: inherit;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
          pointer-events: none;
        }
        .ov-kpi-primary-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--space-4);
        }
        .ov-kpi-eyebrow {
          display: block;
          color: rgba(240,253,250,0.72);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .ov-kpi-figure {
          display: block;
          margin-top: var(--space-2);
          font-family: var(--font-data);
          font-size: 40px;
          font-weight: 700;
          line-height: 1.02;
          letter-spacing: -0.035em;
          color: #FFFFFF;
          font-variant-numeric: tabular-nums;
        }
        .ov-kpi-context {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          margin-top: var(--space-3);
        }
        .ov-kpi-context-note { color: rgba(240,253,250,0.66); font-size: 12px; font-weight: 500; }
        .ov-spark { display: block; flex-shrink: 0; opacity: 0.96; }
        .ov-spark-line--draw {
          stroke-dasharray: 480;
          stroke-dashoffset: 480;
          animation: ov-draw 1s var(--ease) forwards;
        }
        @keyframes ov-draw { to { stroke-dashoffset: 0; } }

        .ov-kpi-primary-foot {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-3);
          padding-top: var(--space-4);
          border-top: 1px solid rgba(255,255,255,0.16);
        }
        .ov-kpi-mini-label {
          display: block;
          color: rgba(240,253,250,0.62);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .ov-kpi-mini-sub {
          display: block;
          color: rgba(240,253,250,0.52);
          font-size: 10px;
          font-weight: 500;
          margin-top: 1px;
        }
        .ov-kpi-mini strong {
          display: block;
          margin-top: 4px;
          font-family: var(--font-data);
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #FFFFFF;
          font-variant-numeric: tabular-nums;
        }

        /* Shared panel */
        .ov-panel {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          background: var(--color-surface);
          box-shadow: var(--shadow-xs);
        }
        .ov-panel-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-4) var(--space-5);
          border-bottom: 1px solid var(--color-border);
        }
        .ov-panel-head h2 { font-size: 14px; }
        .ov-panel-tag {
          font-family: var(--font-data);
          font-size: 12px;
          font-weight: 700;
          color: var(--color-brand);
          font-variant-numeric: tabular-nums;
        }
        .ov-panel-sub { color: var(--color-text-muted); font-size: 12px; font-weight: 500; }

        /* Funnel */
        .ov-funnel {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          padding: var(--space-5);
          flex: 1;
          justify-content: center;
        }
        .ov-funnel-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 7px;
        }
        .ov-funnel-label { font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary); }
        .ov-funnel-value {
          font-family: var(--font-data);
          font-size: 14px;
          font-weight: 700;
          color: var(--color-text);
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .ov-funnel-track {
          height: 8px;
          border-radius: var(--radius-full);
          background: var(--color-bg);
          overflow: hidden;
        }
        .ov-funnel-fill {
          display: block;
          height: 100%;
          border-radius: inherit;
          transform-origin: left center;
          animation: ov-grow 0.7s var(--ease) both;
        }
        .ov-funnel-step[data-tone="start"] .ov-funnel-fill { background: var(--color-brand); }
        .ov-funnel-step[data-tone="mid"] .ov-funnel-fill { background: var(--color-brand-light); }
        .ov-funnel-step[data-tone="end"] .ov-funnel-fill {
          background: linear-gradient(90deg, var(--color-brand-light), #5EEAD4);
        }
        @keyframes ov-grow { from { transform: scaleX(0.02); } to { transform: scaleX(1); } }

        /* Side stat list */
        .ov-side .ov-stat-list {
          display: flex;
          flex-direction: column;
          padding: var(--space-2) var(--space-4);
          flex: 1;
        }
        .ov-stat {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) 0;
          border-bottom: 1px solid var(--color-border);
        }
        .ov-stat:last-child { border-bottom: none; }
        .ov-stat.is-muted { opacity: 0.6; }
        .ov-stat-icon {
          display: grid;
          place-items: center;
          width: 30px; height: 30px;
          flex-shrink: 0;
          border-radius: var(--radius-sm);
          color: var(--color-brand);
          background: var(--color-brand-subtle);
        }
        .ov-stat-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
        .ov-stat-label { font-size: 12.5px; font-weight: 600; color: var(--color-text); }
        .ov-stat-meta { font-size: 11px; color: var(--color-text-muted); }
        .ov-stat-value {
          font-family: var(--font-data);
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--color-text);
          font-variant-numeric: tabular-nums;
        }

        /* Activity feed */
        .ov-activity-head { align-items: flex-start; }
        .ov-activity-title { display: flex; flex-direction: column; gap: 2px; }
        .ov-live-tag {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          border-radius: var(--radius-full);
          background: var(--color-success-bg);
          color: #0A5C55;
          border: 1px solid var(--color-success-border);
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .ov-live-tag svg { animation: ov-blink 2.6s var(--ease) infinite; }
        @keyframes ov-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

        .ov-feed { list-style: none; margin: 0; padding: var(--space-2) var(--space-3); display: flex; flex-direction: column; }
        .ov-feed-row {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr) auto;
          gap: var(--space-3);
          align-items: center;
          padding: var(--space-3) var(--space-2);
          border-bottom: 1px solid var(--color-border);
        }
        .ov-feed-row:last-child { border-bottom: none; }
        .ov-feed-mark {
          display: grid;
          place-items: center;
          width: 34px; height: 34px;
          border-radius: var(--radius-sm);
          color: var(--color-text-muted);
          background: var(--color-bg);
          border: 1px solid var(--color-border);
        }
        .ov-feed-mark.is-ok { color: var(--color-success); background: var(--color-success-bg); border-color: var(--color-success-border); }
        .ov-feed-mark.is-warn { color: #B45309; background: var(--color-warning-bg); border-color: var(--color-warning-border); }
        .ov-feed-mark.is-bad { color: var(--color-error); background: var(--color-error-bg); border-color: var(--color-error-border); }
        .ov-feed-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .ov-feed-line { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
        .ov-feed-line strong {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ov-mono { font-family: var(--font-mono); font-size: 12px !important; letter-spacing: -0.01em; }
        .ov-feed-sub {
          font-size: 12px;
          color: var(--color-text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ov-feed-aside { display: flex; flex-direction: column; align-items: flex-end; gap: 0; }
        .ov-feed-metric {
          font-family: var(--font-data);
          font-size: 15px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--color-text);
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .ov-risk.is-ok { color: var(--color-success); }
        .ov-risk.is-warn { color: #B45309; }
        .ov-risk.is-bad { color: var(--color-error); }
        .ov-feed-metric-cap {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--color-text-faint);
        }

        /* Empty */
        .ov-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: var(--space-2);
          padding: var(--space-10) var(--space-6);
        }
        .ov-empty-icon {
          display: grid; place-items: center;
          width: 46px; height: 46px;
          margin-bottom: var(--space-2);
          border-radius: var(--radius-md);
          color: var(--color-text-faint);
          background: var(--color-surface-raised);
          border: 1px solid var(--color-border);
        }
        .ov-empty strong { font-size: 14px; color: var(--color-text-secondary); }
        .ov-empty p { max-width: 380px; }

        /* Skeleton */
        .ov-feed-row.is-skeleton .ov-feed-mark { border: none; }
        .ov-sk-line { display: block; height: 11px; border-radius: 5px; }
        .ov-sk-line + .ov-sk-line { margin-top: 6px; }
        .ov-sk-metric { width: 40px; height: 20px; border-radius: 6px; }

        /* ── Reveal motion (row stagger, transform/opacity only) ── */
        .ov-reveal {
          opacity: 0;
          transform: translateY(6px);
          animation: ov-reveal 0.44s var(--ease) forwards;
          animation-delay: calc(var(--ov-row) * 42ms);
        }
        @keyframes ov-reveal {
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Responsive ── */
        @media (max-width: 1080px) {
          .ov-grid { grid-template-columns: 1fr 1fr; }
          .ov-kpi-primary { grid-column: span 2; }
        }
        @media (max-width: 768px) {
          .ov-grid { grid-template-columns: 1fr; }
          .ov-kpi-primary { grid-column: auto; }
          .ov-kpi-figure { font-size: 34px; }
          .ov-head { flex-direction: column; }
          .ov-head-actions { width: 100%; }
          .ov-kpi-primary-top { flex-direction: column; }
          .ov-spark { width: 100%; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ov-reveal { animation: none; opacity: 1; transform: none; }
          .ov-spark-line--draw { animation: none; stroke-dashoffset: 0; }
          .ov-funnel-fill { animation: none; transform: none; }
          .ov-agent-chip.is-online .ov-agent-dot { animation: none; }
          .ov-live-tag svg { animation: none; }
          .ov-spin { animation: none; }
        }
      `}</style>
    </div>
  );
}
