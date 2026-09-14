import { BILLING_PLANS } from "../billing-plans.js";
import type { BillingPlan } from "../payment-platform.types.js";
import type { OrderQuotaNoticeContext } from "./order-quota.types.js";

export type OrderQuotaNoticeMilestone = "limit" | "grace48" | "grace24" | "grace2" | "suspended" | "reopened";

export function requiredPlanForOrderQuota(plan: BillingPlan): BillingPlan | undefined {
  return plan === "starter" ? "growth" : plan === "growth" ? "scale" : undefined;
}

export function graceReminderMilestone(graceExpiresAt: Date, now: Date): OrderQuotaNoticeMilestone | undefined {
  const remaining = graceExpiresAt.getTime() - now.getTime();
  if (remaining <= 2 * 60 * 60 * 1_000) return "grace2";
  if (remaining <= 24 * 60 * 60 * 1_000) return "grace24";
  if (remaining <= 48 * 60 * 60 * 1_000) return "grace48";
  return undefined;
}

export function orderQuotaNoticeContent(milestone: OrderQuotaNoticeMilestone, context: OrderQuotaNoticeContext) {
  const planName = BILLING_PLANS[context.plan].name;
  const required = requiredPlanForOrderQuota(context.plan);
  const upgrade = required ? ` Assine o plano ${BILLING_PLANS[required].name} para liberar a operação imediatamente.` : "";

  if (milestone === "suspended") {
    return {
      title: "Sua loja está temporariamente indisponível para novos pedidos",
      body: `O limite de ${context.limit} pedidos do plano ${planName} foi ultrapassado e o prazo de 72 horas terminou.${upgrade}`,
    };
  }
  if (milestone === "reopened") {
    return {
      title: "Sua loja voltou a receber pedidos",
      body: "A capacidade mensal está disponível novamente. Novas solicitações já podem ser recebidas.",
    };
  }
  if (milestone !== "limit") {
    return {
      title: "Ação necessária para manter sua loja recebendo pedidos",
      body: `Sua loja já usou ${context.usedOrders} de ${context.limit} pedidos do plano ${planName}. O prazo para atualizar o plano está terminando.${upgrade}`,
    };
  }
  return {
    title: "Você atingiu o limite mensal de pedidos",
    body: `Sua loja já usou ${context.usedOrders} de ${context.limit} pedidos do plano ${planName}. Ela continuará recebendo pedidos pelos próximos 72 horas.${upgrade}`,
  };
}
