import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";
import type { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import type { BuyerAgentProfile } from "../../domain/entities/buyer-agent-profile.entity.js";

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

@Injectable()
export class GetBuyerSummaryUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  async execute(globalUserId: string): Promise<BuyerSummary> {
    const [profile, agent] = await Promise.all([
      this.repo.findByGlobalUserId(globalUserId),
      this.repo.findAgentByGlobalUserId(globalUserId),
    ]);
    if (!profile) throw new NotFoundException("buyer_account_not_found");

    const records = await this.prisma.buyerPurchaseRecord.findMany({
      where: { globalUserId },
      select: { merchantId: true, totalAmount: true, discountAmount: true },
    });

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

    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: topMerchantIds } },
      select: { id: true, name: true },
    });
    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));

    const topMerchants = topMerchantIds.map((id) => ({
      merchantId: id,
      merchantName: merchantMap.get(id) ?? id,
      orderCount: countByMerchant.get(id) ?? 0,
    }));

    return { profile, agent, stats: { totalOrders, totalSpent, totalSaved, topMerchants } };
  }
}
