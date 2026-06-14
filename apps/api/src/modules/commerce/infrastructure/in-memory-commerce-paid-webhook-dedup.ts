import { Injectable } from "@nestjs/common";
import type { DomainEventEnvelope } from "@aacp/shared-types";
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

  async markProcessed(
    merchantId: string,
    paymentReference: string,
    _commerceOrderId?: string,
    _event?: DomainEventEnvelope
  ): Promise<void> {
    this.processed.add(dedupKey(merchantId, paymentReference));
  }
}
