import type { DomainEventEnvelope } from "@aacp/shared-types";
import type { PaymentIntentEntity } from "../payment-intent.entity.js";

export const PAYMENT_REPOSITORY = Symbol("PAYMENT_REPOSITORY");

export type SavePaymentIntentInput = {
  intent: PaymentIntentEntity;
};

export type PaymentProviderName = "asaas" | "stripe";

/** Identifies a provider webhook event for idempotent processing, scoped by tenant. */
export type ProviderEventKey = {
  provider: PaymentProviderName;
  /** Tenant boundary. `null` only when the intent (and thus merchant) is unknown. */
  merchantId: string | null;
  eventId: string;
};

export type StalePendingQuery = {
  /** Only intents not updated since this instant are candidates for reconciliation. */
  olderThan: Date;
  limit: number;
};

export interface PaymentRepository {
  saveIntent(input: SavePaymentIntentInput): Promise<void>;
  /**
   * Persists the intent and appends the domain event atomically. A partial
   * provider failure must never leave the intent saved without its event, nor
   * the event emitted without the intent.
   */
  saveIntentWithOutbox(input: SavePaymentIntentInput, event: DomainEventEnvelope): Promise<void>;
  getByIdempotency(
    merchantId: string,
    sessionId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentEntity | null>;
  getByProviderPaymentId(
    merchantId: string,
    providerPaymentId: string
  ): Promise<PaymentIntentEntity | null>;
  /** Identificador de negócio `pay_int_*` (enviado a Asaas como `externalReference`). */
  getIntentById(intentBusinessId: string): Promise<PaymentIntentEntity | null>;
  /** Open intents (pending/requires_action) eligible for authoritative-state reconciliation. */
  listStalePending(query: StalePendingQuery): Promise<PaymentIntentEntity[]>;
  hasProcessedProviderEvent(key: ProviderEventKey): Promise<boolean>;
  recordProcessedProviderEvent(key: ProviderEventKey): Promise<boolean>;
}
