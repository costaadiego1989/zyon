import { CheckoutApiError } from "@/api/checkout-api-error";

export const MERCHANT_SALES_SUSPENDED_MESSAGE = "Esta loja está temporariamente indisponível para novos pedidos. Tente novamente mais tarde.";

export function isMerchantSalesSuspendedError(error: unknown): boolean {
  return error instanceof CheckoutApiError && error.code === "merchant_sales_suspended";
}

export function checkoutStartErrorMessage(error: unknown): string {
  if (isMerchantSalesSuspendedError(error)) return MERCHANT_SALES_SUSPENDED_MESSAGE;
  return "Não foi possível abrir o checkout agora. Tente novamente em instantes.";
}

export function checkoutChatErrorMessage(error: unknown): string | null {
  if (!(error instanceof CheckoutApiError)) return null;

  if (error.code === "ai_interaction_rate_limited" || error.code === "rate_limited") {
    const wait = error.retryAfterSeconds
      ? ` Aguarde ${error.retryAfterSeconds} segundo${error.retryAfterSeconds === 1 ? "" : "s"} e envie novamente.`
      : " Aguarde um instante e envie novamente.";
    return `Recebi muitas mensagens nesta conversa.${wait}`;
  }

  if (error.code === "ai_rate_limit_unavailable" || error.code === "rate_limit_unavailable") {
    return "Não consigo responder agora. Tente novamente em instantes.";
  }

  return null;
}
