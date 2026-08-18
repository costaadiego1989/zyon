/**
 * Pure mapper functions: payment domain → v1 API response shape.
 */
export class PaymentEntityMapper {
  static toPaymentIntentResponse(result: any) {
    return {
      intent_id: result.id ?? result.intentId,
      status: result.status,
      amount_cents: result.amountCents,
      currency: result.currency ?? 'BRL',
      method: result.method,
      provider_payment_id: result.providerPaymentId ?? null,
      client_secret: result.clientSecret ?? null,
      pix_qr_code: result.pixQrCode ?? null,
      pix_copy_paste: result.pixCopyPaste ?? null,
      crypto_address: result.cryptoAddress ?? null,
      created_at: result.createdAt?.toISOString?.() ?? result.createdAt ?? null,
    };
  }

  static toPaymentStatusResponse(result: any) {
    return {
      intent_id: result.intent_id,
      status: result.status,
      amount_cents: result.amount_cents,
      approved_amount_cents: result.approved_amount_cents ?? null,
      currency: result.currency ?? 'BRL',
      method: result.method,
      order_id: result.order_id ?? null,
      provider_payment_id: result.provider_payment_id ?? null,
      receipt_url: result.receipt_url ?? null,
    };
  }

  static toConfirmPaymentResponse(result: any) {
    return {
      intent_id: result.intent_id,
      status: result.status,
    };
  }
}
