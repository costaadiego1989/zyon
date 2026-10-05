import type { IncentiveReview } from "../../api/endpoints/incentive-review.js";

export type IncentiveStatusProjection = {
  strategyId: string; version: number; proposalHash: string; recommendationHash?: string; label: string;
};

/** A commercial proposal's decision and execution have their own authority.
 * A historical approval receipt alone does not prove an experiment is active. */
export function incentiveReviewStatusLabel(status: string | undefined,
  execution: IncentiveReview["execution_status"] = "unavailable", historical = false): string {
  if (!historical && execution !== "unavailable") {
    if (execution === "withdrawn" && ["withdrawn", "approved_awaiting_activation", "approval_invalidated"].includes(status ?? "")) return "Teste interrompido";
    if (!["approved_awaiting_activation", "approval_invalidated"].includes(status ?? "")) return "Decisão indisponível";
    return { active: "Em teste", scheduled: "Aprovada, aguardando início", suspended: "Novas ofertas suspensas",
      ended: "Teste encerrado", withdrawn: "Teste interrompido" }[execution] ?? "Decisão indisponível";
  }
  if (status === "approved_awaiting_activation") return historical ? "Aprovação registrada" : "Aprovada, aguardando ativação";
  const labels: Record<string, string> = { rejected: "Recusada", withdrawn: "Aprovação cancelada",
    approval_invalidated: "Condições da aprovação mudaram", awaiting_review: "Aguardando revisão" };
  return labels[status ?? ""] ?? "Decisão indisponível";
}
