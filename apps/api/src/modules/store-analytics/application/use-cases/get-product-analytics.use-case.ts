import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  ANALYTICS_REPOSITORY_PORT,
  AnalyticsRepositoryPort,
} from "../../infrastructure/repositories/prisma-analytics.repository.js";

export interface ProductAnalytic {
  productId: string;
  productName: string;
  impressions: number;
  addToCartCount: number;
  purchaseCount: number;
  conversionRate: number; // purchases / impressions
  revenue: number;
}

export interface ProductAnalyticsResult {
  products: ProductAnalytic[];
  period: { from: Date; to: Date };
  totalProducts: number;
}

@Injectable()
export class GetProductAnalyticsUseCase {
  private readonly logger = new Logger(GetProductAnalyticsUseCase.name);

  constructor(@Inject(ANALYTICS_REPOSITORY_PORT) private readonly analyticsRepo: AnalyticsRepositoryPort) {}

  async execute(merchantId: string, from: Date, to: Date): Promise<ProductAnalyticsResult> {
    const products = await this.analyticsRepo.getProductAnalytics(merchantId, from, to);
    return {
      products,
      period: { from, to },
      totalProducts: products.length,
    };
  }
}
