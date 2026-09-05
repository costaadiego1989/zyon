import type { BillingPlanCard } from "../../api/types.js";
import type { PlanDef } from "./components/PlanCard.js";

const FEATURE_LABELS: Record<string, string> = {
  customAgentName: "Assistente personalizado", customTheme: "Tema personalizado",
  voiceCheckout: "Checkout por voz", faceBiometry: "Biometria facial", cryptoPayments: "Pagamentos em cripto",
  whiteLabel: "Checkout sem a marca Zyon", publicApiV1: "Acesso à API", abTests: "Testes A/B",
  marketplace: "Marketplace", intentMemory: "Memória de intenção", revenueLift: "Análise de conversão",
  advancedRules: "Regras avançadas", knowledgeBase: "Base de conhecimento", postSale: "Pós-venda",
  customDomain: "Domínio próprio", crmIntegrations: "Integrações com CRM", aiSpreadsheetImport: "Importação com IA",
  revenueManager: "Gestão de receita com IA", m2mAgents: "Agentes M2M",
};

export function toPlanDef(plan: BillingPlanCard): PlanDef {
  if (!["starter", "growth", "scale"].includes(plan.key)) throw new Error("Plano desconhecido no catálogo.");
  const limit = (key: string) => plan.limits?.[key] ?? -1;
  return {
    key: plan.key as PlanDef["key"], name: plan.name, price: plan.priceBrl,
    fee: ((plan.transactionFeeCents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    limits: { orders: limit("ordersPerMonth"), sessions: limit("sessionsPerMonth"), ai: limit("aiConversationsPerMonth"), connections: limit("commerceConnections") },
    features: plan.features.map(key => FEATURE_LABELS[key] ?? key), recommended: plan.recommended,
  };
}
