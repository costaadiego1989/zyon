import React from "react";
import type { AnalysisStatus } from "../../api/endpoints/revenue-manager.js";
import { openStrategyReview } from "./strategy-review.js";

const results: Record<string, string> = {
  recommendations: "Estratégia pronta para sua revisão",
  insufficient_data: "Ainda precisamos de mais sessões com prazo de compra encerrado para recomendar uma mudança.",
  keep_current: "Vamos manter a estratégia atual enquanto o teste coleta resultados ou uma sugestão aguarda sua decisão.",
};
const reasons: Record<string, string> = {
  budget_exhausted: "A análise aguarda a renovação do orçamento disponível.",
  daily_analysis_limit: "A análise entrou na fila da próxima janela disponível.",
  provider_capacity: "A análise aguarda disponibilidade do serviço de IA.",
  generation_disabled: "A geração de sugestões está pausada.",
  merchant_ineligible: "Verifique se o motor está ativado e se o recurso está disponível no seu plano.",
};
const format = (date: string) => new Date(date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function WeeklyAnalysisStatus({ status, error }: { status: AnalysisStatus | null; error: boolean }) {
  if (error) return <p role="status">Não foi possível atualizar o calendário de análises. Tentaremos novamente em instantes.</p>;
  if (!status || (status.mode !== "weekly" && !status.enabled)) return null;
  const run = status.run;
  const headline = !status.enabled ? "Análises semanais pausadas"
    : !status.queue_available ? "Análise aguardando disponibilidade"
    : run?.status === "running" ? "Analisando os dados da sua loja"
    : run?.status === "completed" ? "Sua análise semanal foi concluída"
    : run?.status === "failed" ? "Não foi possível concluir a análise"
    : status.overdue ? "Sua análise está na fila" : "Próxima análise semanal";
  return <section aria-label="Análise semanal" style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "16px 20px" }}>
    <strong>{headline}</strong>
    <p style={{ margin: "8px 0", color: "var(--color-text-muted)" }}>
      {status.next_eligible_at ? `${status.overdue ? "Prevista desde" : "Prevista para"} ${format(status.next_eligible_at)}. ` : "Preparando o calendário da sua loja. "}
      Cada loja recebe uma análise por semana. Sugestões precisam da sua aprovação.
    </p>
    {run && <details>
      <summary style={{ cursor: "pointer" }}>Ver detalhes da análise</summary>
      <p>{run.status === "completed" ? results[run.result ?? ""] ?? "Análise concluída."
        : reasons[run.reason ?? ""] ?? (run.status === "failed" ? "A equipe pode retomar a análise após verificar a falha. Nenhuma estratégia foi ativada por esta tentativa."
          : run.status === "deferred_budget" ? "A análise aguarda uma configuração ou disponibilidade do serviço."
          : "Estamos verificando os dados e as estratégias da loja.")}</p>
      <p style={{ color: "var(--color-text-muted)" }}>Agendada em {format(run.createdAt)}{run.completedAt ? ` · Concluída em ${format(run.completedAt)}` : ""}</p>
      {run.hypothesisId && <button type="button" className="zyn-btn zyn-btn--primary" onClick={() => openStrategyReview(run.hypothesisId!)}>Revisar estratégia</button>}
    </details>}
  </section>;
}
