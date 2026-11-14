import { useId } from "react";
import { billingPromotionDuration, type AutomaticBillingPromotion, type BillingCycle } from "@zyon/shared-types";
import "./billing-promotion-field.css";

export function BillingPromotionField({ value, onChange, disabled, cycle, promotion }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; cycle: BillingCycle; promotion?: AutomaticBillingPromotion;
}) {
  const id = useId();
  return <div className="billing-promotion-field">
    {promotion && !value.trim() && cycle === "monthly" && <div className="billing-promotion-applied" role="status">
      <strong>{promotion.name} aplicada automaticamente</strong>
      <p>{promotion.discountType === "percent" ? `${promotion.discountValue / 100}% de desconto` : `R$ ${(promotion.discountValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} de desconto`} {billingPromotionDuration(promotion)}. Você não precisa digitar um código.</p>
    </div>}
    <details className="billing-promotion-manual"><summary>Tenho outro cupom</summary>
    <label htmlFor={id}>Cupom de assinatura <span>(opcional)</span></label>
    <input id={id} value={value} onChange={event => onChange(event.target.value.toUpperCase())}
      disabled={disabled || cycle !== "monthly"} maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false}
      placeholder="Digite seu cupom" aria-describedby={`${id}-help`} />
    <p id={`${id}-help`}>{cycle === "monthly"
      ? "O cupom será validado ao confirmar o plano. Confira o desconto na Stripe antes de pagar. Válido para novas assinaturas mensais."
      : "Cupons de campanha não se aplicam ao anual. Selecione Mensal para usar um cupom."}</p>
    </details>
  </div>;
}
