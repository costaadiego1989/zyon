/** `starter` is the historical Free key. `starter179` is the paid Starter plan. */
export type BillingPlan = "starter" | "starter179" | "growth" | "scale";

type BillingEnvironment = { env?: Record<string, string | undefined> };
const billingEnvironment = (globalThis as typeof globalThis & BillingEnvironment).process?.env ?? {};

function envNumber(name: string, fallback: number): number {
  const raw = billingEnvironment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envLimit(name: string, fallback: number | null): number | null {
  const raw = billingEnvironment[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "unlimited" || raw === "null" || raw === "-1") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** Trial duration for a new Free store. Paid plans never use this value. */
export const FREE_TRIAL_DAYS = envNumber("BILLING_FREE_TRIAL_DAYS", 7);

/**
 * Conservative admission cap for Realtime voice. It is deliberately guard-only:
 * no USD amount is exposed in commercial plan copy. With gpt-realtime-2.1,
 * a five-minute half-duplex session costs about US$0.24 before the safety margin.
 */
function voiceSessionLimit(tier: "GROWTH" | "SCALE", budgetFallbackUsd: number): number {
  const explicitCap = envNumber(`VOICE_GUARD_${tier}_SESSION_CAP`, 0);
  if (explicitCap > 0) return Math.floor(explicitCap);
  const budgetUsd = envNumber(`VOICE_GUARD_${tier}_MONTHLY_BUDGET_USD`, budgetFallbackUsd);
  const durationSeconds = envNumber("VOICE_GUARD_AVERAGE_SESSION_SECONDS", 300);
  const inputShare = Math.min(1, envNumber("VOICE_GUARD_INPUT_AUDIO_SHARE", 0.5));
  const safetyMultiplier = 1 + envNumber("VOICE_GUARD_SAFETY_MARGIN_PERCENT", 20) / 100;
  const inputUsdPerMillion = envNumber("VOICE_GUARD_AUDIO_INPUT_USD_PER_MILLION", 32);
  const outputUsdPerMillion = envNumber("VOICE_GUARD_AUDIO_OUTPUT_USD_PER_MILLION", 64);
  // OpenAI Realtime: user audio = 10 tokens/s; assistant audio = 20 tokens/s.
  const estimatedUsd = durationSeconds * ((inputShare * 10 * inputUsdPerMillion) + ((1 - inputShare) * 20 * outputUsdPerMillion)) / 1_000_000;
  return estimatedUsd > 0 ? Math.max(1, Math.floor(budgetUsd / (estimatedUsd * safetyMultiplier))) : 0;
}

function featureOverrides<T extends Record<string, boolean>>(plan: BillingPlan, fallback: T): T {
  const raw = billingEnvironment.BILLING_PLAN_FEATURE_OVERRIDES_JSON?.trim();
  if (!raw) return fallback;
  try {
    const override = JSON.parse(raw)?.[plan] as Record<string, unknown> | undefined;
    if (!override || typeof override !== "object") return fallback;
    return Object.fromEntries(Object.entries(fallback).map(([key, enabled]) =>
      [key, typeof override[key] === "boolean" ? override[key] : enabled],
    )) as T;
  } catch { return fallback; }
}

export const BILLING_PLAN_PRESENTATION = {
  starter: {
    eyebrow: "Para começar", badge: "Teste grátis", includes: "No seu período de teste",
    description: `${FREE_TRIAL_DAYS} dias para colocar sua loja no ar e conhecer a Zyon. Durante o teste, tenha até 100 compras confirmadas por mês, uma pessoa na equipe e um cupom ativo, sem domínio próprio nem recursos avançados de IA.`,
    highlights: [
      `${FREE_TRIAL_DAYS} dias para conhecer a Zyon`,
      "Vendas pelo WhatsApp Seller",
      "100 compras confirmadas por mês",
      "1 cupom ativo e 1 pessoa na equipe",
      "R$ 1,99 por compra confirmada",
      "Sem domínio próprio e IA avançada",
    ],
  },
  starter179: {
    eyebrow: "Para ganhar tração", badge: "Starter", includes: "Mais autonomia para a operação",
    description: "Para lojas que já querem estruturar o pós-venda e usar domínio próprio sem contratar os recursos avançados de IA. Mantenha até 100 compras confirmadas por mês com uma equipe enxuta.",
    highlights: [
      "100 compras confirmadas por mês",
      "Vendas pelo WhatsApp Seller",
      "R$ 1,99 por compra confirmada",
      "Até 3 cupons ativos e 2 pessoas na equipe",
      "Domínio próprio e pós-venda",
      "Sem recursos avançados de IA",
    ],
  },
  growth: {
    eyebrow: "Para vender com consistência", badge: "Recomendado", includes: "Mais inteligência para sua rotina",
    description: "Para quem já tem uma rotina de vendas e quer automatizar mais. Atenda por texto e voz, use sua base de conhecimento, configure entregas e conecte seu domínio próprio.",
    highlights: [
      "500 pedidos por mês",
      "Vendas pelo WhatsApp Seller",
      "R$ 1,49 por compra confirmada",
      "1 loja",
      "Até 10 cupons ativos e 5 pessoas na equipe",
      "Nome do assistente personalizado",
      "Tema da loja personalizado",
      `Checkout por voz: ${voiceSessionLimit("GROWTH", 5)} sessões por mês`,
      "Descontos progressivos",
      "Regras avançadas de produto",
      "Módulo de IA liberado",
      "Integrações com ERP e CRM",
      "Suporte técnico por chat em tempo real",
    ],
  },
  scale: {
    eyebrow: "Para operações em expansão", badge: "Escala", includes: "Capacidade para o próximo nível",
    description: "Para empresas que precisam de capacidade, marca própria e inteligência comercial avançada. Administre até cinco lojas independentes, com compras sem limite mensal, análise, experimentação e agentes. Alto consumo e integrações especiais têm condições sob consulta.",
    highlights: [
      "Pedidos sem limite",
      "Vendas pelo WhatsApp Seller",
      "R$ 0,99 por compra confirmada",
      "Nome do assistente personalizado",
      "Tema da loja personalizado",
      `Checkout por voz: ${voiceSessionLimit("SCALE", 10)} sessões por mês`,
      "Todos os módulos do Growth",
      "Até 5 lojas independentes",
      "Recursos avançados de IA e automação",
      "Revenue Manager, testes A/B, marketplace e agentes M2M",
      "Cupons, equipe e compras sem limite; suporte prioritário em chat",
    ],
  },
} as const;

export const BILLING_FEATURE_LABELS: Record<string, string> = {
  whatsappSeller: "Vendas pelo WhatsApp Seller",
  customAgentName: "Nome do assistente personalizado", customTheme: "Tema da loja personalizado",
  advancedProductLayout: "Páginas de produto com conteúdo avançado",
  voiceCheckout: "Checkout por voz", faceBiometry: "Biometria facial", cryptoPayments: "Pagamentos em cripto",
  whiteLabel: "Remoção do selo Zyon", publicApiV1: "API pública", abTests: "Testes A/B",
  marketplace: "Marketplace", intentMemory: "Memória de intenção de compra", revenueLift: "Análise de conversão",
  advancedRules: "Regras comerciais avançadas", knowledgeBase: "Base de conhecimento", postSale: "Pós-venda",
  customDomain: "Domínio próprio", crmIntegrations: "Integrações com CRM", aiSpreadsheetImport: "Importação de planilhas com IA",
  advancedAi: "Recursos avancados de IA",
  revenueManager: "Revenue Manager", m2mAgents: "Agentes M2M", realtimeChatSupport: "Suporte por chat em tempo real",
  prioritySupport: "Suporte prioritário",
};

/** Limits used in operational views. Marketing cards use the curated plan highlights above. */
export function billingLimitHighlights(limits: Record<string, number | null | undefined>): string[] {
  const count = (value: number) => value.toLocaleString("pt-BR");
  const entries: Array<[string,string,string]> = [
    ["ordersPerMonth","compras confirmadas por mês","Compras sem limite mensal"],
    ["voiceSessionsPerMonth","sessões por voz por mês","Sessões por voz sem limite"],
    ["teamMembers","membros na equipe","Equipe sem limite"],
    ["activeCoupons","cupons ativos","Cupons sem limite"],
    ["crossSellPromotions","promoções de venda complementar","Promoções de venda complementar sem limite"],
  ];
  return entries.flatMap(([key,label,unlimited]) => {
    const value = limits[key];
    if (value === undefined) return [];
    if (value === null || value < 0) return [unlimited];
    if (value === 1) {
      const single: Record<string,string> = {voiceSessionsPerMonth:"1 sessão por voz por mês",teamMembers:"1 membro na equipe",activeCoupons:"1 cupom ativo",crossSellPromotions:"1 promoção de venda complementar"};
      if (single[key]) return [single[key]];
    }
    return [count(value)+" "+label];
  });
}

export type BillingPlanLimitKey =
  | "ordersPerMonth"
  | "voiceSessionsPerMonth"
  | "commerceConnections"
  | "webhookEndpoints"
  | "teamMembers"
  | "crossSellPromotions"
  | "activeCoupons";

export type BillingPlanFeatureKey =
  | "customAgentName"
  | "customTheme"
  | "voiceCheckout"
  | "faceBiometry"
  | "cryptoPayments"
  | "whiteLabel"
  | "publicApiV1"
  | "abTests"
  | "marketplace"
  | "intentMemory"
  | "revenueLift"
  // Growth+ (regras avançadas, integrações, IA de conteúdo/retenção)
  | "advancedRules"
  | "knowledgeBase"
  | "postSale"
  | "crmIntegrations"
  | "advancedAi"
  | "aiSpreadsheetImport"
  | "customDomain"
  // Scale (otimização autônoma + M2M)
  | "revenueManager"
  | "m2mAgents"
  | "realtimeChatSupport"
  | "prioritySupport"
  | "whatsappSeller"
  // Product surface expansion (rich blocks, FAQ, testimonials, videos)
  | "advancedProductLayout";

export type BillingPlanLimits = Record<BillingPlanLimitKey, number | null> & {
  /** New WebRTC sessions admitted during a UTC calendar month. */
  voiceSessionsPerMonth: number;
};
export type BillingPlanFeatures = Record<BillingPlanFeatureKey, boolean>;

export type BillingPlanConfig = {
  name: string;
  monthlyPriceBrl: number;
  /** Fee do MERCHANT por transação, fixo em centavos (sai do repasse/hold). */
  transactionFeeCents: number;
  limits: BillingPlanLimits;
  features: BillingPlanFeatures;
};

/**
 * Taxa de serviço do BUYER, fixa em centavos (R$0,99). Modelo iFood: cobrada do
 * comprador (somada ao total do pedido) em todos os planos e métodos de
 * pagamento. Independe do plano do merchant. Receita da plataforma, separada do
 * fee de transação do merchant.
 */
export const BUYER_SERVICE_FEE_CENTS = 99;

const UNLIMITED = null;

export const BILLING_PLANS: Record<BillingPlan, BillingPlanConfig> = {
  starter: {
    name: "Free",
    monthlyPriceBrl: envNumber("BILLING_PLAN_FREE_MONTHLY_PRICE_BRL", 0),
    transactionFeeCents: envNumber("BILLING_PLAN_FREE_TRANSACTION_FEE_CENTS", 199),
    limits: {
      ordersPerMonth: envLimit("BILLING_PLAN_FREE_ORDERS_PER_MONTH", 100),
      commerceConnections: envLimit("BILLING_PLAN_FREE_COMMERCE_CONNECTIONS", 1),
      webhookEndpoints: envLimit("BILLING_PLAN_FREE_WEBHOOK_ENDPOINTS", UNLIMITED),
      teamMembers: envLimit("BILLING_PLAN_FREE_TEAM_MEMBERS", 1),
      crossSellPromotions: envLimit("BILLING_PLAN_FREE_CROSS_SELL_PROMOTIONS", 1),
      activeCoupons: envLimit("BILLING_PLAN_FREE_ACTIVE_COUPONS", 1),
      voiceSessionsPerMonth: envNumber("BILLING_PLAN_FREE_VOICE_SESSIONS_PER_MONTH", 0),
    },
    features: featureOverrides("starter", {
      customAgentName: true,
      customTheme: true,
      voiceCheckout: false,
      faceBiometry: false,
      cryptoPayments: false,
      whiteLabel: false, // Free mostra o badge "Powered by Zyon"
      publicApiV1: false,
      abTests: false,
      marketplace: false,
      intentMemory: false,
      revenueLift: false,
      advancedRules: false,
      knowledgeBase: false,
      postSale: false,
      customDomain: false,
      crmIntegrations: false,
      advancedAi: false,
      aiSpreadsheetImport: false,
      revenueManager: false,
      m2mAgents: false,
      advancedProductLayout: false,
      realtimeChatSupport: false,
      prioritySupport: false,
      whatsappSeller: true,
    }),
  },
  starter179: {
    name: "Starter",
    monthlyPriceBrl: envNumber("BILLING_PLAN_STARTER_MONTHLY_PRICE_BRL", 179),
    transactionFeeCents: envNumber("BILLING_PLAN_STARTER_TRANSACTION_FEE_CENTS", 199),
    limits: {
      ordersPerMonth: envLimit("BILLING_PLAN_STARTER_ORDERS_PER_MONTH", 100),
      commerceConnections: envLimit("BILLING_PLAN_STARTER_COMMERCE_CONNECTIONS", 1),
      webhookEndpoints: envLimit("BILLING_PLAN_STARTER_WEBHOOK_ENDPOINTS", UNLIMITED),
      teamMembers: envLimit("BILLING_PLAN_STARTER_TEAM_MEMBERS", 2),
      crossSellPromotions: envLimit("BILLING_PLAN_STARTER_CROSS_SELL_PROMOTIONS", 3),
      activeCoupons: envLimit("BILLING_PLAN_STARTER_ACTIVE_COUPONS", 3),
      voiceSessionsPerMonth: envNumber("BILLING_PLAN_STARTER_VOICE_SESSIONS_PER_MONTH", 0),
    },
    features: featureOverrides("starter179", {
      customAgentName: true, customTheme: true, advancedProductLayout: false,
      voiceCheckout: false, faceBiometry: false, cryptoPayments: false, whiteLabel: false,
      publicApiV1: false, abTests: false, marketplace: false, intentMemory: false,
      revenueLift: false, advancedRules: false, knowledgeBase: false, postSale: true,
      customDomain: true, crmIntegrations: false, advancedAi: false, aiSpreadsheetImport: false,
      revenueManager: false, m2mAgents: false, realtimeChatSupport: false, prioritySupport: false, whatsappSeller: true,
    }),
  },
  growth: {
    name: "Growth",
    monthlyPriceBrl: envNumber("BILLING_PLAN_GROWTH_MONTHLY_PRICE_BRL", 449),
    transactionFeeCents: envNumber("BILLING_PLAN_GROWTH_TRANSACTION_FEE_CENTS", 149),
    limits: {
      ordersPerMonth: envLimit("BILLING_PLAN_GROWTH_ORDERS_PER_MONTH", 500),
      commerceConnections: envLimit("BILLING_PLAN_GROWTH_COMMERCE_CONNECTIONS", 2),
      webhookEndpoints: envLimit("BILLING_PLAN_GROWTH_WEBHOOK_ENDPOINTS", UNLIMITED),
      teamMembers: envLimit("BILLING_PLAN_GROWTH_TEAM_MEMBERS", 5),
      crossSellPromotions: envLimit("BILLING_PLAN_GROWTH_CROSS_SELL_PROMOTIONS", 10),
      activeCoupons: envLimit("BILLING_PLAN_GROWTH_ACTIVE_COUPONS", 10),
      voiceSessionsPerMonth: voiceSessionLimit("GROWTH", 5),
    },
    features: featureOverrides("growth", {
      customAgentName: true,
      customTheme: true,
      // Voice purchase with Realtime is available from Growth onward.
      voiceCheckout: true,
      faceBiometry: true,
      cryptoPayments: true,
      whiteLabel: true, // paga = remove badge
      publicApiV1: true,
      abTests: false,
      marketplace: false,
      intentMemory: false,
      revenueLift: false,
      advancedRules: true,
      knowledgeBase: true,
      postSale: true,
      customDomain: true,
      crmIntegrations: true,
      advancedAi: true,
      aiSpreadsheetImport: true,
      revenueManager: false,
      m2mAgents: false,
      advancedProductLayout: true,
      realtimeChatSupport: true,
      prioritySupport: false,
      whatsappSeller: true,
    }),
  },
  scale: {
    name: "Scale",
    monthlyPriceBrl: envNumber("BILLING_PLAN_SCALE_MONTHLY_PRICE_BRL", 749),
    transactionFeeCents: envNumber("BILLING_PLAN_SCALE_TRANSACTION_FEE_CENTS", 99),
    limits: {
      ordersPerMonth: envLimit("BILLING_PLAN_SCALE_ORDERS_PER_MONTH", UNLIMITED),
      commerceConnections: envLimit("BILLING_PLAN_SCALE_COMMERCE_CONNECTIONS", UNLIMITED),
      webhookEndpoints: envLimit("BILLING_PLAN_SCALE_WEBHOOK_ENDPOINTS", UNLIMITED),
      teamMembers: envLimit("BILLING_PLAN_SCALE_TEAM_MEMBERS", UNLIMITED),
      crossSellPromotions: envLimit("BILLING_PLAN_SCALE_CROSS_SELL_PROMOTIONS", UNLIMITED),
      activeCoupons: envLimit("BILLING_PLAN_SCALE_ACTIVE_COUPONS", UNLIMITED),
      voiceSessionsPerMonth: voiceSessionLimit("SCALE", 10),
    },
    features: featureOverrides("scale", {
      customAgentName: true,
      customTheme: true,
      voiceCheckout: true,
      faceBiometry: true,
      cryptoPayments: true,
      whiteLabel: true,
      publicApiV1: true,
      abTests: true,
      marketplace: true,
      intentMemory: true,
      revenueLift: true,
      advancedRules: true,
      knowledgeBase: true,
      postSale: true,
      customDomain: true,
      crmIntegrations: true,
      advancedAi: true,
      aiSpreadsheetImport: true,
      revenueManager: true,
      m2mAgents: true,
      advancedProductLayout: true,
      realtimeChatSupport: true,
      prioritySupport: true,
      whatsappSeller: true,
    }),
  },
};
