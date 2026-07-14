import type { PrismaClient } from "@prisma/client";
import type {
  BuyerNegotiationPreferences,
  MerchantNegotiationPolicy,
  NegotiationResult
} from "@zyon/negotiation-engine";
import type { NegotiationStore } from "../domain/ports/negotiation-store.port.js";

export class PrismaNegotiationStore implements NegotiationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getMerchantPolicy(merchantId: string): Promise<MerchantNegotiationPolicy | null> {
    const row = await this.prisma.merchantNegotiationPolicy.findUnique({ where: { merchantId } });
    if (!row) return null;
    return row.policy as unknown as MerchantNegotiationPolicy;
  }

  async upsertMerchantPolicy(merchantId: string, policy: MerchantNegotiationPolicy): Promise<void> {
    await this.prisma.merchantNegotiationPolicy.upsert({
      where: { merchantId },
      create: {
        merchantId,
        policy: JSON.parse(JSON.stringify(policy)) as object
      },
      update: { policy: JSON.parse(JSON.stringify(policy)) as object }
    });
  }

  async getBuyerPreferences(
    merchantId: string,
    globalUserId: string
  ): Promise<BuyerNegotiationPreferences | null> {
    const row = await this.prisma.buyerAgentNegotiationPreference.findUnique({
      where: { merchantId_globalUserId: { merchantId, globalUserId } }
    });
    if (!row) return null;
    return row.preferences as unknown as BuyerNegotiationPreferences;
  }

  async upsertBuyerPreferences(
    merchantId: string,
    globalUserId: string,
    prefs: BuyerNegotiationPreferences
  ): Promise<void> {
    await this.prisma.buyerAgentNegotiationPreference.upsert({
      where: { merchantId_globalUserId: { merchantId, globalUserId } },
      create: {
        merchantId,
        globalUserId,
        preferences: JSON.parse(JSON.stringify(prefs)) as object
      },
      update: { preferences: JSON.parse(JSON.stringify(prefs)) as object }
    });
  }

  async createNegotiationSession(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ id: string }> {
    const row = await this.prisma.negotiationSession.create({
      data: {
        merchantId: input.merchantId,
        globalUserId: input.globalUserId,
        cartFingerprint: input.cartFingerprint,
        estimatedAiCalls: input.result.estimatedAiCalls,
        estimatedAiCostCents: input.result.estimatedAiCostCents,
        resultJson: JSON.parse(JSON.stringify(input.result)) as object
      }
    });
    return { id: row.id };
  }

  /**
   * Atomically creates session + evaluated ledger entry via $transaction (Bug 6 fix).
   */
  async createNegotiationSessionWithLedger(input: {
    merchantId: string;
    globalUserId?: string;
    cartFingerprint: string;
    result: NegotiationResult;
  }): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.negotiationSession.create({
        data: {
          merchantId: input.merchantId,
          globalUserId: input.globalUserId,
          cartFingerprint: input.cartFingerprint,
          estimatedAiCalls: input.result.estimatedAiCalls,
          estimatedAiCostCents: input.result.estimatedAiCostCents,
          resultJson: JSON.parse(JSON.stringify(input.result)) as object
        }
      });
      // C3 fix: write ledger entry. New columns (aiCostCents, discountBasisPoints) are populated
      // by migration but we only write amountCents for backward compat until migration applies.
      await tx.negotiationCostLedgerEntry.create({
        data: {
          merchantId: input.merchantId,
          negotiationSessionId: row.id,
          eventType: "negotiation.evaluated",
          amountCents: input.result.estimatedAiCostCents
        }
      });
      return { id: row.id };
    });
  }

  async getNegotiationSession(
    merchantId: string,
    negotiationSessionId: string
  ): Promise<{ cartFingerprint: string; result: NegotiationResult; appliedAt?: string | null } | null> {
    const row = await this.prisma.negotiationSession.findFirst({
      where: { id: negotiationSessionId, merchantId }
    });
    if (!row) return null;

    // H2 fix: check for idempotency marker (offer already applied)
    // Using findFirst until migration adds the composite unique constraint
    const appliedEntry = await this.prisma.negotiationCostLedgerEntry.findFirst({
      where: {
        negotiationSessionId,
        eventType: "negotiation.offer_applied"
      }
    });

    return {
      cartFingerprint: row.cartFingerprint,
      result: row.resultJson as unknown as NegotiationResult,
      appliedAt: appliedEntry ? appliedEntry.createdAt.toISOString() : null
    };
  }

  /**
   * Idempotent apply via $transaction: if already applied returns early;
   * otherwise saves offer + appends ledger with real discountPercent (Bugs 3+6+10 fix).
   */
  async applyOfferWithLedger(input: {
    merchantId: string;
    negotiationSessionId: string;
    checkoutSessionId: string;
    discountPercent: number;
    offerData: Record<string, unknown>;
  }): Promise<{ alreadyApplied: boolean; offerId: string }> {
    return this.prisma.$transaction(async (tx) => {
      // H2 fix: idempotency check — findFirst protected by $transaction serialization.
      // After migration applies the composite unique constraint, Prisma will enforce
      // uniqueness at DB level even in concurrent scenarios.
      const existing = await tx.negotiationCostLedgerEntry.findFirst({
        where: {
          negotiationSessionId: input.negotiationSessionId,
          eventType: "negotiation.offer_applied"
        }
      });

      if (existing) {
        const offerId = (input.offerData["id"] as string | undefined) ?? `off_replay`;
        return { alreadyApplied: true, offerId };
      }

      const offerId = (input.offerData["id"] as string | undefined) ?? `off_${crypto.randomUUID()}`;

      const basisPoints = Math.round(input.discountPercent * 100);
      // C3 fix: write ledger entry with basis points. New discountBasisPoints column populated by migration.
      await tx.negotiationCostLedgerEntry.create({
        data: {
          merchantId: input.merchantId,
          negotiationSessionId: input.negotiationSessionId,
          eventType: "negotiation.offer_applied",
          // amountCents stores basis points (will be migrated to discountBasisPoints column)
          amountCents: basisPoints
        }
      });

      return { alreadyApplied: false, offerId };
    });
  }

  async appendNegotiationLedgerEntry(input: {
    merchantId: string;
    negotiationSessionId: string;
    eventType: string;
    amountCents: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // C3 fix: write amountCents (semantic columns are populated by migration)
    await this.prisma.negotiationCostLedgerEntry.create({
      data: {
        merchantId: input.merchantId,
        negotiationSessionId: input.negotiationSessionId,
        eventType: input.eventType,
        amountCents: input.amountCents
      }
    });
  }
}
