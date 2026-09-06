import type { DomainEventEnvelope } from "@zyon/shared-types";

export const OUTBOX_REPOSITORY = Symbol("OUTBOX_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export type OutboxStatus = "pending" | "processing" | "delivered" | "failed" | "dead";

export const OUTBOX_LEASE_MS = 120_000;
export const OUTBOX_MAX_ATTEMPTS = 5;

export interface OutboxClaim {
  readonly envelope: DomainEventEnvelope;
  readonly attempts: number;
}

export interface LeasedOutboxClaim extends OutboxClaim {
  /** Attempts includes this acquisition; every retry/crash consumes an attempt. */
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
}

export interface OutboxFailureOutcome {
  readonly attempts: number;
  readonly dead: boolean;
}

/** Dispatcher contract. Legacy producer adapters are not allowed to drive delivery. */
export interface LeasedOutboxRepository extends OutboxRepository {
  claimBatch(batchSize?: number): MaybePromise<LeasedOutboxClaim[]>;
  renewClaim(claim: LeasedOutboxClaim): MaybePromise<boolean>;
  completeClaim(claim: LeasedOutboxClaim): MaybePromise<boolean>;
  completeHandler(claim: LeasedOutboxClaim, handlerId: string): MaybePromise<boolean>;
  failClaim(claim: LeasedOutboxClaim, errorCode: string, nextAttemptAt: Date): MaybePromise<OutboxFailureOutcome | null>;
  /** Only for claims the dispatcher has not handed to any handler. */
  releaseUnstartedClaim(claim: LeasedOutboxClaim): MaybePromise<boolean>;
  getBacklog(): MaybePromise<{ pending: number; processing: number; dead: number; oldestPendingAt: Date | null }>;
}

export interface OutboxRepository {
  appendOutbox(event: DomainEventEnvelope): MaybePromise<DomainEventEnvelope>;
  listOutbox(merchantId: string): MaybePromise<DomainEventEnvelope[]>;
  listPending(batchSize?: number): MaybePromise<DomainEventEnvelope[]>;
  markDelivered(eventId: string): MaybePromise<void>;
  markFailed(eventId: string, error?: string): MaybePromise<void>;

  /**
   * Legacy adapter surface. The dispatcher requires LeasedOutboxRepository;
   * only its claim tokens authorize completion and failure writes.
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
