import { DashboardHttpError } from "../../api/http/error.js";

const messages: Record<string, string> = {
  billing_promotion_invalid: "Cupom inválido, indisponível ou fora da validade. Confira o código ou continue sem cupom.",
  billing_promotion_monthly_only: "Este cupom vale apenas para assinaturas mensais. Selecione Mensal para continuar.",
  billing_promotion_plan_not_allowed: "Este cupom não é válido para o plano escolhido. Escolha outro plano ou remova o cupom.",
  billing_promotions_unavailable: "Não foi possível validar o cupom agora. Tente novamente em instantes.",
  billing_subscription_exists_use_portal: "Você já tem uma assinatura. Use o gerenciamento da assinatura para alterar seu plano.",
};

export function billingCheckoutError(error: unknown, fallback: string): string {
  if (!(error instanceof DashboardHttpError)) return fallback;
  try {
    const problem = JSON.parse(error.responseBody);
    const code = problem.code ?? problem.message;
    return typeof code === "string" ? messages[code] ?? fallback : fallback;
  } catch { return fallback; }
}
