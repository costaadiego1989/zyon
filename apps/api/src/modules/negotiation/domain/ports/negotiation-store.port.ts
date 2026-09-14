import type {
  BuyerNegotiationPreferences,
  MerchantNegotiationPolicy,
  NegotiationResult
} from "@zyon/negotiation-engine";
import type { AuthorizedOffer } from "@zyon/shared-types";

export const NEGOTIATION_STORE = Symbol("NEGOTIATION_STORE");

export interface NegotiationStore {
  getMerchantPolicy(merchantId: string): Promise<MerchantNegotiationPolicy | null>;
  upsertMerchantPolicy(merchantId: string, policy: MerchantNegotiationPolicy): Promise<void>;

  getBuyerPreferences(merchantId: string, globalUserId: string): Promise<BuyerNegotiationPreferences | null>;
  upsertBuyerPreferences(
    merchantId: string,
    globalUserId: string,
    prefs: BuyerNegotiationPreferences
  ): Promise<void>;

  /**
   * Atomically creates a negotiation session AND appends the initial
   * negotiation.evaluated ledger entry. Bug 6 fix.
   */
  createNegotiationSessionWithLedger(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ id: string }>;

  createNegotiationSession(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ id: string }>;

  getNegotiationSession(
    merchantId: string,
    negotiationSessionId: string
  ): Promise<{
    cartFingerprint: string;
    result: NegotiationResult;
    /** The immutable checkout offer stored when this negotiation was applied. */
    appliedOffer?: AuthorizedOffer | null;
    /** ISO timestamp set when an offer was applied; null/undefined if not yet applied. */
    appliedAt?: string | null;
  } | null>;

  /**
   * Atomically marks the session as applied, saves the authorized offer, and
   * appends negotiation.offer_applied ledger entry with real discountPercent.
   * Returns existing offer data when already applied (idempotency). Bug 3+6+10 fix.
   */
  applyOfferWithLedger(input: {
    merchantId: string;
    negotiationSessionId: string;
    checkoutSessionId: string;
    discountPercent: number;
    offer: AuthorizedOffer;
  }): Promise<{ alreadyApplied: boolean; offer: AuthorizedOffer }>;

  appendNegotiationLedgerEntry(input: {
    merchantId: string;
    negotiationSessionId: string;
    eventType: string;
    amountCents: number;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
