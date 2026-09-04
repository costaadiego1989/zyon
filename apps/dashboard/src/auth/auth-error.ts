import { DashboardHttpError } from "../api-client.js";

/**
 * Maps an unknown auth error to a friendly, user-facing message.
 */
export function friendlyAuthError(error: unknown): string {
  const text =
    error instanceof DashboardHttpError
      ? error.responseBody
      : error instanceof Error
        ? error.message
        : String(error);
  if (text.includes("email_already_registered")) return "Este e-mail já está cadastrado.";
  if (text.includes("invalid_credentials")) return "E-mail ou senha inválidos.";
  if (text.includes("login_rate_limited")) return "Muitas tentativas. Tente novamente em alguns minutos.";
  return text.slice(0, 180) || "Não foi possível autenticar.";
}
