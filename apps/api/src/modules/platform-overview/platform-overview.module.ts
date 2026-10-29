import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { HealthModule } from "../../shared/health/health.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { GetPlatformMetricsUseCase } from "./application/get-platform-metrics.use-case.js";
import { GetPlatformOverviewUseCase } from "./application/get-platform-overview.use-case.js";
import { PLATFORM_METRICS_REPOSITORY } from "./domain/ports/platform-metrics-repository.port.js";
import { PLATFORM_OVERVIEW_REPOSITORY } from "./domain/ports/platform-overview-repository.port.js";
import { PrismaPlatformMetricsRepository } from "./infrastructure/prisma-platform-metrics.repository.js";
import { PrismaPlatformOverviewRepository } from "./infrastructure/prisma-platform-overview.repository.js";
import { PlatformOverviewController } from "./presentation/platform-overview.controller.js";

@Module({
  imports: [HealthModule, PlatformControlModule],
  controllers: [PlatformOverviewController],
  providers: [
    GetPlatformOverviewUseCase,
    GetPlatformMetricsUseCase,
    {
      provide: PLATFORM_OVERVIEW_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformOverviewRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_METRICS_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformMetricsRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
})
export class PlatformOverviewModule {}
