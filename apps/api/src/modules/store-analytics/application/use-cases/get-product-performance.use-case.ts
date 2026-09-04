import { Injectable, Inject , Logger} from "@nestjs/common";
import {
  ANALYTICS_REPOSITORY_PORT,
  AnalyticsRepositoryPort,
  ProductMetricRow,
} from "../../infrastructure/repositories/prisma-analytics.repository.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GetProductPerformanceUseCase {
  private readonly logger = new Logger(GetProductPerformanceUseCase.name);

  constructor(@Inject(ANALYTICS_REPOSITORY_PORT) private readonly analyticsRepo: AnalyticsRepositoryPort) {}

  async execute(merchantId: string, monthStr?: string): Promise<{ products: ProductMetricRow[] }> {
    const month = monthStr ? new Date(`${monthStr}-01`) : this.currentMonth();
    const products = await this.analyticsRepo.getProductMetrics(merchantId, month);
    return { products };
  }

  private currentMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
