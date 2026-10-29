import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";

export interface BuyerIntentProfileDto {
  has_consent: boolean;
  primary_intent?: string;
  category_focus?: string[];
  budget_tier?: string;
  conversion_likelihood?: number;
}

@Injectable()
export class GetBuyerIntentProfileUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(globalUserId: string, merchantId?: string): Promise<BuyerIntentProfileDto> {
    const now = new Date();

    // Consent gate: only return intent data if an active opted-in consent row exists
    // for this buyer. Scope to the JWT merchant when present, otherwise accept any
    // merchant consent for this buyer (buyer boundary).
    const consent = await (this.prisma as any).buyerIntentMemoryConsent.findFirst({
      where: {
        globalUserId,
        ...(merchantId ? { merchantId } : {}),
        optedIn: true,
        expiresAt: { gt: now },
      },
    });

    if (!consent) return { has_consent: false };

    // Latest intent record for the consented merchant + buyer.
    const record = await (this.prisma as any).customerIntentRecord.findFirst({
      where: { merchantId: consent.merchantId, globalUserId },
      orderBy: { generatedAt: "desc" },
    });

    if (!record) return { has_consent: true };

    return {
      has_consent: true,
      primary_intent: record.primaryIntent,
      category_focus: record.categoryFocus,
      budget_tier: record.budgetTier,
      conversion_likelihood: record.conversionLikelihoodPct,
    };
  }
}
