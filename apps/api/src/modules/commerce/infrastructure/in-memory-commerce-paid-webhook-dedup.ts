import { Injectable } from "@nestjs/common";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import type { CommercePaidWebhookDedupPort } from "../domain/ports/commerce-paid-webhook-dedup.port.js";

function dedupKey(merchantId: string, paymentReference: string): string {
  return `${merchantId.trim()}::${paymentReference.trim()}`;
}

@Injectable()
export class InMemoryCommercePaidWebhookDedup implements CommercePaidWebhookDedupPort {
  private readonly processed = new Set<string>();

  async isProcessed(merchantId: string, paymentReference: string): Promise<boolean> {
    return this.processed.has(dedupKey(merchantId, paymentReference));
  }

  /**
   * Atomically reserves the dedup slot. Returns true when this caller claimed
   * the slot (safe to proceed), false when another caller already holds it.
   * In-memory implementation: Set.has + Set.add is effectively atomic
   * (single-threaded JS event loop).
   */
  async tryReserve(merchantId: string, paymentReference: string): Promise<boolean> {
    const key = dedupKey(merchantId, paymentReference);
    if (this.processed.has(key)) return false;
    this.processed.add(key);
    return true;
  }

  async releaseReserve(merchantId: string, paymentReference: string): Promise<boolean> {
    const key = dedupKey(merchantId, paymentReference);
    if (!this.processed.has(key)) return false;
    this.processed.delete(key);
    return true;
  }

  async markProcessed(
    merchantId: string,
    paymentReference: string,
    _commerceOrderId?: string,
    _event?: DomainEventEnvelope
  ): Promise<void> {
    // Row was already reserved by tryReserve; this call updates the row in
    // durable impls (Prisma: sets commerceOrderId + appends event in same tx).
    this.processed.add(dedupKey(merchantId, paymentReference));
  }
}
