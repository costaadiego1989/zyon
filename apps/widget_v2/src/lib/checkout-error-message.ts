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

export function checkoutPaymentErrorMessage(error: unknown): string {
  if (!(error instanceof CheckoutApiError)) {
    return "Não foi possível criar o pagamento. Tente novamente.";
  }

  const messages: Record<string, string> = {
    customer_registration_required: "Antes de gerar o pagamento, informe nome, e-mail, telefone e CPF.",
    shipping_method_required_before_payment: "Escolha o frete antes de gerar o pagamento.",
    payment_provider_not_configured: "Esta forma de pagamento ainda não está configurada pela loja. Escolha outra opção.",
    payment_provider_not_configured_for_customer_creation: "Esta forma de pagamento ainda não está configurada pela loja. Escolha outra opção.",
    asaas_connection_not_active: "A conexão de pagamento da loja está indisponível agora. Escolha outra opção ou tente mais tarde.",
    stripe_card_not_available: "O cartão não está disponível para esta loja agora. Escolha PIX ou tente novamente mais tarde.",
    stripe_connect_not_configured: "O cartão não está disponível para esta loja agora. Escolha PIX ou tente novamente mais tarde.",
    stripe_connect_not_active: "O cartão não está disponível para esta loja agora. Escolha PIX ou tente novamente mais tarde.",
    mercadopago_webhook_not_configured: "Esta forma de pagamento está em configuração. Escolha outra opção.",
    payment_creation_uncertain: "Não confirmamos a criação deste pagamento. Aguarde um instante antes de tentar novamente.",
    payment_provider_request_failed: "O provedor de pagamento não respondeu agora. Tente novamente em instantes.",
  };
  return error.code && messages[error.code]
    ? messages[error.code]
    : "Não foi possível criar o pagamento. Tente novamente.";
}
