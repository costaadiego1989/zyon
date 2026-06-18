import type { DomainEventEnvelope } from "@aacp/shared-types";

/**
 * Evita aplicar `markOrderPaid` duas vezes para o mesmo evento de pagamento
 * (ex.: webhook Asaas reenviado com o mesmo `paymentReference`).
 */
export interface CommercePaidWebhookDedupPort {
  isProcessed(merchantId: string, paymentReference: string): Promise<boolean>;

  /**
   * Atomically inserts a dedup row for the given payment reference BEFORE
   * calling the provider. Returns `true` if the row was successfully reserved
   * (this caller owns the processing), or `false` if another concurrent caller
   * already holds the row (unique-constraint conflict → already processed).
   *
   * This is the preferred entry-point: call it first, and only invoke the
   * provider when it returns `true`. Afterwards call `markProcessed` with the
   * resolved `commerceOrderId` and domain event.
   */
  tryReserve(merchantId: string, paymentReference: string): Promise<boolean>;

  /**
   * Updates the dedup row with the resolved commerce order id and appends the
   * domain event to the outbox in the SAME transaction (atomically).
   * Safe to call after `tryReserve` returned `true`; idempotent on re-call
   * (P2002 is swallowed).
   */
  markProcessed(
    merchantId: string,
    paymentReference: string,
    commerceOrderId?: string,
    event?: DomainEventEnvelope
  ): Promise<void>;
}

export const COMMERCE_PAID_WEBHOOK_DEDUP = Symbol("COMMERCE_PAID_WEBHOOK_DEDUP");
