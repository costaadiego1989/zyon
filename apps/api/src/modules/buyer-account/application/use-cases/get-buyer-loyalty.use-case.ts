import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";

export interface BuyerLoyaltyData {
  totalOrders: number;
  totalSpentCents: number;
  avgOrderValueCents: number;
  topCategories: string[];
  preferredBrands: string[];
  discountSensitivity: string;
  lastPurchaseAt: Date | null;
}

@Injectable()
export class GetBuyerLoyaltyUseCase {
  private readonly logger = new Logger(GetBuyerLoyaltyUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  async execute(globalUserId: string): Promise<BuyerLoyaltyData> {
    const [globalProfile, loyaltyTrackers] = await Promise.all([
      this.prisma.buyerGlobalProfile.findUnique({
        where: { globalUserId },
      }),
      this.prisma.buyerLoyaltyTracker.findMany({
        where: { buyerId: globalUserId },
      }),
    ]);

    // Aggregate loyalty data across all merchants
    let totalOrders = 0;
    let totalSpentCents = 0;
    let lastPurchaseAt: Date | null = null;

    for (const tracker of loyaltyTrackers) {
      totalOrders += tracker.purchaseCount;
      totalSpentCents += tracker.totalSpentCents;
      if (!lastPurchaseAt || (tracker.lastPurchaseAt && tracker.lastPurchaseAt > lastPurchaseAt)) {
        lastPurchaseAt = tracker.lastPurchaseAt;
      }
    }

    const avgOrderValueCents = totalOrders > 0 ? Math.round(totalSpentCents / totalOrders) : 0;

    // Use global profile data if available, otherwise return zeros/empty
    return {
      totalOrders: globalProfile?.totalOrders ?? totalOrders,
      totalSpentCents,
      avgOrderValueCents: globalProfile?.avgOrderValueCents ?? avgOrderValueCents,
      topCategories: globalProfile?.topCategories ?? [],
      preferredBrands: globalProfile?.preferredBrands ?? [],
      discountSensitivity: globalProfile?.discountSensitivity ?? "unknown",
      lastPurchaseAt: globalProfile?.lastPurchaseAt ?? lastPurchaseAt,
    };
  }
}
