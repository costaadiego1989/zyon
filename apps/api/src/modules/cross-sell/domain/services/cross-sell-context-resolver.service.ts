import { Injectable, Optional, Inject } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../../../shared/persistence/persistence.module.js';
import type { PrismaClient } from '@prisma/client';

export interface CrossSellContext {
  source:
    | 'global_profile'
    | 'merchant_history'
    | 'cart_similarity'
    | 'top_sellers';
  topCategories: string[];
  recentSkus: string[];
  preferredBrands: string[];
}

@Injectable()
export class CrossSellContextResolverService {
  constructor(
    @Optional()
    @Inject(PRISMA_CLIENT)
    private readonly prisma?: PrismaClient,
  ) {}

  async resolve(
    globalUserId: string,
    merchantId: string,
    cartCategories: string[],
  ): Promise<CrossSellContext> {
    // Level 1: Global profile (cross-merchant)
    if (this.prisma) {
      try {
        const global = await (this.prisma as any).buyerGlobalProfile.findUnique({
          where: { globalUserId },
        });
        if (global && global.totalOrders > 0) {
          return {
            source: 'global_profile',
            topCategories: global.topCategories,
            recentSkus: global.recentSkus,
            preferredBrands: global.preferredBrands,
          };
        }
      } catch {}
    }

    // Level 2: Per-merchant history (via existing BuyerPurchaseRecord)
    if (this.prisma) {
      try {
        const records = await (this.prisma as any).buyerPurchaseRecord.findMany({
          where: { merchantId, globalUserId },
          orderBy: { completedAt: 'desc' },
          take: 10,
        });
        if (records.length > 0) {
          const categories: string[] = Array.from(new Set(
              records.map((r: any) => r.category as string).filter(Boolean),
          ));
          const skus = records
            .map((r: any) => r.sku)
            .filter(Boolean)
            .slice(0, 5);
          return {
            source: 'merchant_history',
            topCategories: categories,
            recentSkus: skus,
            preferredBrands: [],
          };
        }
      } catch {}
    }

    // Level 3: Cart-based similarity
    if (cartCategories.length > 0) {
      return {
        source: 'cart_similarity',
        topCategories: cartCategories,
        recentSkus: [],
        preferredBrands: [],
      };
    }

    // Level 4: Top sellers fallback
    return {
      source: 'top_sellers',
      topCategories: [],
      recentSkus: [],
      preferredBrands: [],
    };
  }
}
