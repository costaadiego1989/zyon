import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import {
  ANALYTICS_REPOSITORY_PORT,
  PrismaAnalyticsRepository,
} from "./infrastructure/repositories/prisma-analytics.repository.js";
import { GetDashboardMetricsUseCase } from "./application/use-cases/get-dashboard-metrics.use-case.js";
import { GetProductPerformanceUseCase } from "./application/use-cases/get-product-performance.use-case.js";
import { GetProductAnalyticsUseCase } from "./application/use-cases/get-product-analytics.use-case.js";
import { GetOfferRoiUseCase } from "./application/use-cases/get-offer-roi.use-case.js";
import { GetPaymentMetricsUseCase } from "./application/use-cases/get-payment-metrics.use-case.js";
import { GetCustomerMetricsUseCase } from "./application/use-cases/get-customer-metrics.use-case.js";
import { AggregateDailyMetricsUseCase } from "./application/use-cases/aggregate-daily-metrics.use-case.js";
import { MetricsAggregationScheduler, MetricsAggregationWorker } from "./infrastructure/jobs/metrics-aggregation.job.js";
import { AnalyticsController } from "./presentation/http/analytics.controller.js";
import { GA4MeasurementService } from "./infrastructure/ga4-measurement.service.js";

@Module({
  imports: [PersistenceModule],
  controllers: [AnalyticsController],
  providers: [
    {
      provide: ANALYTICS_REPOSITORY_PORT,
      useFactory: (prisma: PrismaClient) => new PrismaAnalyticsRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    GetDashboardMetricsUseCase,
    GetProductPerformanceUseCase,
    GetProductAnalyticsUseCase,
    GetOfferRoiUseCase,
    GetPaymentMetricsUseCase,
    GetCustomerMetricsUseCase,
    AggregateDailyMetricsUseCase,
    MetricsAggregationScheduler,
    MetricsAggregationWorker,
    GA4MeasurementService,
  ],
  exports: [
    GetDashboardMetricsUseCase,
    GetProductPerformanceUseCase,
    GetProductAnalyticsUseCase,
    GetOfferRoiUseCase,
    GetPaymentMetricsUseCase,
    GetCustomerMetricsUseCase,
    AggregateDailyMetricsUseCase,
    GA4MeasurementService,
  ],
})
export class StoreAnalyticsModule {}
