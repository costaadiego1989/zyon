import { useEffect, useState, useCallback } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type FunnelPeriod = "today" | "7d" | "30d" | "90d";
export type FunnelBreakdownDimension = "none" | "device" | "buyer_type" | "payment_method";
export type FunnelSource = "storefront" | "checkout";
export type FunnelPlan = "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH" | "API";

export interface FunnelStep {
  name: string;
  label: string;
  count: number;
  percentage: number;
}

export interface FunnelTransition {
  from: string;
  to: string;
  rate: number;
  dropOff: number;
  avgTimeSeconds: number;
}

export interface FunnelBottleneck {
  step: string;
  dropOff: number;
  suggestion: string;
  /** Source module that explains the bottleneck (e.g. "intent-memory", "cart-recovery"). */
  source?: string;
  /** Actionable, context-aware insight keys produced by the AI modules. */
  insight?: FunnelInsight;
}

export interface FunnelInsight {
  /** Short headline for the insight (e.g. "Maior fricção em Cadastro"). */
  headline: string;
  /** Detailed multi-line explanation referencing AI module data. */
  detail: string;
  /** Suggested action the merchant can take. */
  action: string;
  /** Source module that produced the insight. */
  module: "intent-memory" | "cart-recovery" | "revenue-manager" | "rules-engine" | "shipping-engine" | "general";
}

export interface FunnelSegment {
  steps: FunnelStep[];
  overallConversion: number;
}

export interface FunnelPreviousPeriod {
  steps: FunnelStep[];
  overallConversion: number;
  totalSessions: number;
}

export interface FunnelData {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
  bottleneck: FunnelBottleneck | null;
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
  breakdowns?: Record<string, FunnelSegment>;
  previous?: FunnelPreviousPeriod;
}

export interface FunnelSession {
  sessionId: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerName?: string;
  buyerHint?: string;
  stage: string;
  lastActivityAt: string;
  abandonmentScore: number;
}

export interface FunnelSessionsResponse {
  sessions: FunnelSession[];
  total: number;
  status?: "active" | "all";
}

export interface FunnelPageVM {
  period: FunnelPeriod;
  setPeriod: (p: FunnelPeriod) => void;
  dateRange: { from: string; to: string };
  setDateRange: (r: { from: string; to: string }) => void;
  breakdown: FunnelBreakdownDimension;
  setBreakdown: (b: FunnelBreakdownDimension) => void;
  compareEnabled: boolean;
  setCompareEnabled: (v: boolean) => void;
  funnelSource: FunnelSource;
  setFunnelSource: (s: FunnelSource) => void;
  showSourceTabs: boolean;
  data: FunnelData | null;
  sessions: FunnelSession[];
  loading: boolean;
  sessionsLoading: boolean;
  sessionsError: string | null;
  error: string | null;
  refresh: () => void;
  exportCsv: () => void;
}

/**
 * Steps that belong to the store journey context.
 * Store journey: session → product view → cart → registration/login flow.
 */
const STOREFRONT_CONTEXT_STEPS = new Set([
  "checkout_started",
  "product_viewed",
  "cart_viewed",
  "auth_phone_submitted",
  "auth_phone_verified",
  "auth_identity_confirmed",
  "auth_registration_completed",
  "login_completed",
]);

/**
 * Steps that belong to the checkout journey context.
 * Checkout journey: checkout start → shipping → coupon → payment → completion.
 */
const CHECKOUT_CONTEXT_STEPS = new Set([
  "checkout_started",
  "auth_completed",
  "shipping_calculated",
  "coupon_applied",
  "payment_method_selected",
  "order_completed",
  "payment_failed",
]);

function filterFunnelByContext(data: FunnelData, source: FunnelSource): FunnelData {
  const allowedSteps = source === "storefront" ? STOREFRONT_CONTEXT_STEPS : CHECKOUT_CONTEXT_STEPS;
  const steps = data.steps.filter((s) => allowedSteps.has(s.name));
  const stepNames = new Set(steps.map((s) => s.name));
  const transitions = data.transitions.filter((t) => stepNames.has(t.from) && stepNames.has(t.to));
  const bottleneck = data.bottleneck && stepNames.has(data.bottleneck.step) ? data.bottleneck : null;
  return { ...data, steps, transitions, bottleneck };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFunnelPage(props: {
  apiBaseUrl: string;
  merchantId: string;
  merchantName?: string;
  plan?: FunnelPlan;
}): FunnelPageVM {
  const { merchantId, merchantName, plan } = props;
  const api = useApi();
  const resolvedPlan = plan === "CHECKOUT_ONLY" ? "BOTH" : (plan ?? "BOTH");
  const showSourceTabs = resolvedPlan === "BOTH";
  const [funnelSource, setFunnelSource] = useState<FunnelSource>("storefront");
  const [period, setPeriod] = useState<FunnelPeriod>("7d");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [breakdown, setBreakdown] = useState<FunnelBreakdownDimension>("none");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [revision, setRevision] = useState(0);
  const funnelKey = JSON.stringify([merchantId, funnelSource, period, dateRange, breakdown, compareEnabled, revision]);
  const sessionsKey = JSON.stringify([merchantId, funnelSource, revision]);
  const [funnelState, setFunnelState] = useState<{
    key: string; data: FunnelData | null; loading: boolean; error: string | null;
  }>({ key: "", data: null, loading: true, error: null });
  const [sessionsState, setSessionsState] = useState<{
    key: string; sessions: FunnelSession[]; loading: boolean; error: string | null;
  }>({ key: "", sessions: [], loading: true, error: null });

  // Keyed state hides the previous merchant/source immediately, before effects run.
  const current = funnelState.key === funnelKey ? funnelState : { data: null, loading: true, error: null };
  const live = sessionsState.key === sessionsKey ? sessionsState : { sessions: [], loading: true, error: null };

  useEffect(() => {
    let cancelled = false;
    setFunnelState({ key: funnelKey, data: null, loading: true, error: null });
    const invalidRange = Boolean(dateRange.from) !== Boolean(dateRange.to)
      ? "Informe a data inicial e a data final."
      : dateRange.from > dateRange.to ? "A data final deve ser igual ou posterior à data inicial." : null;
    if (invalidRange) {
      setFunnelState({ key: funnelKey, data: null, loading: false, error: invalidRange });
      return;
    }
    const fetchFunnel = async () => {
      try {
        const params = { period, breakdown, compare: compareEnabled,
          ...(dateRange.from && dateRange.to ? dateRange : {}) };
        const json: FunnelData = funnelSource === "storefront"
          ? await api.getStorefrontFunnel(merchantId, params)
          : await api.getCheckoutFunnel(merchantId, params);
        if (!cancelled) setFunnelState({ key: funnelKey, data: filterFunnelByContext(json, funnelSource), loading: false, error: null });
      } catch (error) {
        if (cancelled) return;
        reportError({ source: "funnel.useFunnelPage.fetchFunnel", error, context: { merchantId, funnelSource, period } });
        setFunnelState({ key: funnelKey, data: null, loading: false, error: "Não foi possível carregar o funil. Tente novamente." });
      }
    };
    void fetchFunnel();
    return () => { cancelled = true; };
  }, [api, funnelKey, merchantId, funnelSource, period, breakdown, compareEnabled, dateRange.from, dateRange.to]);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    setSessionsState({ key: sessionsKey, sessions: [], loading: true, error: null });
    const fetchSessions = async () => {
      const request = ++requestId;
      try {
        const json: FunnelSessionsResponse = funnelSource === "storefront"
          ? await api.getStorefrontFunnelSessions(merchantId)
          : await api.getCheckoutFunnelSessions(merchantId);
        if (!cancelled && request === requestId) setSessionsState({ key: sessionsKey, sessions: json.sessions, loading: false, error: null });
      } catch (error) {
        if (cancelled || request !== requestId) return;
        reportError({ source: "funnel.useFunnelPage.fetchSessions", error, context: { merchantId, funnelSource } });
        setSessionsState({ key: sessionsKey, sessions: [], loading: false, error: "Não foi possível atualizar as sessões recentes." });
      }
    };
    void fetchSessions();
    const timer = setInterval(() => void fetchSessions(), 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, merchantId, funnelSource, sessionsKey]);

  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const data = current.data;
  const exportCsv = useCallback(() => {
    if (!data) return;
    const cell = (value: string | number) => '"' + String(value).replaceAll('"', '""') + '"';
    const header = "Etapa,Sessões,Conversão (%),Drop-off (%),Tempo médio (s)";
    const rows = data.steps.map(step => {
      const transition = data.transitions.find(t => t.from === step.name);
      return [step.label, step.count, step.percentage.toFixed(1),
        (transition?.dropOff ?? 0).toFixed(1), transition?.avgTimeSeconds ?? 0].map(cell).join(",");
    });
    const csv = [header, ...rows].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = ["funil", merchantName ?? merchantId, funnelSource, data.period.from.slice(0, 10), data.period.to.slice(0, 10)].join("-") + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [data, merchantId, merchantName, funnelSource]);

  return { period, setPeriod, dateRange, setDateRange, breakdown, setBreakdown,
    compareEnabled, setCompareEnabled, funnelSource, setFunnelSource, showSourceTabs,
    data, sessions: live.sessions, loading: current.loading, error: current.error,
    sessionsLoading: live.loading, sessionsError: live.error, refresh, exportCsv };
}
