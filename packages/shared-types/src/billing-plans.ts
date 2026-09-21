export type BillingPlan = "starter" | "growth" | "scale";

export const BILLING_PLAN_PRESENTATION = {
  starter: {
    eyebrow: "Seu primeiro passo", badge: "Sem mensalidade", includes: "Sua operação começa com",
    description: "Para tirar sua loja autônoma do papel e conhecer a Zyon atendendo seus primeiros clientes. O essencial para começar, com a identidade da sua marca.",
    highlights: [
      "14 dias para conhecer a Zyon",
      "Sem taxa Zyon por transação durante o trial",
      "Nome do assistente personalizado",
      "Tema da loja personalizado",
    ],
  },
  growth: {
    eyebrow: "Para vender com consistência", badge: "Recomendado", includes: "Mais inteligência para sua rotina",
    description: "Para quem já tem uma rotina de vendas e quer automatizar mais. Atenda por texto e voz, use sua base de conhecimento, configure entregas e conecte seu domínio próprio.",
    highlights: [
      "500 pedidos por mês",
      "1 loja",
      "Nome do assistente personalizado",
      "Tema da loja personalizado",
      "Checkout por voz: 100 sessões por mês",
      "Descontos progressivos",
      "Regras avançadas de produto",
      "Módulo de IA liberado",
      "Integrações com ERP e CRM",
    ],
  },
  scale: {
    eyebrow: "Para operações em expansão", badge: "Escala", includes: "Capacidade para o próximo nível",
    description: "Para empresas que precisam de capacidade, marca própria e inteligência comercial avançada. Administre até cinco lojas independentes, com compras sem limite mensal, análise, experimentação e agentes. Alto consumo e integrações especiais têm condições sob consulta.",
    highlights: [
      "Pedidos sem limite",
      "Nome do assistente personalizado",
      "Tema da loja personalizado",
      "Checkout por voz: 300 sessões por mês",
      "Todos os módulos do Growth",
      "Até 5 lojas independentes",
      "Recursos avançados de IA e automação",
    ],
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
    monthlyPriceBrl: 0,
    transactionFeeCents: 0,
    limits: {
      ordersPerMonth: 100,
      commerceConnections: 1,
      webhookEndpoints: UNLIMITED,
      teamMembers: 1,
      crossSellPromotions: 1,
      activeCoupons: 1,
      voiceSessionsPerMonth: 0,
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
      commerceConnections: 1,
      webhookEndpoints: UNLIMITED,
      teamMembers: 3,
      crossSellPromotions: 10,
      activeCoupons: 10,
      voiceSessionsPerMonth: 100,
    },
    features: {
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
      voiceSessionsPerMonth: 300,
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
