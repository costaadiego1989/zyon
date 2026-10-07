export type PaymentCancellationResponse = { version: 1; intent_id: string; status: string; cancellation: "cancelled" | "pending" | "unsupported" | "not_pending"; reason?: string };

/** Financial side effect is routed only from an explicit buyer command. */
export function paymentCancellationCommand(text: string): "pix" | "payment" | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (/^cancelar (?:o )?pix$/.test(normalized)) return "pix";
  if (/^cancelar (?:o )?pagamento$/.test(normalized)) return "payment";
  return null;
}

export function paymentCancellationMessage(result: PaymentCancellationResponse): string {
  if (result.cancellation === "cancelled" && result.status === "cancelled") return "Pagamento pendente cancelado. Seu carrinho foi mantido.";
  if (result.cancellation === "unsupported") return "Não consigo cancelar esta cobrança por aqui. A confirmação do provedor ainda é necessária; não gere outro pagamento enquanto isso.";
  if (result.cancellation === "not_pending") return "Este pagamento já saiu do estado pendente e não foi cancelado. Vou continuar acompanhando a confirmação.";
  return "O cancelamento ainda não foi confirmado pelo provedor. Seu carrinho foi mantido. Envie “cancelar pagamento” novamente para consultar a mesma operação.";
}

export function parsePaymentCancellation(value: unknown, intentId: string): PaymentCancellationResponse {
  const result = value as PaymentCancellationResponse | null;
  if (!result || result.version !== 1 || result.intent_id !== intentId ||
      !["pending", "requires_action", "cancelled", "approved", "failed", "refunded", "chargeback_pending", "chargeback_disputed", "chargeback_lost", "chargeback_won"].includes(result.status) ||
      !["cancelled", "pending", "unsupported", "not_pending"].includes(result.cancellation) ||
      result.cancellation === "cancelled" && result.status !== "cancelled" ||
      result.cancellation === "pending" && !["pending", "requires_action"].includes(result.status)) throw new Error("payment_cancellation_response_invalid");
  return { version: 1, intent_id: intentId, status: result.status, cancellation: result.cancellation };
}
