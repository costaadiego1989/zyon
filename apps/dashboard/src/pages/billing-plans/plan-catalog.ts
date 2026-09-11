import type { BillingPlanCard } from "../../api/types.js";
import type { PlanDef } from "./components/PlanCard.js";
import { BILLING_FEATURE_LABELS, billingLimitHighlights } from "@zyon/shared-types";

export function toPlanDef(plan: BillingPlanCard): PlanDef {
  if (!["starter", "growth", "scale"].includes(plan.key)) throw new Error("Plano desconhecido no catálogo.");
  const limit = (key: string) => plan.limits?.[key] ?? -1;
  return {
    key: plan.key as PlanDef["key"], name: plan.name, price: plan.priceBrl,
    fee: ((plan.transactionFeeCents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    limits: { orders: limit("ordersPerMonth"), sessions: limit("sessionsPerMonth"), ai: limit("aiConversationsPerMonth"), connections: limit("commerceConnections") },
    features: plan.features.flatMap(key => BILLING_FEATURE_LABELS[key] ? [BILLING_FEATURE_LABELS[key]] : []), recommended: plan.recommended,
    highlights: billingLimitHighlights(plan.limits ?? {}), trialDays: plan.trialDays,
  };
}
