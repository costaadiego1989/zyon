import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  ANALYTICS_REPOSITORY_PORT,
  AnalyticsRepositoryPort,
} from "../../infrastructure/repositories/prisma-analytics.repository.js";

export interface CustomerMetricsResult {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  repeatRate: number;
  period: { from: Date; to: Date };
}

@Injectable()
export class GetCustomerMetricsUseCase {
  private readonly logger = new Logger(GetCustomerMetricsUseCase.name);

  constructor(@Inject(ANALYTICS_REPOSITORY_PORT) private readonly analyticsRepo: AnalyticsRepositoryPort) {}

  async execute(merchantId: string, from: Date, to: Date): Promise<CustomerMetricsResult> {
    return this.analyticsRepo.getCustomerMetrics(merchantId, from, to);
  }
}
