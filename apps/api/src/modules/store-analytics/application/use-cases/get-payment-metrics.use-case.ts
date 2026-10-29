import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  ANALYTICS_REPOSITORY_PORT,
  AnalyticsRepositoryPort,
} from "../../infrastructure/repositories/prisma-analytics.repository.js";

export interface PaymentMetricByProvider {
  provider: string;
  attempts: number;
  successful: number;
  failed: number;
  failureRate: number;
}

export interface PaymentMetricsResult {
  totalAttempts: number;
  successful: number;
  failed: number;
  failureRate: number;
  byProvider: PaymentMetricByProvider[];
  period: { from: Date; to: Date };
}

@Injectable()
export class GetPaymentMetricsUseCase {
  private readonly logger = new Logger(GetPaymentMetricsUseCase.name);

  constructor(@Inject(ANALYTICS_REPOSITORY_PORT) private readonly analyticsRepo: AnalyticsRepositoryPort) {}

  async execute(merchantId: string, from: Date, to: Date): Promise<PaymentMetricsResult> {
    return this.analyticsRepo.getPaymentMetrics(merchantId, from, to);
  }
}
