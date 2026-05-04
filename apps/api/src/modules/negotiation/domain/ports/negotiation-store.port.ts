import type {
  BuyerNegotiationPreferences,
  MerchantNegotiationPolicy,
  NegotiationResult
} from "@aacp/negotiation-engine";

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
  } | null>;

  appendNegotiationLedgerEntry(input: {
    merchantId: string;
    negotiationSessionId: string;
    eventType: string;
    amountCents: number;
  }): Promise<void>;
}
