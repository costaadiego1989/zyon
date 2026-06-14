import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";
import type { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import type { BuyerAgentProfile } from "../../domain/entities/buyer-agent-profile.entity.js";
import {
  BUYER_PURCHASE_HISTORY_REPOSITORY,
  type BuyerPurchaseHistoryRepository,
} from "../../../buyer-purchase-history/domain/ports/buyer-purchase-history-repository.port.js";
import type { PurchaseRecord } from "../../../buyer-purchase-history/domain/buyer-purchase-history.types.js";
import { usesPrismaPurchaseHistory } from "../../../buyer-purchase-history/infrastructure/purchase-history-storage-mode.js";

export interface BuyerSummary {
  profile: BuyerAccount;
  agent: BuyerAgentProfile | null;
  stats: {
    totalOrders: number;
    totalSpent: number;
    totalSaved: number;
    topMerchants: { merchantId: string; merchantName: string; orderCount: number }[];
  };
}

type PurchaseStat = Pick<PurchaseRecord, "merchantId" | "totalAmount" | "discountAmount">;

@Injectable()
export class GetBuyerSummaryUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional()
    @Inject(BUYER_PURCHASE_HISTORY_REPOSITORY)
    private readonly purchaseHistory?: BuyerPurchaseHistoryRepository,
  ) {}

  async execute(globalUserId: string): Promise<BuyerSummary> {
    const [profile, agent] = await Promise.all([
      this.repo.findByGlobalUserId(globalUserId),
      this.repo.findAgentByGlobalUserId(globalUserId),
    ]);
    if (!profile) throw new NotFoundException("buyer_account_not_found");

    const records = usesPrismaPurchaseHistory()
      ? await this.loadRecordsFromPrisma(globalUserId)
      : await this.loadRecordsFromRepository(globalUserId);

    const totalOrders = records.length;
    const totalSpent = records.reduce((s, r) => s + r.totalAmount, 0);
    const totalSaved = records.reduce((s, r) => s + r.discountAmount, 0);

    const countByMerchant = new Map<string, number>();
    for (const r of records) {
      countByMerchant.set(r.merchantId, (countByMerchant.get(r.merchantId) ?? 0) + 1);
    }

    const topMerchantIds = [...countByMerchant.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const merchantMap = usesPrismaPurchaseHistory()
      ? new Map(
          (
            await this.prisma.merchant.findMany({
              where: { id: { in: topMerchantIds } },
              select: { id: true, name: true },
            })
          ).map((m) => [m.id, m.name] as const),
        )
      : new Map<string, string>();

    const topMerchants = topMerchantIds.map((id) => ({
      merchantId: id,
      merchantName: merchantMap.get(id) ?? id,
      orderCount: countByMerchant.get(id) ?? 0,
    }));

    return { profile, agent, stats: { totalOrders, totalSpent, totalSaved, topMerchants } };
  }

  private async loadRecordsFromPrisma(globalUserId: string): Promise<PurchaseStat[]> {
    return this.prisma.buyerPurchaseRecord.findMany({
      where: { globalUserId },
      select: { merchantId: true, totalAmount: true, discountAmount: true },
    });
  }

  private async loadRecordsFromRepository(globalUserId: string): Promise<PurchaseStat[]> {
    const repo = this.purchaseHistory as BuyerPurchaseHistoryRepository & {
      listPurchasesForGlobalUser?: (id: string) => Promise<PurchaseRecord[]>;
    };
    if (!repo || typeof repo.listPurchasesForGlobalUser !== "function") return [];
    const purchases = await repo.listPurchasesForGlobalUser(globalUserId);
    return purchases.map((purchase) => ({
      merchantId: purchase.merchantId,
      totalAmount: purchase.totalAmount,
      discountAmount: purchase.discountAmount,
    }));
  }
}
