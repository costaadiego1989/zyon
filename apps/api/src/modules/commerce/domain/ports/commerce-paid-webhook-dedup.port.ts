import type { DomainEventEnvelope } from "@aacp/shared-types";

/**
 * Evita aplicar `markOrderPaid` duas vezes para o mesmo evento de pagamento
 * (ex.: webhook Asaas reenviado com o mesmo `paymentReference`).
 */
export interface CommercePaidWebhookDedupPort {
  isProcessed(merchantId: string, paymentReference: string): Promise<boolean>;
  /**
   * Records the processed payment reference. When `event` is provided, the
   * durable repo appends it to the outbox in the SAME transaction as the
   * dedup row (aggregate write + outbox emit atomic).
   */
  markProcessed(
    merchantId: string,
    paymentReference: string,
    commerceOrderId?: string,
    event?: DomainEventEnvelope
  ): Promise<void>;
}

export const COMMERCE_PAID_WEBHOOK_DEDUP = Symbol("COMMERCE_PAID_WEBHOOK_DEDUP");
