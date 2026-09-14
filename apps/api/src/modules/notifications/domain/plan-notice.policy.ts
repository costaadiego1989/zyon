import { createHash } from "node:crypto";
export const PLAN_NOTICE_MILESTONES = ["7d", "3d", "24h", "expired"] as const;
export type PlanMilestone = typeof PLAN_NOTICE_MILESTONES[number];
export interface PlanNotice {
  id: string; merchantId: string; subscriptionKey: string; planKey: string; endsAt: Date; milestone: string;
}
export interface BillingTermSource {
  merchantId: string; status: string; planKey: string | null; provider: string | null;
  currentPeriodEnd: Date | null; trialEndsAt: Date | null; stripeSubscriptionId: string | null;
  asaasSubscriptionId: string | null; createdAt: Date;
}
export function billingTerm(row: BillingTermSource | null) {
  if (!row) return null;
  const trial = ["trialing", "starter"].includes(row.status) && !!row.trialEndsAt
    && !row.stripeSubscriptionId && !row.asaasSubscriptionId;
  const endsAt = trial ? row.trialEndsAt : row.currentPeriodEnd;
  if (!endsAt || !Number.isFinite(endsAt.getTime())) return null;
  if (!trial && !["active", "past_due", "unpaid", "cancelled", "canceled", "starter", "trialing"].includes(row.status)) return null;
  return { merchantId: row.merchantId, endsAt,
    planKey: trial ? "trial" : row.planKey ?? "plano",
    subscriptionKey: trial ? `trial:${endsAt.toISOString()}`
      : `${row.provider ?? "billing"}:${row.asaasSubscriptionId ?? row.stripeSubscriptionId ?? row.createdAt.toISOString()}` };
}
/** Only the current window is enqueued after downtime; never burst-send older reminders. */
export function planMilestone(endsAt: Date, now: Date): PlanMilestone | null {
  const remaining = endsAt.getTime() - now.getTime();
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "expired";
  if (remaining <= 24 * 60 * 60_000) return "24h";
  if (remaining <= 3 * 24 * 60 * 60_000) return "3d";
  if (remaining <= 7 * 24 * 60 * 60_000) return "7d";
  return null;
}
export function planNoticeId(term: NonNullable<ReturnType<typeof billingTerm>>, milestone: PlanMilestone) {
  return "plan:" + createHash("sha256").update(JSON.stringify([term.merchantId, term.subscriptionKey, term.endsAt.toISOString(), milestone])).digest("hex").slice(0, 40);
}
export function isCurrentPlanNotice(notice: PlanNotice, row: BillingTermSource | null, now: Date) {
  const term = billingTerm(row);
  return !!term && term.merchantId === notice.merchantId && term.subscriptionKey === notice.subscriptionKey
    && term.endsAt.getTime() === notice.endsAt.getTime() && term.planKey === notice.planKey
    && planMilestone(term.endsAt, now) === notice.milestone;
}
export function planName(key: string) {
  return ({ trial: "Período de avaliação", FREE: "Starter", STARTER: "Starter", GROWTH: "Growth", PRO: "Pro", SCALE: "Scale" } as Record<string,string>)[key === "trial" ? key : key.toUpperCase()] ?? key;
}
export function planNoticeContent(notice: Pick<PlanNotice,"planKey"|"endsAt"|"milestone">) {
  const date = notice.endsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const expired = notice.milestone === "expired";
  const deadline = ({ "7d": "7 dias", "3d": "3 dias", "24h": "24 horas" } as Record<string,string>)[notice.milestone];
  return { title: expired ? "Seu plano encerrou sem renovação confirmada" : `Seu plano vence em até ${deadline}`,
    body: expired ? `O plano ${planName(notice.planKey)} terminou em ${date} (horário de Brasília). Ainda não identificamos a renovação. Acesse seus planos para consultar a assinatura e regularizar o acesso.`
      : `O período atual do plano ${planName(notice.planKey)} termina em ${date} (horário de Brasília). Confira a renovação e a forma de pagamento na área de planos da Zyon.` };
}
