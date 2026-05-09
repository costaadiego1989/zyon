import type { DomainEventEnvelope } from "@aacp/shared-types";

export const OUTBOX_REPOSITORY = Symbol("OUTBOX_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface OutboxRepository {
  appendOutbox(event: DomainEventEnvelope): MaybePromise<DomainEventEnvelope>;
  listOutbox(merchantId: string): MaybePromise<DomainEventEnvelope[]>;
}
