import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import {
  OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS,
  type LeasedOutboxClaim, type LeasedOutboxRepository, type OutboxFailureOutcome,
  type OutboxStatus, type OutboxTransaction, type TransactionalOutbox,
} from "../ports/outbox.repository.port.js";

interface OutboxRecord {
  envelope: DomainEventEnvelope;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
  leaseToken?: string;
  leaseExpiresAt?: number;
  createdAt: number;
}

@Injectable()
export class InMemoryOutboxRepository implements LeasedOutboxRepository, TransactionalOutbox {
  private readonly records = new Map<string, OutboxRecord>();
  private readonly order: string[] = [];
  private readonly processedHandlers = new Set<string>();

  protected now(): number { return Date.now(); }

  appendOutbox(event: DomainEventEnvelope): DomainEventEnvelope {
    if (!this.records.has(event.event_id)) {
      this.records.set(event.event_id, { envelope: structuredClone(event), status: "pending", attempts: 0, nextAttemptAt: 0, createdAt: this.now() });
      this.order.push(event.event_id);
    }
    return event;
  }

  listOutbox(merchantId: string): DomainEventEnvelope[] {
    return this.orderedRecords().filter((r) => r.envelope.merchant_id === merchantId).map((r) => structuredClone(r.envelope));
  }

  listPending(batchSize = 50): DomainEventEnvelope[] {
    this.validateBatchSize(batchSize);
    return this.orderedRecords().filter((r) => r.status === "pending" && r.nextAttemptAt <= this.now())
      .slice(0, batchSize).map((r) => structuredClone(r.envelope));
  }

  claimBatch(batchSize = 50): LeasedOutboxClaim[] {
    this.validateBatchSize(batchSize);
    const claims: LeasedOutboxClaim[] = [];
    for (const record of this.orderedRecords()) {
      const expired = record.status === "processing" && (record.leaseExpiresAt ?? 0) <= this.now();
      if (record.attempts >= OUTBOX_MAX_ATTEMPTS && (record.status === "pending" || expired)) {
        record.status = "dead";
        record.leaseToken = undefined;
        record.leaseExpiresAt = undefined;
        record.lastError = "outbox_attempts_exhausted";
      }
      if (claims.length === batchSize || record.attempts >= OUTBOX_MAX_ATTEMPTS) continue;
      if (!(expired || record.status === "pending" && record.nextAttemptAt <= this.now())) continue;
      record.status = "processing";
      record.attempts++;
      record.leaseToken = randomUUID();
      record.leaseExpiresAt = this.now() + OUTBOX_LEASE_MS;
      claims.push({ envelope: structuredClone(record.envelope), attempts: record.attempts,
        leaseToken: record.leaseToken, leaseExpiresAt: new Date(record.leaseExpiresAt) });
    }
    return claims;
  }

  renewClaim(claim: LeasedOutboxClaim): boolean {
    const record = this.owned(claim);
    if (!record) return false;
    record.leaseExpiresAt = this.now() + OUTBOX_LEASE_MS;
    return true;
  }

  releaseUnstartedClaim(claim: LeasedOutboxClaim): boolean {
    const record = this.owned(claim);
    if (!record) return false;
    record.status = "pending";
    record.attempts = Math.max(0, record.attempts - 1);
    record.leaseToken = undefined;
    record.leaseExpiresAt = undefined;
    return true;
  }

  getBacklog(): { pending: number; processing: number; dead: number; oldestPendingAt: Date | null } {
    const records = this.orderedRecords();
    const pending = records.filter((row) => row.status === "pending");
    return { pending: pending.length, processing: records.filter((row) => row.status === "processing").length,
      dead: records.filter((row) => row.status === "dead").length,
      oldestPendingAt: pending.length ? new Date(Math.min(...pending.map((row) => row.createdAt))) : null };
  }

  completeClaim(claim: LeasedOutboxClaim): boolean {
    const record = this.owned(claim);
    if (!record) return false;
    record.status = "delivered";
    record.leaseToken = undefined;
    record.leaseExpiresAt = undefined;
    record.lastError = undefined;
    return true;
  }

  completeHandler(claim: LeasedOutboxClaim, handlerId: string): boolean {
    if (!this.owned(claim)) return false;
    this.processedHandlers.add(handlerKey(claim.envelope.event_id, handlerId));
    return true;
  }

  failClaim(claim: LeasedOutboxClaim, errorCode: string, nextAttemptAt: Date): OutboxFailureOutcome | null {
    const record = this.owned(claim);
    if (!record) return null;
    const dead = record.attempts >= OUTBOX_MAX_ATTEMPTS;
    record.status = dead ? "dead" : "pending";
    record.lastError = errorCode;
    record.nextAttemptAt = dead ? 0 : nextAttemptAt.getTime();
    record.leaseToken = undefined;
    record.leaseExpiresAt = undefined;
    return { attempts: record.attempts, dead };
  }

  isProcessed(eventId: string): boolean { return this.records.get(eventId)?.status === "delivered"; }
  isHandlerProcessed(eventId: string, handlerId: string): boolean {
    return this.processedHandlers.has(handlerKey(eventId, handlerId));
  }

  markDelivered(_eventId: string): void { throw new Error("outbox_claim_required"); }
  markFailed(_eventId: string, _error?: string): void { throw new Error("outbox_claim_required"); }
  markHandlerProcessed(_eventId: string, _handlerId: string): void { throw new Error("outbox_claim_required"); }
  recordFailure(_eventId: string, _error: string, _backoff: { maxAttempts: number; nextAttemptAt: Date }): OutboxFailureOutcome {
    throw new Error("outbox_claim_required");
  }

  async saveWithOutbox<T>(work: (tx: OutboxTransaction) => Promise<T>): Promise<T> {
    const staged: DomainEventEnvelope[] = [];
    const result = await work({ appendOutbox: async (event) => { staged.push(structuredClone(event)); return event; } });
    for (const event of staged) this.appendOutbox(event);
    return result;
  }

  private owned(claim: LeasedOutboxClaim): OutboxRecord | null {
    const record = this.records.get(claim.envelope.event_id);
    return record?.status === "processing" && record.leaseToken === claim.leaseToken
      && (record.leaseExpiresAt ?? 0) > this.now() ? record : null;
  }

  private orderedRecords(): OutboxRecord[] {
    return this.order.map((id) => this.records.get(id)).filter((r): r is OutboxRecord => r !== undefined);
  }

  private validateBatchSize(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw new Error("outbox_batch_size_invalid");
  }
}

function handlerKey(eventId: string, handlerId: string): string { return JSON.stringify([eventId, handlerId]); }
