import { Injectable } from "@nestjs/common";
import type { DomainEventEnvelope } from "@aacp/shared-types";
import type { OutboxRepository } from "../ports/outbox.repository.port.js";

@Injectable()
export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly outbox: DomainEventEnvelope[] = [];

  appendOutbox(event: DomainEventEnvelope): DomainEventEnvelope {
    this.outbox.push(event);
    return event;
  }

  listOutbox(merchantId: string): DomainEventEnvelope[] {
    return this.outbox.filter((e) => e.merchant_id === merchantId);
  }
}
