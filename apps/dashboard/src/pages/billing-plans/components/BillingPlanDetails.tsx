import React from "react";
import { Check } from "lucide-react";
import { BILLING_PLAN_PRESENTATION, BUYER_SERVICE_FEE_CENTS, type BillingCycle } from "@zyon/shared-types";
import type { PlanDef } from "./PlanCard.js";
import { billingMoney, selectedBillingOffer } from "../plan-catalog.js";
import "./billing-plan-details.css";

/** The same commercial information in onboarding and subscription management. */
export function BillingPlanDetails({ plan, billingCycle, choice }: {
  plan: PlanDef; billingCycle: BillingCycle; choice?: React.ReactNode;
}) {
  const copy = BILLING_PLAN_PRESENTATION[plan.key];
  const offer = selectedBillingOffer(plan, billingCycle);
  const visibleFeatures = plan.features.slice(0, 5);
  const additionalFeatures = plan.features.slice(5);
  return <div className="billing-plan-details">
    <div className="billing-plan-details__label"><span>{copy.eyebrow}</span><span>{copy.badge}</span></div>
    <div className="billing-plan-details__heading"><h2>{plan.name}</h2>{choice}</div>
    <p className="billing-plan-details__description">{copy.description}</p>
    <div className="billing-plan-details__pricing">
      <div className="billing-plan-details__price"><strong>{offer ? billingMoney(offer.equivalentMonthlyCents) : "Indisponível"}</strong>{offer && <span>/mês</span>}</div>
      <p>{plan.key === "starter"
        ? `${plan.trialDays ?? 14} dias para conhecer a Zyon, sem taxa Zyon por transação nesse período. Depois, ${plan.fee} por transação.`
        : `${plan.fee} por transação. Tarifa fixa por compra.`}</p>
      {plan.key !== "starter" && billingCycle === "annual" && <p>{offer
        ? <>Total anual: <strong>{billingMoney(offer.amountCents)}</strong>, pago de uma vez. Economia de {billingMoney(offer.savingsCents)} ({offer.discountPercent}%).</>
        : "O plano anual ainda não está disponível para contratação."}</p>}
    </div>
    <dl className="billing-plan-details__limits">
      {plan.key === "scale" && <div><dt>Multiloja (multitenant)</dt><dd>Até 5 lojas independentes</dd></div>}
      <Limit label="Compras por mês" value={plan.limits.orders} />
      {plan.key !== "starter" && <Limit label="Sessões por voz por mês" value={plan.limits.voiceSessions} />}
    </dl>
    <p className="billing-plan-details__note">O limite considera compras com pagamento confirmado.</p>
    {plan.features.length > 0 && <div className="billing-plan-details__resources">
      <h3>{copy.includes}</h3>
      <Features features={visibleFeatures} />
      {additionalFeatures.length > 0 && <details><summary>Ver todos os recursos <span aria-hidden="true">+</span></summary><Features features={additionalFeatures} /></details>}
    </div>}
  </div>;
}

function Limit({ label, value }: { label: string; value: number | undefined }) {
  return <div><dt>{label}</dt><dd>{value === undefined ? "Não informado" : value < 0 ? "Ilimitado" : value.toLocaleString("pt-BR")}</dd></div>;
}

function Features({ features }: { features: string[] }) {
  return <ul className="billing-plan-details__features">{features.map(feature => <li key={feature}><Check size={15} aria-hidden="true" /><span>{feature}</span></li>)}</ul>;
}

export function BillingTerms() {
  return <>Confira o período e o total antes de assinar. O anual é pago de uma vez; o desconto vale somente para a assinatura. As cotas de compras são mensais. O comprador paga {billingMoney(BUYER_SERVICE_FEE_CENTS)} de serviço por compra. Taxas do provedor de pagamento são separadas.</>;
}
