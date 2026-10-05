import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";
import { formatReviewDate as date, formatReviewNumber as number } from "./strategy-review-model.js";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function StrategyDiscountStudy({ study, selectedCandidateKey }: { study: StrategyProposal["discountStudy"];
  selectedCandidateKey?: NonNullable<StrategyProposal["incentiveRecommendation"]>["selectedCandidateKey"] }) {
  if (!study) return null;
  if (!["weekly-discount-study-v1", "weekly-discount-study-v2", "weekly-discount-study-v3"].includes(study.definition) || study.approvalScope !== "communication_only"
    || study.commercialBudget !== "not_reserved") return <section className="strategy-detail-section">
    <h2>Simulação de desconto</h2><p>Atualize o dashboard para consultar este formato de simulação.</p></section>;
  if (study.status === "no_safe_candidate") return <section className="strategy-detail-section">
    <h2>Simulação de desconto</h2><p>Os dados elegíveis e os limites da loja não permitiram sugerir um desconto neste ciclo.
      Isso não significa que descontos não funcionem. Uma nova avaliação depende da próxima análise semanal.</p></section>;
  const candidate = study.candidate;
  if (!candidate) return null;
  const s = candidate.simulation;
  const modern = study.definition !== "weekly-discount-study-v1";
  const commercial = study.definition === "weekly-discount-study-v3"
    ? study.commercialCandidates?.find(option => option.key === selectedCandidateKey) : modern ? study.commercialCandidate : undefined;
  const shipping = commercial?.kind === "capped_shipping_discount";
  const progressive = commercial?.kind === "capped_progressive_discount";
  if (modern && (!commercial || !["capped_percentage_discount", "capped_fixed_discount", "capped_shipping_discount", "capped_progressive_discount"].includes(commercial.kind)
    || !commercial.evidence || commercial.evidence.sampleSize !== s.sampleSize
    || commercial.evidence.basis !== (shipping ? "observed_shipping_burden" : commercial.kind === "capped_fixed_discount" ? "similar_cart_values" : progressive ? "progressive_safe_replay" : "percentage_discount_replay")
    || shipping && ([commercial.evidence.minShippingCents, commercial.evidence.maxShippingCents].some(n => !Number.isSafeInteger(n) || n! <= 0)
      || commercial.evidence.minShippingCents! > commercial.evidence.maxShippingCents!))) {
    return <section className="strategy-detail-section"><h2>Base da análise comercial</h2>
      <p>Atualize o dashboard para consultar este formato de simulação.</p></section>;
  }
  const percentage = !modern || commercial?.kind === "capped_percentage_discount";
  return <section className="strategy-detail-section" aria-labelledby="strategy-discount-study-title">
    <h2 id="strategy-discount-study-title">{modern ? "Base da análise comercial" : "Simulação de desconto"}</h2>
    <p>Os valores usados nas análises e nos testes internos servem para simulação e não geram cobrança.
      A simulação não aplica descontos nas vendas. O benefício depende da aprovação específica dos valores da proposta.</p>
    {shipping && <p>O histórico mostrou fretes relevantes em relação ao valor dos produtos. Isso motivou avaliar um desconto no frete;
      ainda não há resultado medido desse benefício.</p>}
    {commercial?.kind === "capped_fixed_discount" && <p>Os carrinhos avaliados tinham valores semelhantes.
      Isso permitiu sugerir um desconto de valor fixo, que ainda precisa ser testado.</p>}
    {progressive && <p>Os carrinhos avaliados comportavam as duas etapas dentro das margens usadas na análise.
      Isso permite propor o teste; ainda não comprova que aumentar o desconto melhora as vendas.</p>}
    <dl className="strategy-measurement-facts">
      {percentage && <div><dt>Desconto simulado</dt><dd>{number(candidate.percent)}%, até {money(s.maxDiscountCents)} por carrinho</dd></div>}
      {shipping && <div><dt>Fretes observados no histórico</dt><dd>{money(commercial.evidence.minShippingCents!)} a {money(commercial.evidence.maxShippingCents!)}</dd></div>}
      <div><dt>Faixa de carrinho avaliada</dt><dd>{money(s.minCartTotalCents)} a {money(s.maxCartTotalCents)}</dd></div>
      {percentage && <div><dt>Menor margem estimada</dt><dd>{number(s.minimumProjectedMarginPercent)}%</dd></div>}
      <div><dt>Compradores na amostra</dt><dd>{number(s.sampleSize)}</dd></div>
      <div><dt>Conversão observada</dt><dd>{number(s.observedConversionRate * 100)}%</dd></div>
      <div><dt>Efeito do desconto</dt><dd>A medir</dd></div>
    </dl>
    <p>A ativação de descontos depende de aprovação específica de um orçamento e de um teste com controle de resgates.
      A simulação, por si só, não reserva valores.</p>
    {modern && <p>Os valores finais aparecem na sugestão abaixo. A margem do pedido, incluindo o frete quando aplicável,
      será conferida novamente antes de cada benefício.</p>}
    <details className="strategy-review-details"><summary>Como a simulação foi calculada</summary>
      <div className="strategy-review-details-body">
        <p>Foi usada a primeira sessão elegível de cada comprador com consentimento, com uma janela de compra de {s.conversionWindowHours} horas já encerrada.
          A amostra cobre {study.lookbackDays} dias anteriores a essa janela, com referência em {date(study.asOf)}.</p>
        <p>{candidate.intent === "price_sensitive" ? "O grupo avaliado apresenta sensibilidade ao preço." : "O grupo avaliado compartilha um perfil de intenção registrado antes da sessão."}
          {" "}O perfil indica uma hipótese para testar; não comprova a causa do abandono.</p>
        <p>Preços e custos do catálogo registrados na simulação em {date(study.capturedAt)}, com taxa de pagamento assumida de {number(s.paymentFeeAssumptionPercent)}%.
          A margem estimada exclui frete, impostos, devoluções e IA; não representa lucro líquido.</p>
        <p>A soma dos descontos hipotéticos {modern ? "da simulação de referência percentual nos produtos" : "nos carrinhos avaliados"} é {money(s.replayDiscountTotalCents)}.
          Esse total não é uma previsão de gasto nem um orçamento aprovado. Preços, custos, público e limites deverão ser validados novamente antes de qualquer oferta.</p>
      </div>
    </details>
  </section>;
}
