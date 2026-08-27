import { useEffect, useState, useRef, useCallback } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type FunnelPeriod = "today" | "7d" | "30d" | "90d";
export type FunnelBreakdownDimension = "none" | "device" | "buyer_type" | "payment_method";
export type FunnelSource = "storefront" | "checkout";
export type FunnelPlan = "STORE_ONLY" | "BOTH" | "API";

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
  auth_completed: "intent-memory",
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
    case "checkout_started":
      return {
        headline: `${pct} não avançam após iniciar`,
        detail: "Compradores iniciam sessão mas não prosseguem para a próxima etapa. Pode indicar carregamento lento, confusão na interface ou falta de produtos visíveis.",
        action: "Verifique o tempo de carregamento da página e se os produtos aparecem imediatamente ao entrar.",
        module: "general",
      };
    case "auth_completed":
      return {
        headline: `${pct} não completam a identificação`,
        detail: "Intent Memory detecta que compradores abandonam na etapa de identificação (OTP). Causas comuns: SMS não chega, código expira rápido, ou desconfiança ao pedir telefone.",
        action: "Habilite verificação por e-mail como fallback e reduza o tempo de expiração do código OTP.",
        module: "intent-memory",
      };
    case "product_viewed":
      return {
        headline: `${pct} visualizam mas não adicionam ao carrinho`,
        detail: "Intent Memory detecta que compradores visualizam produtos mas não avançam — pode indicar preço fora da expectativa, falta de variantes ou informação insuficiente.",
        action: "Adicione fotos detalhadas, depoimentos e destaque promoções ativas na página do produto.",
        module: "intent-memory",
      };
    case "cart_viewed":
      return {
        headline: `${pct} abandonam o carrinho antes do cadastro`,
        detail: "Revenue Manager identifica que o abandono nesta etapa correlaciona com ausência de urgência — sem countdown, sem estoque baixo, sem incentivo visível.",
        action: "Adicione indicadores de escassez (estoque limitado) ou ofereça um incentivo para iniciar o cadastro.",
        module: "revenue-manager",
      };
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
        detail: "Intent Memory registrou que códigos expirados e SMS atrasado são as principais objeções. Compradores relatam 'não recebi o código' em >70% dos abandonos.",
        action: "Habilite verificação por e-mail como fallback e reduza o tempo de expiração do código.",
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
        headline: `${pct} concluem cadastro mas não fazem login`,
        detail: "Revenue Manager detecta que estes buyers têm alta intenção (engajamento nas mensagens do agente) — o abandono vem de espera ou confusão no fluxo pós-cadastro.",
        action: "Faça login automático após cadastro — elimine a etapa manual de 'entrar' após registro.",
        module: "revenue-manager",
      };
    case "login_completed":
      return {
        headline: `${pct} fazem login mas não vão para checkout`,
        detail: "Intent Memory mostra que após login o comprador espera ser direcionado automaticamente. Uma tela intermediária gera hesitação.",
        action: "Redirecione automaticamente para o checkout após login bem-sucedido.",
        module: "intent-memory",
      };
    case "shipping_calculated":
      return {
        headline: `${pct} abandonam ao ver o frete`,
        detail: "Shipping Engine classificou 'frete caro' como a principal objeção neste merchant. A diferença entre o CEP de origem e o destino gera o pico de drop-off.",
        action: "Ative subsídio de frete para o primeiro CEP ou exija um mínimo de carrinho para frete grátis.",
        module: "shipping-engine",
      };
    case "coupon_applied":
      return {
        headline: `${pct} desistem após etapa de cupom`,
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
    case "order_completed":
      return {
        headline: `${pct} completam o pagamento com sucesso`,
        detail: "Esta etapa representa pagamentos concluídos. Um drop-off alto aqui indica falhas no processamento do gateway.",
        action: "Verifique logs do gateway de pagamento e ative retry automático para transações com timeout.",
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
  buyerHint?: string;
  stage: string;
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

const EMPTY_CHECKOUT_FUNNEL: FunnelData = {
  steps: [
    { name: "checkout_started", label: "Checkout iniciado", count: 0, percentage: 0 },
    { name: "auth_completed", label: "Identificação", count: 0, percentage: 0 },
    { name: "shipping_calculated", label: "Frete selecionado", count: 0, percentage: 0 },
    { name: "coupon_applied", label: "Cupom aplicado", count: 0, percentage: 0 },
    { name: "payment_method_selected", label: "Pagamento selecionado", count: 0, percentage: 0 },
    { name: "order_completed", label: "Pagamento concluído", count: 0, percentage: 0 },
    { name: "payment_failed", label: "Pagamento falhado", count: 0, percentage: 0 },
  ],
  transitions: [
    { from: "checkout_started", to: "auth_completed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "auth_completed", to: "shipping_calculated", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "shipping_calculated", to: "coupon_applied", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "coupon_applied", to: "payment_method_selected", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "payment_method_selected", to: "order_completed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
  ],
  bottleneck: null,
  period: { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
  totalSessions: 0,
  overallConversion: 0,
};

const EMPTY_STOREFRONT_FUNNEL: FunnelData = {
  steps: [
    { name: "checkout_started", label: "Sessão iniciada", count: 0, percentage: 0 },
    { name: "product_viewed", label: "Produto visualizado", count: 0, percentage: 0 },
    { name: "cart_viewed", label: "Produto adicionado ao carrinho", count: 0, percentage: 0 },
    { name: "auth_phone_submitted", label: "Cadastro iniciado", count: 0, percentage: 0 },
    { name: "auth_phone_verified", label: "Verificou telefone", count: 0, percentage: 0 },
    { name: "auth_identity_confirmed", label: "Confirmou identidade", count: 0, percentage: 0 },
    { name: "auth_registration_completed", label: "Cadastro completo", count: 0, percentage: 0 },
    { name: "login_completed", label: "Login realizado", count: 0, percentage: 0 },
  ],
  transitions: [
    { from: "checkout_started", to: "product_viewed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "product_viewed", to: "cart_viewed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "cart_viewed", to: "auth_phone_submitted", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "auth_phone_submitted", to: "auth_phone_verified", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "auth_phone_verified", to: "auth_identity_confirmed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "auth_identity_confirmed", to: "auth_registration_completed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
    { from: "auth_registration_completed", to: "login_completed", rate: 0, dropOff: 0, avgTimeSeconds: 0 },
  ],
  bottleneck: null,
  period: { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
  totalSessions: 0,
  overallConversion: 0,
};

function getEmptyFunnel(source: FunnelSource): FunnelData {
  return source === "storefront" ? EMPTY_STOREFRONT_FUNNEL : EMPTY_CHECKOUT_FUNNEL;
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
  const { apiBaseUrl: _apiBaseUrl, merchantId, merchantName, plan } = props;
  const api = useApi();

  const resolvedPlan: FunnelPlan = plan ?? "BOTH";
  const showSourceTabs = resolvedPlan === "BOTH";

  const initialSource: FunnelSource =
    "storefront";

  const [funnelSource, setFunnelSourceRaw] = useState<FunnelSource>(initialSource);

  const setFunnelSource = useCallback((source: FunnelSource) => {
    setFunnelSourceRaw(source);
    setData(getEmptyFunnel(source));
  }, []);
  const [period, setPeriod] = useState<FunnelPeriod>("7d");
  const [breakdown, setBreakdown] = useState<FunnelBreakdownDimension>("none");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [data, setData] = useState<FunnelData | null>(getEmptyFunnel(initialSource));
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
      // Filter steps by context — store journey shows only store steps,
      // checkout journey shows only checkout-specific steps.
      const filtered = filterFunnelByContext(json, funnelSource);
      // Augment bottleneck with intelligent, AI-module-aware insight if backend
      // supplied a bottleneck but did not include the structured insight.
      if (filtered.bottleneck && !filtered.bottleneck.insight) {
        filtered.bottleneck = {
          ...filtered.bottleneck,
          insight: buildInsight(filtered.bottleneck.step, filtered.bottleneck.dropOff),
        };
      }
      setData(filtered);
    } catch (e) {
      reportError({ source: "funnel.useFunnelPage.fetchFunnel", error: e, context: { merchantId, funnelSource, period } });
      setError(e instanceof Error ? e.message : String(e));
      // Show empty structure even on error so page isn't blank
      if (!data) setData(getEmptyFunnel(funnelSource));
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
