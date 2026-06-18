import type { DomainEventEnvelope } from "@aacp/shared-types";

export const OUTBOX_REPOSITORY = Symbol("OUTBOX_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export type OutboxStatus = "pending" | "delivered" | "failed" | "dead";

export interface OutboxClaim {
  readonly envelope: DomainEventEnvelope;
  readonly attempts: number;
}

export interface OutboxRepository {
  appendOutbox(event: DomainEventEnvelope): MaybePromise<DomainEventEnvelope>;
  listOutbox(merchantId: string): MaybePromise<DomainEventEnvelope[]>;
  listPending(batchSize?: number): MaybePromise<DomainEventEnvelope[]>;
  markDelivered(eventId: string): MaybePromise<void>;
  markFailed(eventId: string, error?: string): MaybePromise<void>;

  /**
   * Returns events whose retry window has elapsed, oldest-first, for the
   * dispatcher to drive retries with backoff.
   */
  claimBatch(batchSize?: number): MaybePromise<OutboxClaim[]>;

  /**
   * Records a failed delivery: increments attempts, stores the error, then
   * either schedules the next attempt (pending) or moves the event to the
   * DLQ (dead) once attempts reach maxAttempts.
   */
  recordFailure(
    eventId: string,
    error: string,
    backoff: { maxAttempts: number; nextAttemptAt: Date }
  ): MaybePromise<{ attempts: number; dead: boolean }>;

  isProcessed(eventId: string): MaybePromise<boolean>;
  isHandlerProcessed(eventId: string, handlerId: string): MaybePromise<boolean>;
  markHandlerProcessed(eventId: string, handlerId: string): MaybePromise<void>;
}

export interface TransactionalOutbox {
  saveWithOutbox<T>(
    work: (tx: OutboxTransaction) => Promise<T>
  ): Promise<T>;
}

export interface OutboxTransaction {
  appendOutbox(event: DomainEventEnvelope): Promise<DomainEventEnvelope>;
}
