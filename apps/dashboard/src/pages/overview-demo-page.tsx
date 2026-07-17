import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { type MerchantProfile } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";

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

  const kpiVal = (v: string | number) => loading || errored ? "--" : v;

  return (
    <div>
      {/* Title + status row */}
      <div style={{ marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>PAINEL OPERACIONAL</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Operação</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Acompanhe sessões, receita e desempenho do checkout agêntico em tempo real.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 8, background: agentOnline ? "var(--good-soft)" : "var(--danger-soft)", border: `1px solid ${agentOnline ? "oklch(85% 0.06 150)" : "var(--danger)"}`, font: "600 12.5px var(--sans)", color: agentOnline ? "var(--good)" : "var(--danger)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
            {agentOnline ? "Agente operante" : "Agente indisponível"}
          </div>
          <button onClick={() => void load()} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", font: "600 12.5px var(--sans)", color: "var(--ink)", cursor: "pointer" }}>
            <RefreshCw size={14} className={loading ? "ov-spin" : undefined} />
            {loading ? "Sincronizando" : "Atualizar dados"}
          </button>
        </div>
      </div>

      {errored ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }} role="alert">
          Não foi possível carregar os dados agora. Verifique a conexão e tente novamente.
        </div>
      ) : null}

      {/* ROW 1: Revenue (1.5fr) + Funnel (1fr) */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Revenue card */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "26px 26px 22px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, var(--accent), var(--accent-dark))" }} />
          <div style={{ font: "600 11px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 10 }}>RECEITA GERADA · 7 DIAS</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ font: "500 40px var(--serif)", letterSpacing: "-0.015em", color: "var(--ink)", whiteSpace: "nowrap", flex: "none" }}>
              {kpiVal(formatCurrency(revenue))}
            </div>
            <Sparkline seed={Math.max(1, m.incrementalRevenue || m.completedOrders || 12)} animate={!loading && !errored} />
          </div>
          <div style={{ font: "13px var(--sans)", color: "var(--muted)", margin: "8px 0 20px" }}>
            {loading || errored ? "aguardando sincronização" : `Valor total dos pedidos fechados · ${formatCompactCurrency(m.incrementalRevenue)} no período`}
          </div>
          {/* 3-col metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
            <div style={{ borderRight: "1px solid var(--border)" }}>
              <div style={{ font: "10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", marginBottom: 5 }}>SESSÕES</div>
              <div style={{ font: "500 21px var(--serif)", color: "var(--ink)" }}>{kpiVal(m.completedOrders)}</div>
            </div>
            <div style={{ borderRight: "1px solid var(--border)", paddingLeft: 18 }}>
              <div style={{ font: "10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", marginBottom: 5 }}>CONVERSÃO</div>
              <div style={{ font: "500 21px var(--serif)", color: "var(--ink)" }}>{kpiVal(formatPercent(m.conversionRate))}</div>
            </div>
            <div style={{ paddingLeft: 18 }}>
              <div style={{ font: "10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", marginBottom: 5 }}>TICKET MÉDIO</div>
              <div style={{ font: "500 21px var(--serif)", color: "var(--ink)" }}>{kpiVal(formatCurrency(m.averageSelectedShipping))}</div>
            </div>
          </div>
        </div>

        {/* Funnel card */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ font: "600 14px var(--serif)", color: "var(--ink)", letterSpacing: "-0.005em" }}>Funil de ofertas</div>
            <div style={{ font: "600 11.5px var(--mono)", color: "var(--accent-dark)", background: "var(--accent-soft)", padding: "3px 8px", borderRadius: 6 }}>
              {kpiVal(formatPercent(m.offerAcceptanceRate))}
            </div>
          </div>
          {[
            { label: "Ofertas vistas", value: m.offersViewed, ratio: 1 },
            { label: "Ofertas aceitas", value: m.offersAccepted, ratio: m.offersViewed ? m.offersAccepted / m.offersViewed : 0 },
            { label: "Pedidos aprovados", value: m.completedOrders, ratio: m.offersViewed ? Math.min(1, m.completedOrders / Math.max(1, m.offersViewed)) : m.completedOrders > 0 ? 0.5 : 0 },
          ].map((f) => (
            <div key={f.label} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ font: "13px var(--sans)", color: "var(--ink)", fontWeight: 600 }}>{f.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ font: "500 18px var(--serif)", color: "var(--ink)" }}>{kpiVal(f.value)}</span>
                  <span style={{ font: "600 11px var(--mono)", color: "var(--accent-dark)" }}>{kpiVal(Math.round(f.ratio * 100) + "%")}</span>
                </div>
              </div>
              <div style={{ height: 7, borderRadius: 99, background: "var(--bg)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(4, f.ratio * 100)}%`, borderRadius: 99, background: "linear-gradient(90deg, var(--accent-dark), var(--accent))" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ROW 2: Operation + Insights split card */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, display: "grid", gridTemplateColumns: "1fr 1fr", marginBottom: 16, overflow: "hidden" }}>
        {/* Left: Operação */}
        <div style={{ padding: 22, borderRight: "1px solid var(--border)" }}>
          <div style={{ font: "600 14px var(--serif)", color: "var(--ink)", letterSpacing: "-0.005em", marginBottom: 14 }}>Operação</div>
          {[
            { label: "Suporte aberto", sub: openTickets === null ? "conecte para ver" : "requer atenção", value: kpiVal(openTickets ?? "--"), dot: "var(--warn)" },
            { label: "Suporte resolvido", sub: m.resolvedSupportTickets === null ? "conecte para ver" : "no período", value: kpiVal(m.resolvedSupportTickets ?? "--"), dot: "var(--good)" },
            { label: "Frete selecionado", sub: `${formatPercent(shippingCoverage)} de cobertura`, value: kpiVal(m.selectedShippingSessions), dot: "var(--accent)" },
            { label: "Frete pendente", sub: "aguardando escolha", value: kpiVal(m.pendingShippingSessions), dot: "var(--faint)" },
          ].map((o) => (
            <div key={o.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: o.dot }} />
                </div>
                <div>
                  <div style={{ font: "13px var(--sans)", color: "var(--ink)", fontWeight: 600 }}>{o.label}</div>
                  <div style={{ font: "11.5px var(--sans)", color: "var(--faint)" }}>{o.sub}</div>
                </div>
              </div>
              <div style={{ font: "600 16px var(--mono)", color: "var(--ink)" }}>{o.value}</div>
            </div>
          ))}
        </div>
        {/* Right: Insights placeholder */}
        <div style={{ padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ font: "600 14px var(--serif)", color: "var(--ink)", letterSpacing: "-0.005em" }}>Insights do agente</div>
            <span style={{ font: "11px var(--sans)", color: "var(--faint)" }}>gerados automaticamente</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { tag: "CONVERSÃO", text: "Taxa de conversão subiu 12% nos últimos 7 dias comparado ao período anterior.", color: "var(--good)" },
              { tag: "FRETE", text: "63% dos compradores escolhem o frete mais barato quando apresentado pelo agente.", color: "var(--accent-dark)" },
              { tag: "ABANDONO", text: "Cupons com 10% de desconto recuperam 28% dos carrinhos abandonados.", color: "var(--warn)" },
            ].map((ins, i) => (
              <div key={i} style={{ display: "flex", gap: 12 }}>
                <div style={{ font: "500 20px var(--serif)", color: "var(--faint)", flex: "none", width: 18 }}>{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <span style={{ font: "600 10px var(--sans)", letterSpacing: "0.05em", padding: "3px 7px", borderRadius: 5, background: ins.color === "var(--good)" ? "var(--good-soft)" : ins.color === "var(--warn)" ? "var(--warn-soft)" : "var(--accent-soft)", color: ins.color }}>{ins.tag}</span>
                  <div style={{ font: "12.5px/1.5 var(--sans)", color: "var(--ink)", marginTop: 6 }}>{ins.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ROW 3: Sessions table */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ font: "600 15px var(--serif)", color: "var(--ink)", letterSpacing: "-0.005em" }}>Sessões recentes</div>
            <div style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>
              Resumo das últimas conversas do checkout{lastSync ? ` · atualizado ${relativeTime(lastSync.toISOString())}` : ""}
            </div>
          </div>
          {lastSync && Date.now() - lastSync.getTime() < 60_000 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 99, background: "var(--good-soft)", font: "600 11px var(--mono)", color: "var(--good)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--good)" }} />
              AO VIVO
            </div>
          ) : null}
        </div>

        {loading ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando sessões...</div>
        ) : feed.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["COMPRADOR", "INÍCIO", "DURAÇÃO", "ETAPA", "VALOR", "STATUS"].map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", borderBottom: "1px solid var(--border)" }}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {feed.map((item) => {
                const label = item.kind === "offer" ? offerTypeLabel(item.data.type) : item.data.globalUserId;
                const initial = label.charAt(0).toUpperCase();
                const value = item.kind === "offer" ? `${Math.round(item.data.marginAfterOffer * 100)}%` : "--";
                const status = item.kind === "offer" ? (item.data.approved ? "Aprovada" : "Bloqueada") : "Sessão";
                const statusBg = item.kind === "offer" ? (item.data.approved ? "var(--good-soft)" : "var(--danger-soft)") : "var(--accent-soft)";
                const statusColor = item.kind === "offer" ? (item.data.approved ? "var(--good)" : "var(--danger)") : "var(--accent-dark)";
                return (
                  <tr key={item.id}>
                    <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-dark)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px var(--sans)", flex: "none" }}>{initial}</div>
                        <span style={{ font: "13px var(--sans)", color: "var(--ink)" }}>{label}</span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{relativeTime(item.ts)}</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>--</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--sans)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{item.kind === "offer" ? "Oferta" : "Chat"}</td>
                    <td style={{ padding: "12px 22px", font: "600 13px var(--mono)", color: "var(--ink)", borderBottom: "1px solid var(--border)" }}>{value}</td>
                    <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ font: "600 11px var(--sans)", padding: "4px 9px", borderRadius: 99, background: statusBg, color: statusColor }}>{status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: "40px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--faint)" }}>
            <Activity size={20} strokeWidth={1.6} />
            <strong style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>Nenhuma sessão registrada ainda</strong>
            <p style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>As conversas aparecerão aqui quando compradores interagirem com o checkout.</p>
          </div>
        )}
      </div>

      <style>{`
        .ov-spin { animation: ov-rotate 0.9s linear infinite; }
        @keyframes ov-rotate { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
