import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";
import { formatReviewDate as date, formatReviewNumber as number } from "./strategy-review-model.js";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function StrategyDiscountStudy({ study }: { study: StrategyProposal["discountStudy"] }) {
  if (!study) return null;
  if (study.definition !== "weekly-discount-study-v1" || study.approvalScope !== "communication_only"
    || study.commercialBudget !== "not_reserved") return <section className="strategy-detail-section">
    <h2>Simulação de desconto</h2><p>Atualize o dashboard para consultar este formato de simulação.</p></section>;
  if (study.status === "no_safe_candidate") return <section className="strategy-detail-section">
    <h2>Simulação de desconto</h2><p>Os dados elegíveis e os limites da loja não permitiram sugerir um desconto neste ciclo.
      Isso não significa que descontos não funcionem. Uma nova avaliação depende da próxima análise semanal.</p></section>;
  const candidate = study.candidate;
  if (!candidate) return null;
  const s = candidate.simulation;
  return <section className="strategy-detail-section" aria-labelledby="strategy-discount-study-title">
    <h2 id="strategy-discount-study-title">Simulação de desconto</h2>
    <p>Um cenário para avaliar em um próximo teste. Aprovar esta estratégia inicia somente o teste de comunicação.</p>
    <dl className="strategy-measurement-facts">
      <div><dt>Desconto simulado</dt><dd>{number(candidate.percent)}%, até {money(s.maxDiscountCents)} por carrinho</dd></div>
      <div><dt>Faixa de carrinho avaliada</dt><dd>{money(s.minCartTotalCents)} a {money(s.maxCartTotalCents)}</dd></div>
      <div><dt>Menor margem estimada</dt><dd>{number(s.minimumProjectedMarginPercent)}%</dd></div>
      <div><dt>Compradores na amostra</dt><dd>{number(s.sampleSize)}</dd></div>
      <div><dt>Conversão observada</dt><dd>{number(s.observedConversionRate * 100)}%</dd></div>
      <div><dt>Efeito do desconto</dt><dd>A medir</dd></div>
    </dl>
    <p>Para ativar descontos, ainda será necessário definir e aprovar um orçamento comercial e um teste próprio,
      com controle de resgates. Nenhum valor foi reservado.</p>
    <details className="strategy-review-details"><summary>Como a simulação foi calculada</summary>
      <div className="strategy-review-details-body">
        <p>Foi usada a primeira sessão elegível de cada comprador com consentimento, com uma janela de compra de {s.conversionWindowHours} horas já encerrada.
          A amostra cobre {study.lookbackDays} dias anteriores a essa janela, com referência em {date(study.asOf)}.</p>
        <p>{candidate.intent === "price_sensitive" ? "O grupo avaliado apresenta sensibilidade ao preço." : "O grupo avaliado compartilha um perfil de intenção registrado antes da sessão."}
          {" "}O perfil indica uma hipótese para testar; não comprova a causa do abandono.</p>
        <p>Preços e custos do catálogo registrados na simulação em {date(study.capturedAt)}, com taxa de pagamento assumida de {number(s.paymentFeeAssumptionPercent)}%.
          A margem estimada exclui frete, impostos, devoluções e IA; não representa lucro líquido.</p>
        <p>A soma dos descontos hipotéticos nos carrinhos avaliados é {money(s.replayDiscountTotalCents)}.
          Esse total não é uma previsão de gasto nem um orçamento aprovado. Preços, custos, público e limites deverão ser validados novamente antes de qualquer oferta.</p>
      </div>
    </details>
  </section>;
}
