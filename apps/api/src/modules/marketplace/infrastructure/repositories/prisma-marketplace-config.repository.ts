import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type {
  MarketplaceConfigRepository,
  MarketplaceConfigSnapshot,
  UpsertMarketplaceConfigInput,
} from "../../domain/ports/marketplace-config-repository.port.js";

@Injectable()
export class PrismaMarketplaceConfigRepository
  implements MarketplaceConfigRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async get(merchantId: string): Promise<MarketplaceConfigSnapshot | undefined> {
    const config = await this.prisma.marketplaceConfig.findUnique({
      where: { merchantId },
    });
    if (!config) return undefined;
    return this.toSnapshot(config);
  }

  async upsert(
    input: UpsertMarketplaceConfigInput,
  ): Promise<MarketplaceConfigSnapshot> {
    const config = await this.prisma.marketplaceConfig.upsert({
      where: { merchantId: input.merchantId },
      update: {
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.commissionRateBps !== undefined && {
          commissionRateBps: input.commissionRateBps,
        }),
        ...(input.returnWindowDays !== undefined && {
          returnWindowDays: input.returnWindowDays,
        }),
        ...(input.payoutDelayDays !== undefined && {
          payoutDelayDays: input.payoutDelayDays,
        }),
        ...(input.chargebackWindowDays !== undefined && {
          chargebackWindowDays: input.chargebackWindowDays,
        }),
        ...(input.allowedCategories !== undefined && {
          allowedCategories: input.allowedCategories,
        }),
        ...(input.blockedMerchants !== undefined && {
          blockedMerchants: input.blockedMerchants,
        }),
      },
      create: {
        merchantId: input.merchantId,
        enabled: input.enabled ?? false,
        commissionRateBps: input.commissionRateBps ?? 1500,
        returnWindowDays: input.returnWindowDays ?? 7,
        payoutDelayDays: input.payoutDelayDays ?? 14,
        chargebackWindowDays: input.chargebackWindowDays ?? 30,
        allowedCategories: input.allowedCategories ?? [],
        blockedMerchants: input.blockedMerchants ?? [],
      },
    });
    return this.toSnapshot(config);
  }

  private toSnapshot(config: any): MarketplaceConfigSnapshot {
    return {
      id: config.id,
      merchantId: config.merchantId,
      enabled: config.enabled,
      commissionRateBps: config.commissionRateBps,
      returnWindowDays: config.returnWindowDays,
      payoutDelayDays: config.payoutDelayDays,
      chargebackWindowDays: config.chargebackWindowDays,
      allowedCategories: config.allowedCategories,
      blockedMerchants: config.blockedMerchants,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}
