import { Injectable } from "@nestjs/common";
import type { DomainEventEnvelope } from "@aacp/shared-types";
import type {
  OutboxClaim,
  OutboxRepository,
  OutboxStatus,
  OutboxTransaction,
  TransactionalOutbox
} from "../ports/outbox.repository.port.js";

interface OutboxRecord {
  envelope: DomainEventEnvelope;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
}

@Injectable()
export class InMemoryOutboxRepository implements OutboxRepository, TransactionalOutbox {
  private readonly records = new Map<string, OutboxRecord>();
  private readonly order: string[] = [];
  private readonly processedHandlers = new Set<string>();

  appendOutbox(event: DomainEventEnvelope): DomainEventEnvelope {
    if (!this.records.has(event.event_id)) {
      this.records.set(event.event_id, {
        envelope: event,
        status: "pending",
        attempts: 0,
        nextAttemptAt: 0
      });
      this.order.push(event.event_id);
    }
    return event;
  }

  listOutbox(merchantId: string): DomainEventEnvelope[] {
    return this.orderedRecords()
      .filter((r) => r.envelope.merchant_id === merchantId)
      .map((r) => r.envelope);
  }

  listPending(batchSize = 50): DomainEventEnvelope[] {
    return this.claimBatch(batchSize).map((c) => c.envelope);
  }

  claimBatch(batchSize = 50): OutboxClaim[] {
    const now = Date.now();
    return this.orderedRecords()
      .filter((r) => r.status === "pending" && r.nextAttemptAt <= now)
      .slice(0, batchSize)
      .map((r) => ({ envelope: r.envelope, attempts: r.attempts }));
  }

  markDelivered(eventId: string): void {
    const record = this.records.get(eventId);
    if (record) record.status = "delivered";
  }

  markFailed(eventId: string, error?: string): void {
    const record = this.records.get(eventId);
    if (!record) return;
    record.status = "failed";
    record.lastError = error;
  }

  recordFailure(
    eventId: string,
    error: string,
    backoff: { maxAttempts: number; nextAttemptAt: Date }
  ): { attempts: number; dead: boolean } {
    const record = this.records.get(eventId);
    if (!record) return { attempts: 0, dead: false };
    record.attempts += 1;
    record.lastError = error;
    const dead = record.attempts >= backoff.maxAttempts;
    record.status = dead ? "dead" : "pending";
    record.nextAttemptAt = dead ? 0 : backoff.nextAttemptAt.getTime();
    return { attempts: record.attempts, dead };
  }

  isProcessed(eventId: string): boolean {
    return this.records.get(eventId)?.status === "delivered";
  }

  isHandlerProcessed(eventId: string, handlerId: string): boolean {
    return this.processedHandlers.has(handlerKey(eventId, handlerId));
  }

  markHandlerProcessed(eventId: string, handlerId: string): void {
    this.processedHandlers.add(handlerKey(eventId, handlerId));
  }

  async saveWithOutbox<T>(
    work: (tx: OutboxTransaction) => Promise<T>
  ): Promise<T> {
    return work({
      appendOutbox: async (event) => this.appendOutbox(event)
    });
  }

  private orderedRecords(): OutboxRecord[] {
    return this.order
      .map((id) => this.records.get(id))
      .filter((r): r is OutboxRecord => r !== undefined);
  }
}

function handlerKey(eventId: string, handlerId: string): string {
  return `${eventId}::${handlerId}`;
}
