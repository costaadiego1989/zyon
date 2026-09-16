import { CheckoutApiError } from "@/api/checkout-api-error";

export const MERCHANT_SALES_SUSPENDED_MESSAGE = "Esta loja está temporariamente indisponível para novos pedidos. Tente novamente mais tarde.";

export function isMerchantSalesSuspendedError(error: unknown): boolean {
  return error instanceof CheckoutApiError && error.code === "merchant_sales_suspended";
}

export function checkoutStartErrorMessage(error: unknown): string {
  if (isMerchantSalesSuspendedError(error)) return MERCHANT_SALES_SUSPENDED_MESSAGE;
  if (error instanceof CheckoutApiError) {
    const messages: Record<string, string> = {
      checkout_cart_expired: "Este carrinho expirou. Volte à loja para escolher seus produtos.",
      checkout_cart_items_required: "Seu carrinho está vazio. Volte à loja para adicionar produtos.",
      checkout_product_unavailable: "Um produto deste carrinho não está mais disponível. Volte à loja para revisar os itens.",
      checkout_insufficient_stock: "O estoque mudou. Volte à loja para ajustar a quantidade dos produtos.",
      checkout_product_options_changed: "As opções de um produto mudaram. Volte à loja para escolher novamente.",
      checkout_buyer_proof_required: "Entre com a conta usada nesta compra para continuar.",
    };
    if (error.code && messages[error.code]) return messages[error.code];
  }
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
