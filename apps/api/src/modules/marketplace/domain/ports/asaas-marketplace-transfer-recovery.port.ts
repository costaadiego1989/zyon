import type { MarketplaceCaptureEvidence } from "./marketplace-capture-provider.port.js";

/** A new, seller-authorized return transfer. Asaas does not document a native
 * reversal of an already completed wallet payout. This request must never be
 * cast to a Stripe transfer_reversal or used as a buyer-refund receipt. */
export interface AsaasMarketplaceWalletReturnRequest {
  version: 1 | 2;
  kind: "authorized_wallet_return";
  provider: "asaas";
  environment: "test" | "live";
  paymentMethod: "pix" | "card";
  currency: "BRL";
  fundingPlanId: string;
  refundPlanId: string;
  returnId: string;
  instructionsHash: string;
  allocationHash: string;
  host: { merchantId: string; accountFingerprint: string; walletId: string };
  seller: { merchantId: string; accountFingerprint: string; walletId: string };
  capture: MarketplaceCaptureEvidence;
  originalPayout: {
    id: string;
    providerTransferId: string;
    reference: string;
    amountCents: number;
    dateCreated: string;
  };
  /** V2 identifies a completed outbound residual operation, never the host's
   * accounting retention or the already returned original payout. */
  residual?: AsaasMarketplaceResidualWalletReturnSource;
  /** V1 returns the whole original payout. Partial and residual histories need
   * a separate conservation journal before they can be admitted. */
  amountCents: number;
  authorization: { id: string; sellerMerchantId: string; actorId: string; authorizedAt: string };
  reference: string;
  requestHash: string;
}

export interface AsaasMarketplaceResidualWalletReturnSource {
  planId: string;
  operationId: string;
  generation: 1;
  version: 5 | 7;
  basisHash: string;
  allocationHash: string;
  outboundRequestHash: string;
  previousRefunds: Array<{ providerOperationId: string; amountCents: number }>;
  hostRetainedCents: number;
  platformRetainedCents: number;
  refundedCents: number;
}

export interface AsaasMarketplaceWalletReturnAuthorizationRecord {
  requestHash: string;
  authorizationId: string;
  state: "claimed" | "submitted" | "returned";
  providerTransferId?: string;
  /** Independently committed buyer refunds of this exact capture. Historical
   * wallet proof may survive these DONE receipts; this grants no new POST. */
  confirmedRefunds?: Array<{ providerOperationId: string; amountCents: number }>;
}

export interface AsaasMarketplaceWalletReturnSubmissionPermit {
  requestHash: string;
  authorizationId: string;
  state: "submission_authorized";
}

/** Implementations must authenticate the seller principal, freeze the whole
 * request, and reserve this original payout exactly once. Consumption is an
 * atomic, durable one-use transition BEFORE POST. Its uncertain completion is
 * not permission to retry. A request hash supplied by a caller is not consent. */
export interface AsaasMarketplaceWalletReturnAuthorizationReader {
  read(requestHash: string): Promise<AsaasMarketplaceWalletReturnAuthorizationRecord | undefined>;
  consumeSubmissionAuthorization(requestHash: string): Promise<AsaasMarketplaceWalletReturnSubmissionPermit | undefined>;
}

export interface AsaasMarketplaceWalletReturnLedgerReceipt {
  id: string;
  transferId: string;
  type: "INTERNAL_TRANSFER_DEBIT" | "INTERNAL_TRANSFER_CREDIT";
  amountCents: number;
  date: string;
}

export interface AsaasMarketplaceWalletReturnProof {
  version: 1;
  kind: "authorized_wallet_return";
  /** This association is our immutable instruction, not a provider-native
   * link from the new transfer to the original payout. */
  association: "local_immutable_authorization";
  requestHash: string;
  authorizationId: string;
  reference: string;
  originalProviderTransferId: string;
  providerTransferId: string;
  hostAccountFingerprint: string;
  sellerAccountFingerprint: string;
  hostWalletId: string;
  sellerWalletId: string;
  amountCents: number;
  observedAt: string;
  originalHostDebit: AsaasMarketplaceWalletReturnLedgerReceipt;
  originalSellerCredit: AsaasMarketplaceWalletReturnLedgerReceipt;
  sellerReturnDebit: AsaasMarketplaceWalletReturnLedgerReceipt;
  hostReturnCredit: AsaasMarketplaceWalletReturnLedgerReceipt;
}

export type AsaasMarketplaceWalletReturnObservation =
  | { state: "returned"; providerTransferId: string; amountCents: number; observedAt: string; proof: AsaasMarketplaceWalletReturnProof }
  | { state: "pending" | "failed"; providerTransferId: string; amountCents: number; observedAt: string }
  | { state: "unknown" };
export type AsaasMarketplaceWalletReturnSubmission = Exclude<AsaasMarketplaceWalletReturnObservation, { state: "returned" }>
  | { state: "not_submitted" };

export interface AsaasMarketplaceWalletReturnProvider {
  submit(input: AsaasMarketplaceWalletReturnRequest): Promise<AsaasMarketplaceWalletReturnSubmission>;
  /** GET-only proof. Returned funds alone neither refund the buyer nor release
   * a debt/fee/chargeback hold. The accounting journal remains responsible. */
  reconcile(input: AsaasMarketplaceWalletReturnRequest, providerTransferId?: string): Promise<AsaasMarketplaceWalletReturnObservation>;
}
