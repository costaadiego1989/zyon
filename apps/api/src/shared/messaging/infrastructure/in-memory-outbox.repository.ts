import { Injectable } from "@nestjs/common";
import type { DomainEventEnvelope } from "@aacp/shared-types";
import type { OutboxRepository } from "../ports/outbox.repository.port.js";

type OutboxStatus = "pending" | "delivered" | "failed";

@Injectable()
export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly outbox: DomainEventEnvelope[] = [];
  private readonly status = new Map<string, OutboxStatus>();
  private readonly retryCount = new Map<string, number>();

  appendOutbox(event: DomainEventEnvelope): DomainEventEnvelope {
    this.outbox.push(event);
    this.status.set(event.event_id, "pending");
    this.retryCount.set(event.event_id, 0);
    return event;
  }

  listOutbox(merchantId: string): DomainEventEnvelope[] {
    return this.outbox.filter((e) => e.merchant_id === merchantId);
  }

  listPending(batchSize = 50): DomainEventEnvelope[] {
    return this.outbox
      .filter((e) => this.status.get(e.event_id) === "pending")
      .slice(0, batchSize);
  }

  markDelivered(eventId: string): void {
    this.status.set(eventId, "delivered");
  }

  markFailed(eventId: string): void {
    const count = (this.retryCount.get(eventId) ?? 0) + 1;
    this.retryCount.set(eventId, count);
    if (count >= 3) {
      this.status.set(eventId, "failed");
    }
  }
}
