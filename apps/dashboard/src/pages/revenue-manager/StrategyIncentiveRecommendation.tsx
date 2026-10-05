import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";
import { formatReviewNumber as number } from "./strategy-review-model.js";
import { StrategyIncentivePlanning, validIncentivePlanning } from "./StrategyIncentivePlanning.js";
import { StrategyIncentiveDecision, type IncentiveDecisionContext } from "./StrategyIncentiveDecision.js";
import { incentiveBenefitLabel, incentiveOfferText, validIncentiveTest } from "./incentive-recommendation-model.js";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function StrategyIncentiveRecommendation({ recommendation: r, policyCurrent, decisionContext }: {
  recommendation: StrategyProposal["incentiveRecommendation"]; policyCurrent?: boolean | null;
  decisionContext?: IncentiveDecisionContext;
}) {
  if (!r) return null;
  const fallback = <section className="strategy-detail-section"><h2>Teste de desconto sugerido</h2>
    <p>Atualize o dashboard para consultar este formato de sugestão.</p></section>;
  if (!["weekly-incentive-recommendation-v1", "weekly-incentive-recommendation-v2", "weekly-incentive-recommendation-v3", "weekly-incentive-recommendation-v4"].includes(r.definition) || r.execution !== "unavailable"
    || r.approval !== "separate_incentive_review_required" || r.budgetStatus !== "not_reserved") return fallback;
  if (r.status === "not_recommended") {
    if (r.reason === "no_safe_candidate") return null; // Explained by the companion simulation.
    if (r.reason !== "financial_policy_disabled") return fallback;
    return <section className="strategy-detail-section"><h2>Teste de desconto sugerido</h2>
      <p>Esta análise foi concluída com novos testes de desconto desativados.
        As próximas sugestões respeitarão a preferência atual da loja.</p></section>;
  }
  if (!validIncentiveTest(r)) return fallback;
  const t = r.test, benefitLabel = incentiveBenefitLabel(t);
  const modern = r.definition === "weekly-incentive-recommendation-v3" || r.definition === "weekly-incentive-recommendation-v4";
  return <section className="strategy-detail-section" aria-labelledby="strategy-incentive-title">
    <h2 id="strategy-incentive-title">Teste de {benefitLabel} sugerido</h2>
    <p>O motor preparou os valores abaixo a partir da simulação e dos limites da loja.</p>
    <p>Os valores usados nas análises e nos testes internos servem para simulação e não geram cobrança.</p>
    <p>Após sua aprovação, o benefício usado pelo comprador é um desconto real da loja e reduz o valor que ela recebe,
      sempre dentro dos limites desta proposta. Esse desconto não é uma cobrança da Zyon.</p>
    {r.policyProposal && <p>A IA calculou estes limites a partir da oferta segura e da amostra necessária para medir o teste.
      Você não precisa preencher os valores: revise a exposição máxima abaixo e decida se quer autorizar esta estratégia.</p>}
    {policyCurrent === false && <p className="strategy-review-warning" role="status">Os limites financeiros mudaram após esta análise.
      Esta sugestão conserva os valores anteriores; a próxima análise semanal considerará os novos limites.</p>}
    <dl className="strategy-measurement-facts">
      <div><dt>Oferta sugerida</dt><dd>{incentiveOfferText(t)}</dd></div>
      {modern && <div><dt>Forma de aplicação</dt><dd>{t.delivery?.mode === "coupon_code" ? "Cupom para participantes elegíveis" : "Automática no checkout"}</dd></div>}
      {t.delivery?.mode === "coupon_code" && <div><dt>Código proposto</dt><dd><code>{t.delivery.code}</code></dd></div>}
      <div><dt>Orçamento máximo sugerido</dt><dd>{money(t.limitCents)} para até {number(t.maxRedemptions)} usos</dd></div>
      <div><dt>Duração sugerida</dt><dd>{t.durationDays} dias após aprovação específica</dd></div>
      <div><dt>Margem mínima a preservar</dt><dd>{number(t.minimumMarginPercent)}%</dd></div>
      {modern && t.kind !== "capped_percentage_discount" && <div><dt>Teto proporcional por pedido</dt><dd>{number(t.discountPercent)}% do valor dos produtos</dd></div>}
      <div><dt>Público sugerido</dt><dd>{t.audience.intent === "price_sensitive" ? "Compradores com sensibilidade ao preço" : "Compradores com o perfil de intenção da simulação"}, com consentimento</dd></div>
      <div><dt>Faixa de carrinho</dt><dd>{money(t.audience.minCartTotalCents)} a {money(t.audience.maxCartTotalCents)}</dd></div>
    </dl>
    {t.kind === "capped_progressive_discount" && <div className="strategy-metrics-table-wrap">
      <table className="strategy-metrics-table"><caption>Etapas propostas para o desconto</caption>
        <thead><tr><th scope="col">Quando pode ser aplicado</th><th scope="col">Desconto</th><th scope="col">Máximo por pedido</th></tr></thead>
        <tbody>{t.stages!.map(stage => <tr key={stage.index}><th scope="row">{stage.trigger === "enrollment" ? "Ao entrar no teste" : "Ao preparar o pagamento"}</th>
          <td>{number(stage.discountPercent)}%</td><td>{money(stage.maxDiscountCents)}</td></tr>)}</tbody></table>
      <p>A segunda etapa substitui a primeira; os descontos não se somam. O benefício só aumenta se o pedido continuar elegível e dentro das margens.
        Se o total mudar, o comprador precisa revisá-lo antes de confirmar o pagamento.</p>
      <p>O teto total já considera o desconto máximo da segunda etapa. Somente o valor efetivamente utilizado consome esse limite.</p>
    </div>}
    {t.kind === "capped_shipping_discount" && <p>O benefício reduz somente o frete cobrado, até o valor indicado.
      A modalidade de entrega, as regras de subsídio e a margem da loja precisam permitir o desconto. Isso não libera frete grátis para toda a loja.</p>}
    {t.kind === "capped_fixed_discount" && <p>O valor fixo só é aplicado quando o pedido comporta o desconto completo, respeitando o teto percentual e a margem da loja.</p>}
    {t.delivery?.mode === "coupon_code" && <p>O cupom personalizado é aplicado automaticamente aos compradores elegíveis do grupo que recebe o benefício, durante este teste.
      Compartilhar o código não libera o cupom para outros compradores.</p>}
    {r.definition !== "weekly-incentive-recommendation-v1" && <StrategyIncentivePlanning planning={r.planning}
      maxDiscountCents={t.maxDiscountCents} maxRedemptions={t.maxRedemptions} />}
    {decisionContext ? <StrategyIncentiveDecision context={decisionContext} benefitLabel={benefitLabel}
      approvalSummary={`Você autoriza até ${money(t.limitCents)} em descontos, no máximo ${money(t.maxDiscountCents)} por pedido e ${number(t.maxRedemptions)} usos, durante ${t.durationDays} dias. ${t.kind === "capped_progressive_discount" ? "Esse teto já inclui as duas etapas apresentadas, sem somar os descontos." : incentiveOfferText(t) + "."}`}
      approvalDisplayValid={r.definition !== "weekly-incentive-recommendation-v1"
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
