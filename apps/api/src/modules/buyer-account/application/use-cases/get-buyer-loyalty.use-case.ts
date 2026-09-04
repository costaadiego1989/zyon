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
    const [globalProfile, loyaltyTrackers, purchaseAgg] = await Promise.all([
      this.prisma.buyerGlobalProfile.findUnique({
        where: { globalUserId },
      }),
      this.prisma.buyerLoyaltyTracker.findMany({
        where: { buyerId: globalUserId },
      }),
      // Source of truth for completed purchases. The tracker/profile tables are
      // populated asynchronously and may be empty or keyed differently, so we
      // always aggregate the buyer's real purchase records as the fallback.
      this.prisma.buyerPurchaseRecord.aggregate({
        where: { globalUserId },
        _count: { _all: true },
        _sum: { totalAmount: true },
        _max: { completedAt: true },
      }),
    ]);

    // Aggregate loyalty data across all merchants from trackers (if present)
    let trackerOrders = 0;
    let trackerSpentCents = 0;
    let lastPurchaseAt: Date | null = null;

    for (const tracker of loyaltyTrackers) {
      trackerOrders += tracker.purchaseCount;
      trackerSpentCents += tracker.totalSpentCents;
      if (!lastPurchaseAt || (tracker.lastPurchaseAt && tracker.lastPurchaseAt > lastPurchaseAt)) {
        lastPurchaseAt = tracker.lastPurchaseAt;
      }
    }

    // Purchase-record aggregation (totalAmount is in currency units, not cents).
    const purchaseOrders = purchaseAgg._count._all ?? 0;
    const purchaseSpentCents = Math.round(Number(purchaseAgg._sum.totalAmount ?? 0) * 100);
    const purchaseLastAt = purchaseAgg._max.completedAt ?? null;

    // Prefer the richest available source: global profile → trackers → purchase records.
    const totalOrders = globalProfile?.totalOrders ?? (trackerOrders || purchaseOrders);
    const totalSpentCents = trackerSpentCents || purchaseSpentCents;
    const avgOrderValueCents =
      globalProfile?.avgOrderValueCents ??
      (totalOrders > 0 ? Math.round(totalSpentCents / totalOrders) : 0);

    return {
      totalOrders,
      totalSpentCents,
      avgOrderValueCents,
      topCategories: globalProfile?.topCategories ?? [],
      preferredBrands: globalProfile?.preferredBrands ?? [],
      discountSensitivity: globalProfile?.discountSensitivity ?? "unknown",
      lastPurchaseAt: globalProfile?.lastPurchaseAt ?? lastPurchaseAt ?? purchaseLastAt,
    };
  }
}
