export type InterventionLedgerMaybePromise<T> = T | Promise<T>;

export const CHECKOUT_INTERVENTION_LEDGER = Symbol("CHECKOUT_INTERVENTION_LEDGER");

export type InterventionRecordedReason = "agent_trigger_allowed";

export interface CheckoutInterventionLedgerPort {
  countForSession(
    merchantId: string,
    sessionId: string
  ): InterventionLedgerMaybePromise<number>;

  lastOccurredAt(
    merchantId: string,
    sessionId: string
  ): InterventionLedgerMaybePromise<number | null>;

  record(input: {
    merchantId: string;
    sessionId: string;
    occurredAtUnix: number;
    reason: InterventionRecordedReason;
  }): InterventionLedgerMaybePromise<void>;
}
