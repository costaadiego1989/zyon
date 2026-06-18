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
    {
      merchantId: string;
      cartFingerprint: string;
      globalUserId?: string;
      result: NegotiationResult;
      appliedAt?: string | null;
    }
  >();
  private ledger: Array<{
    merchantId: string;
    negotiationSessionId: string;
    eventType: string;
    amountCents: number;
    metadata?: Record<string, unknown>;
  }> = [];
  private offers = new Map<string, { offerId: string; checkoutSessionId: string }>();

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
      result: input.result,
      appliedAt: null
    });
    return { id };
  }

  /**
   * Atomically creates session + evaluated ledger entry (Bug 6 fix).
   */
  async createNegotiationSessionWithLedger(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ id: string }> {
    const { id } = await this.createNegotiationSession(input);
    this.ledger.push({
      merchantId: input.merchantId,
      negotiationSessionId: id,
      eventType: "negotiation.evaluated",
      amountCents: input.result.estimatedAiCostCents
    });
    return { id };
  }

  async getNegotiationSession(
    merchantId: string,
    negotiationSessionId: string
  ): Promise<{ cartFingerprint: string; result: NegotiationResult; appliedAt?: string | null } | null> {
    const row = this.sessions.get(negotiationSessionId);
    if (!row || row.merchantId !== merchantId) return null;
    return { cartFingerprint: row.cartFingerprint, result: row.result, appliedAt: row.appliedAt };
  }

  /**
   * Idempotent apply: returns existing offer if already applied (Bug 3+6+10 fix).
   * Records real discountPercent as amountCents in ledger.
   */
  async applyOfferWithLedger(input: {
    merchantId: string;
    negotiationSessionId: string;
    checkoutSessionId: string;
    discountPercent: number;
    offerData: Record<string, unknown>;
  }): Promise<{ alreadyApplied: boolean; offerId: string }> {
    const existing = this.offers.get(input.negotiationSessionId);
    if (existing) {
      return { alreadyApplied: true, offerId: existing.offerId };
    }

    const offerId = (input.offerData["id"] as string | undefined) ?? `off_${crypto.randomUUID()}`;
    this.offers.set(input.negotiationSessionId, { offerId, checkoutSessionId: input.checkoutSessionId });

    // Mark session as applied
    const session = this.sessions.get(input.negotiationSessionId);
    if (session) {
      session.appliedAt = new Date().toISOString();
    }

    this.ledger.push({
      merchantId: input.merchantId,
      negotiationSessionId: input.negotiationSessionId,
      eventType: "negotiation.offer_applied",
      // Store discountPercent * 100 as integer basis points for ledger observability (Bug 10 fix)
      amountCents: Math.round(input.discountPercent * 100),
      metadata: { discountPercent: input.discountPercent, checkoutSessionId: input.checkoutSessionId }
    });

    return { alreadyApplied: false, offerId };
  }

  async appendNegotiationLedgerEntry(input: {
    merchantId: string;
    negotiationSessionId: string;
    eventType: string;
    amountCents: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.ledger.push(input);
  }

  listLedger() {
    return [...this.ledger];
  }
}
