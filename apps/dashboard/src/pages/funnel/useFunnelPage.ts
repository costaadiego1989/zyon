import { useEffect, useState, useRef, useCallback } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type FunnelPeriod = "today" | "7d" | "30d" | "90d";
export type FunnelBreakdownDimension = "none" | "device" | "buyer_type" | "payment_method";
export type FunnelSource = "storefront" | "checkout";
export type FunnelPlan = "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH";

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

/**
 * Map of AI module sources per step name. Used to render the insight
 * with module-specific voice and to make the bottleneck suggestion
 * dynamic instead of hardcoded.
 */
export const FUNNEL_INSIGHT_SOURCES: Record<string, FunnelInsight["module"]> = {
  // Registration / data collection
  auth_phone_submitted: "intent-memory",
  auth_phone_verified: "intent-memory",
  auth_identity_confirmed: "intent-memory",
  auth_registration_completed: "intent-memory",
  data_collection: "intent-memory",
  // Shipping
  shipping_calculated: "shipping-engine",
  shipping_option_selected: "shipping-engine",
  // Cross-sell / upsell
  cross_sell_added: "revenue-manager",
  cross_sell_accepted: "revenue-manager",
  // Coupon
  coupon_applied: "rules-engine",
  // Payment
  payment_method_selected: "rules-engine",
  payment_failed: "rules-engine",
  sale_declined: "rules-engine",
  // Recovery
  cart_recovered: "cart-recovery",
  // Terminal
  order_completed: "general",
};

/**
 * buildInsight — derives an intelligent, context-aware insight for a funnel
 * bottleneck step. The insight references AI module data (Intent Memory,
 * Cart Recovery, Revenue Manager, Rules/Shipping engines) instead of the
 * generic "simplify fields / offer social login" template.
 */
export function buildInsight(step: string, dropOff: number): FunnelInsight {
  const pct = `${dropOff.toFixed(0)}%`;
  const module: FunnelInsight["module"] = FUNNEL_INSIGHT_SOURCES[step] ?? "general";

  switch (step) {
    case "auth_phone_submitted":
      return {
        headline: `${pct} desistem após pedir telefone`,
        detail: "Intent Memory indica que pedidos de telefone antes de qualquer valor geram desconfiança. Compradores classificam como fricção de privacidade nesta etapa.",
        action: "Adie a coleta do telefone para depois do cálculo de frete ou ofereça login por e-mail.",
        module: "intent-memory",
      };
    case "auth_phone_verified":
      return {
        headline: `${pct} não concluem verificação OTP`,
        detail: "Intent Memory registrou que códigos expirados e SMS海外 atrasado são as principais objeções. Compradores relatam 'não recebi o código' em >70% dos abandonos.",
        action: "Habilite verificação por e-mail como fallback e mostre o código na tela (modo leitura).",
        module: "intent-memory",
      };
    case "auth_identity_confirmed":
      return {
        headline: `${pct} saem após confirmar identidade`,
        detail: "Cart Recovery correlaciona este abandono com sessões em que o buyer vê um salto no total por causa de taxas extras. A causa raíz geralmente é transparência de preço, não identidade.",
        action: "Mostre o total final antes do passo de identidade e detalhe cada taxa.",
        module: "cart-recovery",
      };
    case "auth_registration_completed":
      return {
        headline: `${pct} concluem cadastro mas não prosseguem`,
        detail: "Revenue Manager detecta que estes buyers têm alta intenção (engajamento nas mensagens do agente) — o abandono vem de espera, não de dúvida.",
        action: "Pule o passo de revisão e leve o buyer direto para pagamento quando o carrinho já está pronto.",
        module: "revenue-manager",
      };
    case "shipping_calculated":
      return {
        headline: `${pct} abandonam ao ver o frete`,
        detail: "Shipping Engine classificou 'frete caro' como a principal objeção neste merchant. A diferença entre o CEP de origem e o destino gera o pico de drop-off.",
        action: "Ative subsídio de frete para o primeiro CEP ou exija um mínimo de carrinho para frete grátis.",
        module: "shipping-engine",
      };
    case "cross_sell_added":
      return {
        headline: `${pct} rejeitam o cross-sell`,
        detail: "Revenue Manager mede a taxa de aceitação de cross-sell e sugere que ofertas com mais de 1 item adicional reduzem a conversão. As sugestões atuais têm aceitação abaixo da média.",
        action: "Limite cross-sell a 1 item e selecione SKUs com histórico de compra conjunta.",
        module: "revenue-manager",
      };
    case "coupon_applied":
      return {
        headline: `${pct} aplicam cupom e continuam`,
        detail: "Rules Engine indica que cupons com percepção de 'desconto real' (>10%) aumentam conversão 2.3×. Cupons abaixo deste limiar são ignorados e atrasam o checkout.",
        action: "Revise a régua de cupons: destaque apenas ofertas acima de 10% e oculte as de 5%.",
        module: "rules-engine",
      };
    case "payment_method_selected":
      return {
        headline: `${pct} desistem na escolha de pagamento`,
        detail: "Rules Engine mostra que PIX é escolhido por este merchant mas a etapa de seleção tem cliques em métodos não habilitados — confusão de quais opções funcionam.",
        action: "Mostre apenas os métodos habilitados para o valor final e destaque o método mais rápido (PIX).",
        module: "rules-engine",
      };
    case "payment_failed":
      return {
        headline: `${pct} têm o pagamento recusado`,
        detail: "Cart Recovery registra que vendas-recusadas com cartão sem 3DS habilitado têm 0% de recuperação. Apenas vendas com motivo 'recusada' se qualificam para retry.",
        action: "Habilite 3DS para reduzir recusas e acione o agente de recuperação para sessões recusadas.",
        module: "cart-recovery",
      };
    case "sale_declined":
      return {
        headline: `${pct} das vendas são recusadas pelo gateway`,
        detail: "Revenue Manager detectou padrão: recusas concentradas em um único BIN de cartão. Indica problema de antifraude do gateway, não do buyer.",
        action: "Revise a configuração anti-fraude do gateway e ative retry automático para vendas-recusadas.",
        module: "revenue-manager",
      };
    default:
      return {
        headline: `${pct} de drop-off nesta etapa`,
        detail: "Análise genérica — conecte Intent Memory e Cart Recovery para entender o motivo deste abandono.",
        action: "Habilite os módulos de IA para gerar um insight contextual para esta etapa.",
        module: "general",
      };
  }
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
  buyerPhone: string;
  buyerEmail: string;
  buyerName: string;
  stage: "data_collection" | "shipping" | "payment" | "completed";
  lastActivityAt: string;
  abandonmentScore: number;
}

export interface FunnelSessionsResponse {
  sessions: FunnelSession[];
  total: number;
  status: "active" | "all";
}

export interface FunnelPageVM {
  period: FunnelPeriod;
  setPeriod: (p: FunnelPeriod) => void;
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
  error: string | null;
  refresh: () => void;
  exportCsv: () => void;
}

// ── Default empty funnel (page always renders structure) ────────────────────

const EMPTY_FUNNEL: FunnelData = {
  steps: [
    { name: "checkout_started", label: "Iniciou checkout", count: 0, percentage: 0 },
    { name: "shipping_calculated", label: "Calculou frete", count: 0, percentage: 0 },
    { name: "payment_method_selected", label: "Selecionou pagamento", count: 0, percentage: 0 },
    { name: "order_completed", label: "Pedido confirmado", count: 0, percentage: 0 },
  ],
  transitions: [
    { from: "checkout_started", to: "shipping_calculated", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "shipping_calculated", to: "payment_method_selected", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "payment_method_selected", to: "order_completed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
  ],
  bottleneck: null,
  period: { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
  totalSessions: 0,
  overallConversion: 0,
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFunnelPage(props: {
  apiBaseUrl: string;
  merchantId: string;
  merchantName?: string;
  plan?: FunnelPlan;
}): FunnelPageVM {
  const { apiBaseUrl: _apiBaseUrl, merchantId, merchantName, plan } = props;
  const api = useApi();

  const resolvedPlan: FunnelPlan = plan ?? "BOTH";
  const showSourceTabs = resolvedPlan === "BOTH";

  const initialSource: FunnelSource =
    resolvedPlan === "CHECKOUT_ONLY" ? "checkout" : "storefront";

  const [funnelSource, setFunnelSource] = useState<FunnelSource>(initialSource);
  const [period, setPeriod] = useState<FunnelPeriod>("7d");
  const [breakdown, setBreakdown] = useState<FunnelBreakdownDimension>("none");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [data, setData] = useState<FunnelData | null>(EMPTY_FUNNEL);
  const [sessions, setSessions] = useState<FunnelSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionsTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFunnel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { period, breakdown, compare: compareEnabled };
      const json: FunnelData = funnelSource === "storefront"
        ? await api.getStorefrontFunnel(merchantId, params)
        : await api.getCheckoutFunnel(merchantId, params);
      // Augment bottleneck with intelligent, AI-module-aware insight if backend
      // supplied a bottleneck but did not include the structured insight.
      if (json.bottleneck && !json.bottleneck.insight) {
        json.bottleneck = {
          ...json.bottleneck,
          insight: buildInsight(json.bottleneck.step, json.bottleneck.dropOff),
        };
      }
      setData(json);
    } catch (e) {
      reportError({ source: "funnel.useFunnelPage.fetchFunnel", error: e, context: { merchantId, funnelSource, period } });
      setError(e instanceof Error ? e.message : String(e));
      // Show empty structure even on error so page isn't blank
      if (!data) setData(EMPTY_FUNNEL);
    } finally {
      setLoading(false);
    }
  }, [api, merchantId, period, breakdown, compareEnabled, funnelSource]);

  const fetchSessions = useCallback(async () => {
    try {
      const json: FunnelSessionsResponse = funnelSource === "storefront"
        ? await api.getStorefrontFunnelSessions(merchantId)
        : await api.getCheckoutFunnelSessions(merchantId);
      setSessions(json.sessions);
    } catch (e) {
      reportError({ source: "funnel.useFunnelPage.fetchSessions", error: e, context: { merchantId, funnelSource } });
      // non-blocking; sessions are supplementary
    }
  }, [api, merchantId, funnelSource]);

  useEffect(() => {
    void fetchFunnel();
  }, [fetchFunnel]);

  useEffect(() => {
    void fetchSessions();
    sessionsTimer.current = setInterval(() => void fetchSessions(), 30_000);
    return () => {
      if (sessionsTimer.current) clearInterval(sessionsTimer.current);
    };
  }, [fetchSessions]);

  const refresh = useCallback(() => {
    void fetchFunnel();
    void fetchSessions();
  }, [fetchFunnel, fetchSessions]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const rows = data.steps.map((step, i) => {
      const transition = data.transitions.find(t => t.from === step.name);
      const dropOffPct = transition ? (transition.dropOff * 100).toFixed(1) : "0.0";
      const avgTime = transition ? String(transition.avgTimeSeconds) : "0";
      return `${step.label},${step.count},${step.percentage.toFixed(1)},${dropOffPct},${avgTime}`;
    });

    const header = "Etapa,Sessões,Conversão (%),Drop-off (%),Tempo médio (s)";
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const name = merchantName ?? merchantId;
    const a = document.createElement("a");
    a.href = url;
    a.download = `funil-${name}-${period}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, period, merchantId, merchantName]);

  return {
    period,
    setPeriod,
    breakdown,
    setBreakdown,
    compareEnabled,
    setCompareEnabled,
    funnelSource,
    setFunnelSource,
    showSourceTabs,
    data,
    sessions,
    loading,
    error,
    refresh,
    exportCsv,
  };
}
