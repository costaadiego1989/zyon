import { Injectable } from "@nestjs/common";
import type { DomainEventEnvelope } from "@aacp/shared-types";
import type { PendingCommerceOrderIndexPort } from "../domain/ports/pending-commerce-order-index.port.js";

function keyOf(merchantId: string, sessionId: string): string {
  return `${merchantId.trim()}::${sessionId.trim()}`;
}

@Injectable()
export class InMemoryPendingCommerceOrderIndex implements PendingCommerceOrderIndexPort {
  private readonly rows = new Map<string, string>();

  async find(merchantId: string, sessionId: string): Promise<string | undefined> {
    return this.rows.get(keyOf(merchantId, sessionId));
  }

  async remember(
    merchantId: string,
    sessionId: string,
    commerceOrderId: string,
    _event?: DomainEventEnvelope
  ): Promise<void> {
    this.rows.set(keyOf(merchantId, sessionId), commerceOrderId.trim());
  }
}
