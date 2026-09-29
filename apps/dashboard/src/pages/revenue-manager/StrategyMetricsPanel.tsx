import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import type { StrategyMetrics, StrategyMetricArm, StrategyAiUsageArm } from "../../api/endpoints/strategy-metrics.js";
import { formatReviewDate as date, formatReviewNumber as number } from "./strategy-review-model.js";

const states: Record<string, string> = {
  not_started: "Teste ainda não iniciado", collecting: "Coletando resultados", awaiting_maturity: "Aguardando as últimas compras",
  invalid: "Resultado requer verificação", inconclusive: "Teste encerrado sem conclusão", positive: "Melhora de conversão observada", negative: "Queda de conversão observada",
};
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = (arm: StrategyMetricArm) => arm.mature ? `${number(arm.converted / arm.mature * 100)}%` : "Aguardando";
const aiCost = (arm: StrategyAiUsageArm) => {
  if (arm.admittedTurns > 0 && arm.notDispatchedTurns === arm.admittedTurns) return "Sem chamada";
  if (arm.estimatedCostMicros == null || !arm.currency) return "Sem dados";
  return `${arm.currency} ${(arm.estimatedCostMicros / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 6 })}`;
};

export function StrategyMetricsPanel({ strategyId, version, proposalHash }: { strategyId: string; version: number; proposalHash: string }) {
  const api = useApi(), alive = useRef(false), locked = useRef(false);
  const [data, setData] = useState<StrategyMetrics | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const next = await api.collectStrategyMetrics(strategyId, version);
      if (next.strategyId !== strategyId || next.version !== version || (next.execution && next.execution.proposalHash !== proposalHash)) {
        throw new Error("Unexpected strategy metrics");
      }
      if (alive.current) { setData(next); setError(false); }
    } catch { if (alive.current) setError(true); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }, [api, strategyId, version, proposalHash]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [refresh]);
  const result = data?.measurement?.result;
  const supported = result?.definitionVersion === "session-conversion-fixed-horizon-v1"
    && result.delivery?.definition === "strategy-assignment-delivery-v1";
  const costs = result?.economics?.definition === "strategy-order-cost-coverage-v1" ? result.economics : undefined;
  const ai = result?.aiUsage?.definition === "strategy-chat-ai-usage-v1" ? result.aiUsage : undefined;
  const participation = result?.participation?.definition === "strategy-participation-v1"
    && result.participation.populationSource === "immutable_strategy_assignments" ? result.participation : undefined;
  const paymentCosts = result?.paymentCosts?.definition === "strategy-payment-cost-coverage-v1"
    && result.paymentCosts.currency === "BRL" && result.paymentCosts.scope === "mature_approved_orders" ? result.paymentCosts : undefined;
  return <section className="strategy-detail-section strategy-metrics" aria-labelledby="strategy-results-title">
    <h2 id="strategy-results-title">Resultados desta estratégia</h2>
    {error && <p role="alert" className="strategy-review-error">Não foi possível atualizar os resultados.{data?.measurement ? " Os dados abaixo são da última consulta." : ""}</p>}
    {!data && !error && <p role="status">Carregando resultados…</p>}
    {data && !data.execution && <p>Esta versão ainda não foi ativada. Os resultados aparecerão aqui quando o teste começar.</p>}
    {data?.execution && !result && <p>O teste foi registrado. A primeira medição ainda não está disponível.</p>}
    {result && !supported && <p>Esta medição usa outro formato. Atualize o dashboard para consultar os resultados.</p>}
    {result && supported && <>
      <h3>{states[result.state] ?? "Resultado indisponível"}</h3>
      <p className="strategy-review-note">Dados de {date(data!.measurement!.collectedAt)}. Os resultados são atualizados por hora e ao encerrar o teste.</p>
      {data!.execution!.stoppedAt && <p>Teste {new Date(data!.execution!.stoppedAt) >= new Date(data!.execution!.endsAt) ? "encerrado" : "interrompido"} em {date(data!.execution!.stoppedAt)}.</p>}
      <div className="strategy-metrics-table-wrap"><table className="strategy-metrics-table">
        <caption>Comparação da comunicação atual com a abordagem sugerida</caption>
        <thead><tr><th scope="col">Indicador</th><th scope="col">Atual</th><th scope="col">Sugerida</th></tr></thead>
        <tbody>
          {([
            ["Sessões participantes", number(result.control.assigned), number(result.treatment.assigned)],
            ...(participation ? [["Sessões que seguiram sem o experimento", number(participation.control.contextExitSessions), number(participation.treatment.contextExitSessions)]] : []),
            ["Janela de compra encerrada", number(result.control.mature), number(result.treatment.mature)],
            ["Sessões com compra aprovada", number(result.control.converted), number(result.treatment.converted)],
            ["Conversão nas sessões encerradas", rate(result.control), rate(result.treatment)],
            ["Pedidos aprovados", number(result.control.orders), number(result.treatment.orders)],
            ["Receita observada (R$)", money(result.control.revenueCents), money(result.treatment.revenueCents)],
            ...(costs ? [["Custo de produtos cadastrado (R$)",
              costs.control.configuredProductCostCents == null ? "Sem dados" : money(costs.control.configuredProductCostCents),
              costs.treatment.configuredProductCostCents == null ? "Sem dados" : money(costs.treatment.configuredProductCostCents)]] : []),
            ...(paymentCosts ? [["Taxas de pagamento confirmadas (R$)",
              paymentCosts.control.confirmedPaymentFeesCents == null ? "Sem dados" : money(paymentCosts.control.confirmedPaymentFeesCents),
              paymentCosts.treatment.confirmedPaymentFeesCents == null ? "Sem dados" : money(paymentCosts.treatment.confirmedPaymentFeesCents)]] : []),
            ["Sessões com mensagem salva", number(result.delivery!.control.sessionsWithPublication), number(result.delivery!.treatment.sessionsWithPublication)],
            ["Sessões com exibição informada", number(result.delivery!.control.sessionsWithDisplay), number(result.delivery!.treatment.sessionsWithDisplay)],
            ...(ai ? [["IA das conversas do teste (estimativa)", aiCost(ai.control), aiCost(ai.treatment)]] : []),
          ]).map(([label, control, treatment]) => <tr key={label}><th scope="row">{label}</th><td>{control}</td><td>{treatment}</td></tr>)}
        </tbody>
      </table></div>
      <p>Todas as sessões participantes entram na comparação, mesmo sem conversa ou compra. Receita e conversão acima consideram apenas sessões com a janela de compra encerrada.</p>
      {participation && participation.control.contextExitSessions + participation.treatment.contextExitSessions > 0 && <p>Algumas sessões seguiram pelo checkout habitual ao encontrar uma condição ainda não atendida pelo experimento, como um cupom ou uma personalização existente. Elas permanecem no grupo original, incluindo suas compras. Essa regra vale para as duas abordagens.</p>}
      {costs && costs.control.orders + costs.treatment.orders > 0 && <p>Custos do catálogo preservados para {number(costs.control.coveredOrders + costs.treatment.coveredOrders)} de {number(costs.control.orders + costs.treatment.orders)} pedidos aprovados. O total do grupo só aparece quando todos os pedidos têm esse custo registrado. Esses valores não incluem frete, taxas ou outros custos e não comprovam lucro.</p>}
      {paymentCosts && paymentCosts.control.orders + paymentCosts.treatment.orders > 0 && <p>Taxas da plataforma e do provedor confirmadas para {number(paymentCosts.control.coveredOrders + paymentCosts.treatment.coveredOrders)} de {number(paymentCosts.control.orders + paymentCosts.treatment.orders)} pedidos aprovados. O total do grupo só aparece quando todos os pedidos têm confirmação completa. Valores planejados não entram nessa soma. As taxas de pagamentos recusados, cancelados ou estornados não estão incluídas.</p>}
      {ai && ai.control.admittedTurns + ai.treatment.admittedTurns > 0 && <p>Uso de IA conhecido em {number(ai.control.pricedTurns + ai.control.notDispatchedTurns + ai.treatment.pricedTurns + ai.treatment.notDispatchedTurns)} de {number(ai.control.admittedTurns + ai.treatment.admittedTurns)} respostas avaliadas. A estimativa usa o consumo informado e a tarifa limite configurada; não é o valor faturado pelo provedor. Inclui respostas do teste mesmo sem compra ou publicação, mas não a análise semanal nem outras chamadas de IA. Valores sem confirmação ficam pendentes e moedas diferentes não são somadas.</p>}
      {!!(result.delivery!.control.pending + result.delivery!.treatment.pending) && <p>{number(result.delivery!.control.pending + result.delivery!.treatment.pending)} sessões ainda podem converter. As compras dessas sessões entrarão na comparação quando a janela encerrar.</p>}
      <p>Amostra planejada: {number(result.minimumSessionsPerArm)} sessões por grupo.{result.matureAt ? ` Prazo para concluir as janelas de compra: ${date(result.matureAt)}.` : ""}</p>
      {result.state === "inconclusive" && <p>A amostra ou a diferença observada ainda não sustenta uma conclusão de melhora.</p>}
      {result.state === "invalid" && <p>Há uma interrupção ou inconsistência nos dados. Esta medição não pode fundamentar a adoção da estratégia.</p>}
      {result.interval && ["positive", "negative", "inconclusive"].includes(result.state) && <p>Diferença de conversão: {number(result.interval.effectBps / 100)} pontos percentuais. Intervalo de confiança de 95%: {number(result.interval.lowerBps / 100)} a {number(result.interval.upperBps / 100)} pontos.</p>}
      <p className="strategy-review-note">A exibição é informada pelo widget; não confirma leitura pelo comprador. Receita observada não representa receita incremental. Margem, lucro e custo total de IA desta estratégia ainda estão indisponíveis. Esta medição não altera a estratégia automaticamente.</p>
    </>}
    {(error || data?.execution) && <button type="button" className="zyn-btn zyn-btn--ghost" disabled={busy} onClick={() => void refresh()}>{busy ? "Atualizando resultados…" : "Atualizar resultados"}</button>}
  </section>;
}
