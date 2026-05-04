/**
 * Evita aplicar `markOrderPaid` duas vezes para o mesmo evento de pagamento
 * (ex.: webhook Asaas reenviado com o mesmo `paymentReference`).
 */
export interface CommercePaidWebhookDedupPort {
  isProcessed(merchantId: string, paymentReference: string): Promise<boolean>;
  markProcessed(merchantId: string, paymentReference: string): Promise<void>;
}

export const COMMERCE_PAID_WEBHOOK_DEDUP = Symbol("COMMERCE_PAID_WEBHOOK_DEDUP");
