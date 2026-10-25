/**
 * Provider operation that releases a merchant's already-held balance.  This
 * is deliberately separate from payment creation: a successful charge never
 * proves that a later merchant transfer has happened.
 */
export const PAYMENT_PAYOUT_PROVIDER = Symbol("PAYMENT_PAYOUT_PROVIDER");

export type AsaasInternalPayoutInput = {
  payoutDestination: string;
  amountCents: number;
  payoutReference: string;
};

export type AsaasInternalPayoutSubmission = {
  providerTransferId: string;
  /** Creation is never a financial confirmation; wait for TRANSFER_DONE. */
  state: "submitted" | "failed";
  failureCode?: string;
};

export interface PaymentPayoutProviderPort {
  submitAsaasInternalPayout(input: AsaasInternalPayoutInput): Promise<AsaasInternalPayoutSubmission>;
}

/**
 * HTTP errors are definitive because the PSP returned a response before it
 * created a transfer. Network and timeout failures intentionally remain
 * unresolved: retrying blindly could pay a merchant twice.
 */
export class PayoutSubmissionError extends Error {
  constructor(message: string, readonly definitive: boolean) {
    super(message);
    this.name = "PayoutSubmissionError";
  }
}
