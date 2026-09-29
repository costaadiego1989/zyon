import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";
import { formatReviewNumber as number } from "./strategy-review-model.js";
import { StrategyIncentivePlanning, validIncentivePlanning } from "./StrategyIncentivePlanning.js";
import { StrategyIncentiveDecision, type IncentiveDecisionContext } from "./StrategyIncentiveDecision.js";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function StrategyIncentiveRecommendation({ recommendation: r, policyCurrent, decisionContext }: {
  recommendation: StrategyProposal["incentiveRecommendation"]; policyCurrent?: boolean | null;
  decisionContext?: IncentiveDecisionContext;
}) {
  if (!r) return null;
  const fallback = <section className="strategy-detail-section"><h2>Teste de desconto sugerido</h2>
    <p>Atualize o dashboard para consultar este formato de sugestão.</p></section>;
  if (!["weekly-incentive-recommendation-v1", "weekly-incentive-recommendation-v2"].includes(r.definition) || r.execution !== "unavailable"
    || r.approval !== "separate_incentive_review_required" || r.budgetStatus !== "not_reserved") return fallback;
  if (r.status === "not_recommended") {
    if (r.reason === "no_safe_candidate") return null; // Explained by the companion simulation.
    if (r.reason !== "financial_policy_disabled") return fallback;
    return <section className="strategy-detail-section"><h2>Teste de desconto sugerido</h2>
      <p>Os limites financeiros estavam desativados nesta análise. Quando estiverem habilitados nas configurações,
        o motor poderá sugerir um teste na próxima análise semanal.</p></section>;
  }
  const t = r.test;
  if (r.status !== "recommended" || !t || t.kind !== "capped_percentage_discount" || t.currency !== "BRL"
    || t.start !== "after_specific_approval" || t.allocation !== "50/50" || t.maxPerBuyer !== 1 || t.durationDays !== 7
    || t.control !== "current_checkout_without_test_incentive" || t.stacking !== "no_other_coupon_or_incentive"
    || t.audience?.consent !== "required" || t.audience?.holdout !== "excluded"
    || t.audience?.identity !== "first_eligible_session_per_buyer"
    || t.measurement?.result !== "not_measured" || t.measurement?.samplePlanning !== (r.definition === "weekly-incentive-recommendation-v2"
      ? "included_in_recommendation" : "required_before_activation")
    || t.measurement?.conversionWindowHours !== 168
    || [t.maxDiscountCents, t.limitCents, t.maxRedemptions, t.audience.minCartTotalCents, t.audience.maxCartTotalCents]
      .some(n => !Number.isSafeInteger(n) || n <= 0)
    || !Number.isFinite(t.discountPercent) || t.discountPercent <= 0 || t.discountPercent > 100
    || !Number.isFinite(t.minimumMarginPercent) || t.minimumMarginPercent < 0 || t.minimumMarginPercent > 100
    || t.audience.maxCartTotalCents < t.audience.minCartTotalCents
    || t.limitCents !== t.maxDiscountCents * t.maxRedemptions) return fallback;
  return <section className="strategy-detail-section" aria-labelledby="strategy-incentive-title">
    <h2 id="strategy-incentive-title">Teste de desconto sugerido</h2>
    <p>O motor preparou os valores abaixo a partir da simulação e dos limites da loja.</p>
    {policyCurrent === false && <p className="strategy-review-warning" role="status">Os limites financeiros mudaram após esta análise.
      Esta sugestão conserva os valores anteriores; a próxima análise semanal considerará os novos limites.</p>}
    <dl className="strategy-measurement-facts">
      <div><dt>Oferta sugerida</dt><dd>{number(t.discountPercent)}%, até {money(t.maxDiscountCents)} por compra</dd></div>
      <div><dt>Orçamento máximo sugerido</dt><dd>{money(t.limitCents)} para até {number(t.maxRedemptions)} usos</dd></div>
      <div><dt>Duração sugerida</dt><dd>{t.durationDays} dias após aprovação específica</dd></div>
      <div><dt>Margem mínima a preservar</dt><dd>{number(t.minimumMarginPercent)}%</dd></div>
      <div><dt>Público sugerido</dt><dd>{t.audience.intent === "price_sensitive" ? "Compradores com sensibilidade ao preço" : "Compradores com o perfil de intenção da simulação"}, com consentimento</dd></div>
      <div><dt>Faixa de carrinho</dt><dd>{money(t.audience.minCartTotalCents)} a {money(t.audience.maxCartTotalCents)}</dd></div>
    </dl>
    {r.definition === "weekly-incentive-recommendation-v2" && <StrategyIncentivePlanning planning={r.planning}
      maxDiscountCents={t.maxDiscountCents} maxRedemptions={t.maxRedemptions} />}
    {decisionContext ? <StrategyIncentiveDecision context={decisionContext} approvalDisplayValid={r.definition === "weekly-incentive-recommendation-v2"
      && policyCurrent !== false && validIncentivePlanning(r.planning, t.maxDiscountCents, t.maxRedemptions) && r.planning.status === "estimated_feasible"} /> : <p>Este teste de desconto ainda não está disponível para aprovação.
      Aprovar a comunicação abaixo não autoriza o desconto.</p>}
    <details className="strategy-review-details"><summary>Regras e métricas do teste sugerido</summary>
      <div className="strategy-review-details-body">
        <p>Um uso por comprador, sem acumular cupons ou outros incentivos. Compradores do grupo de referência da loja ficam fora deste teste.</p>
        <p>Metade dos participantes recebe o checkout atual; a outra metade pode receber o desconto.
          Preços, custos, público, margem e saldo precisam ser revalidados antes de cada oferta.</p>
        <p>O orçamento cobre o desconto máximo em todos os usos previstos. É um teto de gasto, não uma previsão de demanda.</p>
        <p>A métrica principal será a conversão em pedido aprovado por comprador, com acompanhamento de gastos com desconto,
          margem configurada e devoluções. O resultado ainda não foi medido.</p>
        <p>{r.definition === "weekly-incentive-recommendation-v1" ? "O tamanho da amostra precisa ser avaliado antes da ativação. " : ""}Após os sete dias de teste, as últimas participações
          ainda precisam completar sua janela de compra de sete dias antes da leitura final.</p>
      </div>
    </details>
  </section>;
}
