import type {
  BuyerNegotiationPreferences,
  MerchantNegotiationPolicy,
  NegotiationResult
} from "@aacp/negotiation-engine";
import type { NegotiationStore } from "../domain/ports/negotiation-store.port.js";

export class InMemoryNegotiationStore implements NegotiationStore {
  private merchantPolicies = new Map<string, MerchantNegotiationPolicy>();
  private buyerPrefs = new Map<string, BuyerNegotiationPreferences>();
  private sessions = new Map<
    string,
    { merchantId: string; cartFingerprint: string; globalUserId?: string; result: NegotiationResult }
  >();
  private ledger: Array<{
    merchantId: string;
    negotiationSessionId: string;
    eventType: string;
    amountCents: number;
  }> = [];

  async getMerchantPolicy(merchantId: string): Promise<MerchantNegotiationPolicy | null> {
    return this.merchantPolicies.get(merchantId) ?? null;
  }

  async upsertMerchantPolicy(merchantId: string, policy: MerchantNegotiationPolicy): Promise<void> {
    this.merchantPolicies.set(merchantId, policy);
  }

  prefsKey(merchantId: string, globalUserId: string) {
    return `${merchantId}:${globalUserId}`;
  }

  async getBuyerPreferences(
    merchantId: string,
    globalUserId: string
  ): Promise<BuyerNegotiationPreferences | null> {
    return this.buyerPrefs.get(this.prefsKey(merchantId, globalUserId)) ?? null;
  }

  async upsertBuyerPreferences(
    merchantId: string,
    globalUserId: string,
    prefs: BuyerNegotiationPreferences
  ): Promise<void> {
    this.buyerPrefs.set(this.prefsKey(merchantId, globalUserId), prefs);
  }

  async createNegotiationSession(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ id: string }> {
    const id = `ns_${crypto.randomUUID()}`;
    this.sessions.set(id, {
      merchantId: input.merchantId,
      globalUserId: input.globalUserId,
      cartFingerprint: input.cartFingerprint,
      result: input.result
    });
    return { id };
  }

  async getNegotiationSession(
    merchantId: string,
    negotiationSessionId: string
  ): Promise<{ cartFingerprint: string; result: NegotiationResult } | null> {
    const row = this.sessions.get(negotiationSessionId);
    if (!row || row.merchantId !== merchantId) return null;
    return { cartFingerprint: row.cartFingerprint, result: row.result };
  }

  async appendNegotiationLedgerEntry(input: {
    merchantId: string;
    negotiationSessionId: string;
    eventType: string;
    amountCents: number;
  }): Promise<void> {
    this.ledger.push(input);
  }

  listLedger() {
    return [...this.ledger];
  }
}
