import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";
import { formatReviewNumber as number } from "./strategy-review-model.js";

type Planning = NonNullable<StrategyProposal["incentiveRecommendation"]>["planning"];
const reasons: Record<string, string> = {
  incomplete_history: "O histórico excedeu o limite de leitura. Uma amostra parcial não basta para planejar o teste.",
  insufficient_baseline: "Ainda há menos de 100 compradores elegíveis no histórico usado para o planejamento.",
  unusable_conversion_rate: "A taxa de conversão deste público ainda não permite calcular uma amostra confiável.",
  sample_not_feasible: "A amostra necessária excede a capacidade deste tipo de teste.",
  insufficient_weekly_traffic: "O movimento estimado para sete dias fica abaixo da amostra necessária.",
  insufficient_budget: "O orçamento e os usos sugeridos não cobrem o desconto máximo para toda a amostra necessária.",
};
const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
export function validIncentivePlanning(p: Planning, maxDiscountCents: number, maxRedemptions: number): p is NonNullable<Planning> {
  return !(!p || p.definition !== "incentive-fixed-horizon-planning-v1" || p.result !== "not_measured"
    || p.durationDays !== 7 || p.conversionWindowHours !== 168 || p.allocation !== "50/50"
    || p.minimumEffectBps !== 100 || p.confidence !== .95 || p.planningPower !== .8
    || !p.baseline || !count(p.baseline.buyers) || !count(p.baseline.conversions) || p.baseline.conversions > p.baseline.buyers
    || typeof p.baseline.complete !== "boolean" || !count(p.fundedTreatmentBuyers)
    || p.fundedTreatmentBuyers !== maxRedemptions
    || [p.minimumBuyersPerArm, p.weeklyBuyersPerArm, p.requiredBudgetCents].some(n => n !== null && !count(n))
    || (p.requiredBudgetCents !== (p.minimumBuyersPerArm === null ? null : p.minimumBuyersPerArm * maxDiscountCents))
    || p.weeklyBuyersPerArm !== (p.baseline.complete ? Math.floor(p.baseline.buyers / 8) : null)
    || !Array.isArray(p.blockers) || p.blockers.some(s => !Object.hasOwn(reasons, s))
    || !["blocked", "estimated_feasible"].includes(p.status)
    || (p.status === "blocked") !== (p.blockers.length > 0)
    || (p.status === "estimated_feasible" && (!p.baseline.complete || !p.minimumBuyersPerArm
      || p.weeklyBuyersPerArm === null || p.weeklyBuyersPerArm < p.minimumBuyersPerArm
      || p.fundedTreatmentBuyers < p.minimumBuyersPerArm || !p.requiredBudgetCents)));
}
export function StrategyIncentivePlanning({ planning: p, maxDiscountCents, maxRedemptions }: {
  planning: Planning; maxDiscountCents: number; maxRedemptions: number;
}) {
  if (!validIncentivePlanning(p, maxDiscountCents, maxRedemptions)) {
    return <p role="status">Atualize o dashboard para consultar o planejamento deste teste.</p>;
  }
  return <div>
    <h3>Condições para medir o teste</h3>
    {p.status === "blocked" ? <div className="strategy-review-warning" role="status">
      <p>Este teste ainda não reúne as condições para medir o efeito do desconto.</p>
      <ul>{p.blockers.map(reason => <li key={reason}>{reasons[reason]}</li>)}</ul>
    </div> : <p>Na análise, o histórico e os limites sugeridos comportavam a amostra planejada. Isso não garante um resultado conclusivo.</p>}
    <dl className="strategy-measurement-facts">
      <div><dt>Compradores elegíveis no histórico</dt><dd>{p.baseline.complete ? number(p.baseline.buyers) : "Histórico incompleto"}</dd></div>
      <div><dt>Amostra necessária por grupo</dt><dd>{p.minimumBuyersPerArm === null ? "Ainda não calculável" : number(p.minimumBuyersPerArm)}</dd></div>
      <div><dt>Estimativa por grupo em sete dias</dt><dd>{p.weeklyBuyersPerArm === null ? "Indisponível" : number(p.weeklyBuyersPerArm)}</dd></div>
      <div><dt>Participantes com desconto cobertos pelo teto</dt><dd>{number(p.fundedTreatmentBuyers)}</dd></div>
    </dl>
    <details className="strategy-review-details"><summary>Como o motor planejou a medição</summary>
      <div className="strategy-review-details-body">
        <p>O cálculo usa 28 dias de histórico com a janela de compra encerrada, um comprador por vez, o público da oferta,
          consentimento e os preços e custos atuais. O grupo de referência da loja fica fora da contagem.</p>
        <p>O teste busca identificar uma diferença de 1 ponto percentual na conversão, com confiança de 95% e poder estatístico de 80%.
          Esse é um critério de planejamento, não uma previsão de aumento nas vendas.</p>
        <p>O orçamento precisa comportar o desconto máximo para cada participante do grupo com desconto.
          Quem não comprar não gera gasto.
          Isso evita planejar uma amostra que dependeria de conversões baixas para caber no teto.</p>
        {p.requiredBudgetCents !== null && <p>A amostra calculada exigiria até {(p.requiredBudgetCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de cobertura.
          Os limites da loja permanecem os configurados.</p>}
        <p>A leitura final considera todos os compradores atribuídos aos grupos, inclusive os que não compraram.
          Após os sete dias de entrada, aguarda mais sete dias para encerrar a janela das últimas compras.
          Este planejamento não mede efeito nem comprova lucro.</p>
      </div>
    </details>
  </div>;
}
