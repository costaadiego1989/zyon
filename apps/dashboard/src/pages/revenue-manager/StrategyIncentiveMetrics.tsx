import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import type { IncentiveMetrics } from "../../api/endpoints/incentive-metrics.js";
import { formatReviewDate as date, formatReviewNumber as number } from "./strategy-review-model.js";

const states: Record<string, string> = { collecting: "Coletando resultados", awaiting_maturity: "Aguardando as últimas compras",
  positive: "Melhora de conversão observada", negative: "Queda de conversão observada", inconclusive: "Sem conclusão de melhora",
  invalid: "Teste interrompido ou dados insuficientes para uma conclusão válida", not_started: "Teste ainda não iniciado" };
const money = (value: number) => (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function StrategyIncentiveMetrics({ strategyId, version, proposalHash, refreshToken }: {
  strategyId: string; version: number; proposalHash: string; refreshToken: unknown;
}) {
  const api = useApi(), generation = useRef(0), lock = useRef(false);
  const [data, setData] = useState<IncentiveMetrics | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (lock.current) return; lock.current = true; setBusy(true); const seq = generation.current;
    try {
      const result = await api.getIncentiveMetrics(strategyId, version);
      if (result.strategyId !== strategyId || result.version !== version || result.proposalHash !== proposalHash
        || result.measurement && (result.measurement.definition !== "incentive-assigned-buyer-results-v1" || result.measurement.unit !== "assigned_buyer"
          || !result.execution || ![result.measurement.control, result.measurement.treatment].every(arm => arm
            && Object.values(arm).every(value => Number.isSafeInteger(value) && value >= 0)
            && arm.converted <= arm.mature && arm.mature <= arm.assigned))) throw new Error("Invalid incentive metrics");
      if (seq === generation.current) { setData(result); setError(false); }
    } catch { if (seq === generation.current) setError(true); }
    finally { if (seq === generation.current) { lock.current = false; setBusy(false); } }
  }, [api, strategyId, version, proposalHash]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    return () => { ++generation.current; lock.current = false; window.clearInterval(timer); }; }, [refresh, refreshToken]);
  const result = data?.measurement;
  if (data && !data.execution && !error) return null;
  return <section className="strategy-detail-section strategy-metrics" aria-labelledby="incentive-results-title">
    <h2 id="incentive-results-title">Resultados do teste de desconto</h2>
    {error && <p role="alert" className="strategy-review-error">Não foi possível atualizar os resultados do desconto.{data ? " Os últimos dados disponíveis foram preservados." : ""}</p>}
    {!data && !error && <p role="status">Carregando os resultados do desconto…</p>}
    {result && <>
      <h3>{states[result.state] ?? "Resultado indisponível"}</h3>
      <p>Dados de {date(result.collectedAt)}. Cada comprador permanece no grupo original, mesmo sem usar o desconto ou concluir a compra.</p>
      <div className="strategy-metrics-table-wrap"><table className="strategy-metrics-table">
        <caption>Checkout atual e checkout com desconto sugerido</caption>
        <thead><tr><th scope="col">Indicador</th><th scope="col">Sem desconto do teste</th><th scope="col">Com desconto do teste</th></tr></thead>
        <tbody>{([
          ["Compradores participantes", number(result.control.assigned), number(result.treatment.assigned)],
          ["Janela de compra encerrada", number(result.control.mature), number(result.treatment.mature)],
          ["Compradores com pedido aprovado", number(result.control.converted), number(result.treatment.converted)],
          ["Conversão nas janelas encerradas", ...[result.control, result.treatment].map(arm => arm.mature ? `${number(arm.converted / arm.mature * 100)}%` : "Aguardando")],
          ["Receita observada", money(result.control.revenueCents), money(result.treatment.revenueCents)],
          ["Descontos nas compras medidas", money(result.control.discountCents), money(result.treatment.discountCents)],
          ["Usos confirmados do orçamento", number(result.control.redemptions), number(result.treatment.redemptions)],
          ["Reservas aguardando conclusão", number(result.control.pendingReservations), number(result.treatment.pendingReservations)],
          ["Reservas liberadas", number(result.control.released), number(result.treatment.released)],
          ["Pagamentos devolvidos", number(result.control.refunds), number(result.treatment.refunds)],
        ]).map(([label, control, treatment]) => <tr key={label}><th scope="row">{label}</th><td>{control}</td><td>{treatment}</td></tr>)}</tbody>
      </table></div>
      <p>Orçamento: {money(result.budget.limitCents)}. Descontos consumidos: {money(result.budget.spentCents)}. Reservado: {money(result.budget.reservedCents)}. Saldo contábil: {money(result.budget.availableCents)}.</p>
      <p>Conversão e receita incluem somente pedidos aprovados, com pagamento confirmado e janela de compra encerrada. Usos do orçamento, reservas e devoluções mostram a situação atual de todos os participantes. Uma devolução não reabre o orçamento já consumido.</p>
      <p>Amostra planejada: {number(result.minimumBuyersPerArm)} compradores por grupo.{result.matureAt ? ` A última janela de compra termina em ${date(result.matureAt)}.` : ""}</p>
      {result.interval && <p>Diferença de conversão: {number(result.interval.effectBps / 100)} pontos percentuais. Intervalo de confiança de 95%: {number(result.interval.lowerBps / 100)} a {number(result.interval.upperBps / 100)} pontos.</p>}
      <p className="strategy-review-note">Receita observada e descontos confirmados não comprovam lucro ou receita incremental. A margem é conferida antes de aplicar o benefício. O resultado não ativa outra estratégia automaticamente.</p>
    </>}
    {(error || data?.execution) && <button type="button" className="zyn-btn zyn-btn--ghost" disabled={busy} onClick={() => void refresh()}>{busy ? "Atualizando resultados…" : "Atualizar resultados do desconto"}</button>}
  </section>;
}
