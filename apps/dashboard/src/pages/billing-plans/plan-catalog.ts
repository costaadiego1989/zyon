import type { BillingPlanCard } from "../../api/types.js";
import type { PlanDef } from "./components/PlanCard.js";
import { billingOffer, type BillingCycle, type BillingOffer, BILLING_PLAN_PRESENTATION } from "@zyon/shared-types";

export function toPlanDef(plan: BillingPlanCard): PlanDef {
  if (!["starter", "growth", "scale"].includes(plan.key)) throw new Error("Plano desconhecido no catálogo.");
  const limit = (key: string) => plan.limits?.[key] ?? -1;
  const presentation = BILLING_PLAN_PRESENTATION[plan.key as "starter" | "growth" | "scale"];
  return {
    key: plan.key as PlanDef["key"], name: plan.name, price: plan.priceBrl,
    billingOptions: plan.billingOptions, annualCheckoutAvailable: plan.annualCheckoutAvailable,
    fee: ((plan.transactionFeeCents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    limits: { orders: limit("ordersPerMonth"), voiceSessions: limit("voiceSessionsPerMonth") },
    features: [...presentation.highlights], recommended: plan.recommended,
    highlights: [...presentation.highlights], trialDays: plan.trialDays,
  };
}

export function selectedBillingOffer(plan: PlanDef, cycle: BillingCycle): BillingOffer | undefined {
  if (plan.key === "starter" || cycle === "monthly") {
    return plan.billingOptions?.find(option => option.cycle === "monthly") ?? billingOffer(Math.round(plan.price * 100), "monthly");
  }
  return plan.annualCheckoutAvailable ? plan.billingOptions?.find(option => option.cycle === "annual") : undefined;
}
export const billingMoney = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
