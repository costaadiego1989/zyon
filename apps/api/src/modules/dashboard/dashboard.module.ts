import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { DashboardController } from "./presentation/http/dashboard.controller.js";
import { GetNavCountsUseCase } from "./application/get-nav-counts.use-case.js";
import { MarkBadgeViewedUseCase } from "./application/mark-badge-viewed.use-case.js";

/**
 * DashboardModule — dashboard-specific read endpoints (nav badge counts, etc).
 * PRISMA_CLIENT and AuthGuard are provided by @Global() modules.
 */
@Module({
  controllers: [DashboardController],
  providers: [
    {
      provide: GetNavCountsUseCase,
      useFactory: (prisma: PrismaClient) => new GetNavCountsUseCase(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: MarkBadgeViewedUseCase,
      useFactory: (prisma: PrismaClient) => new MarkBadgeViewedUseCase(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
})
export class DashboardModule {}
