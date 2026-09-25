export type BillingPlan = "starter" | "growth" | "scale";

export const BILLING_PLAN_PRESENTATION = {
  starter: {
    eyebrow: "Seu primeiro passo", badge: "Sem mensalidade", includes: "Sua operação começa com",
  },
  growth: {
    eyebrow: "Para vender com consistência", badge: "Recomendado", includes: "Mais inteligência para sua rotina",
  },
  scale: {
    eyebrow: "Para operações em expansão", badge: "Escala", includes: "Capacidade para o próximo nível",
  },
} as const;

export const BILLING_FEATURE_LABELS: Record<string, string> = {
  customAgentName: "Nome do assistente personalizado", customTheme: "Tema da loja personalizado",
  advancedProductLayout: "Páginas de produto com conteúdo avançado",
  voiceCheckout: "Checkout por voz", faceBiometry: "Biometria facial", cryptoPayments: "Pagamentos em cripto",
  whiteLabel: "Remoção do selo Zyon", publicApiV1: "API pública", abTests: "Testes A/B",
  marketplace: "Marketplace", intentMemory: "Memória de intenção de compra", revenueLift: "Análise de conversão",
  advancedRules: "Regras comerciais avançadas", knowledgeBase: "Base de conhecimento", postSale: "Pós-venda",
  customDomain: "Domínio próprio", crmIntegrations: "Integrações com CRM", aiSpreadsheetImport: "Importação de planilhas com IA",
  revenueManager: "Revenue Manager", m2mAgents: "Agentes M2M",
};

/** Mesmos limites e rótulos no site, na escolha inicial e na página de assinatura. */
export function billingLimitHighlights(limits: Record<string, number | null | undefined>): string[] {
  const count = (value: number) => value.toLocaleString("pt-BR");
  const entries: Array<[string,string,string]> = [
    ["ordersPerMonth","compras confirmadas por mês","Compras sem limite mensal"],
    ["commerceConnections","conexões de comércio","Conexões de comércio sem limite"],
    ["teamMembers","membros na equipe","Equipe sem limite"],
    ["activeCoupons","cupons ativos","Cupons sem limite"],
    ["crossSellPromotions","promoções de venda complementar","Promoções de venda complementar sem limite"],
  ];
  return entries.flatMap(([key,label,unlimited]) => {
    const value = limits[key];
    if (value === undefined) return [];
    if (value === null || value < 0) return [unlimited];
    if (value === 1) {
      const single: Record<string,string> = {commerceConnections:"1 conexão de comércio",teamMembers:"1 membro na equipe",activeCoupons:"1 cupom ativo",crossSellPromotions:"1 promoção de venda complementar"};
      if (single[key]) return [single[key]];
    }
    return [count(value)+" "+label];
  });
}

export type BillingPlanLimitKey =
  | "ordersPerMonth"
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
  | "aiSpreadsheetImport"
  | "customDomain"
  // Scale (otimização autônoma + M2M)
  | "revenueManager"
  | "m2mAgents"
  // Product surface expansion (rich blocks, FAQ, testimonials, videos)
  | "advancedProductLayout";

export type BillingPlanLimits = Record<BillingPlanLimitKey, number | null>;
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
    monthlyPriceBrl: 0,
    transactionFeeCents: 199,
    limits: {
      ordersPerMonth: 100,
      commerceConnections: 1,
      webhookEndpoints: UNLIMITED,
      teamMembers: 1,
      crossSellPromotions: 1,
      activeCoupons: 1,
    },
    features: {
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
      aiSpreadsheetImport: false,
      revenueManager: false,
      m2mAgents: false,
      advancedProductLayout: true,
    },
  },
  growth: {
    name: "Growth",
    monthlyPriceBrl: 449,
    transactionFeeCents: 149,
    limits: {
      ordersPerMonth: 500,
      commerceConnections: 2,
      webhookEndpoints: UNLIMITED,
      teamMembers: 3,
      crossSellPromotions: 10,
      activeCoupons: 10,
    },
    features: {
      customAgentName: true,
      customTheme: true,
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
      aiSpreadsheetImport: true,
      revenueManager: false,
      m2mAgents: false,
      advancedProductLayout: true,
    },
  },
  scale: {
    name: "Scale",
    monthlyPriceBrl: 749,
    transactionFeeCents: 99,
    limits: {
      ordersPerMonth: UNLIMITED,
      commerceConnections: UNLIMITED,
      webhookEndpoints: UNLIMITED,
      teamMembers: 10,
      crossSellPromotions: UNLIMITED,
      activeCoupons: UNLIMITED,
    },
    features: {
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
      aiSpreadsheetImport: true,
      revenueManager: true,
      m2mAgents: true,
      advancedProductLayout: true,
    },
  },
};
