import { DashboardHttpError } from "../../api/http/error.js";
import type { StrategyReview, StrategyVersion } from "../../api/endpoints/strategy-review.js";

export const STRATEGY_STATUSES: Record<string, string> = {
  pending_review: "Aguardando revisão", revision_pending: "Preparando alternativa", rejected: "Recusada",
  approved: "Aprovada, aguardando ativação", activation_pending: "Aguardando ativação",
  active: "Em teste", paused: "Pausada", completed: "Concluída",
};
export const REVISION_STATUSES: Record<string, string> = {
  queued: "Na fila para revisão", running: "Preparando alternativa", deferred: "Aguardando disponibilidade",
  retry_wait: "Nova tentativa agendada", failed: "Alternativa não concluída", completed: "Alternativa pronta",
};
export function reviewErrorCode(error: unknown): string | null {
  if (!(error instanceof DashboardHttpError)) return null;
  try {
    const body = JSON.parse(error.responseBody);
    return typeof body.code === "string" ? body.code : typeof body.message === "string" ? body.message : null;
  } catch { return null; }
}
export function reviewErrorMessage(error: unknown): string {
  const code = reviewErrorCode(error);
  if (code === "STRATEGY_VERSION_CONFLICT" || code === "STRATEGY_PROPOSAL_CONFLICT") return "A proposta mudou. Confira a versão atual antes de enviar sua decisão novamente.";
  if (code === "STRATEGY_DECISION_CONFLICT") return "Esta estratégia já recebeu uma decisão. Atualizamos o estado para você conferir.";
  if (code === "STRATEGY_PROPOSAL_EXPIRED") return "Esta proposta venceu. Aguarde uma nova análise da loja.";
  if (code === "STRATEGY_POLICY_CHANGED") return "Os limites da loja mudaram. Esta proposta precisa de uma nova análise.";
  if (code === "STRATEGY_REVISION_LIMIT_REACHED") return "O limite de alternativas deste ciclo foi atingido. Aguarde a próxima análise.";
  if (code === "STRATEGY_REVISIONS_UNAVAILABLE" || code === "STRATEGY_REVISION_LIMIT_REQUIRED") return "O pedido de alternativa está indisponível neste momento. Tente novamente mais tarde.";
  if (error instanceof DashboardHttpError && error.status === 403) return "Sua conta não tem acesso a esta estratégia. Confira a loja e as permissões de acesso.";
  if (error instanceof DashboardHttpError && error.status === 404) return "Estratégia não encontrada nesta loja. Volte à lista de sugestões.";
  return "Não foi possível confirmar a operação. Confira sua conexão e tente novamente.";
}
export function decisionMayHaveSucceeded(error: unknown) {
  return !(error instanceof DashboardHttpError) || error.status === 0 || error.status >= 500;
}
export function canReviewVersion(review: StrategyReview, version: StrategyVersion, now = Date.now()) {
  return review.status === "pending_review" && review.currentVersion === version.version
    && version.proposal.definition === "checkout-strategy-review-v1"
    && review.versions.some(v => v.version === version.version && v.proposalHash === version.proposalHash)
    && Number.isFinite(Date.parse(version.expiresAt)) && Number.isFinite(now);
}
export function versionExpired(review: StrategyReview, version: StrategyVersion) {
  return review.expired || Date.parse(version.expiresAt) <= Date.now();
}
export const formatReviewDate = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Data indisponível";
export const formatReviewNumber = (value: number) => Number.isFinite(value) ? value.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "Indisponível";
