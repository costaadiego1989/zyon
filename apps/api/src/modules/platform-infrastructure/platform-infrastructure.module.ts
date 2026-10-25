import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { HealthModule } from "../../shared/health/health.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { GetPlatformInfrastructureReadinessUseCase } from "./application/get-platform-infrastructure-readiness.use-case.js";
import { PLATFORM_INFRASTRUCTURE_AUDIT_REPOSITORY } from "./domain/ports/platform-infrastructure-audit-repository.port.js";
import {
  PLATFORM_INFRASTRUCTURE_INTEGRATIONS_REPOSITORY,
  PLATFORM_INFRASTRUCTURE_QUEUE_PROBE,
} from "./domain/ports/platform-infrastructure-observability.port.js";
import { BullMqPlatformQueueProbe } from "./infrastructure/bullmq-platform-queue-probe.js";
import { PrismaPlatformInfrastructureAuditRepository } from "./infrastructure/prisma-platform-infrastructure-audit.repository.js";
import { PrismaPlatformInfrastructureIntegrationsRepository } from "./infrastructure/prisma-platform-infrastructure-integrations.repository.js";
import { PlatformInfrastructureController } from "./presentation/platform-infrastructure.controller.js";

@Module({
  imports: [HealthModule, PlatformControlModule],
  controllers: [PlatformInfrastructureController],
  providers: [
    GetPlatformInfrastructureReadinessUseCase,
    {
      provide: PLATFORM_INFRASTRUCTURE_AUDIT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformInfrastructureAuditRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_INFRASTRUCTURE_QUEUE_PROBE,
      useFactory: () => new BullMqPlatformQueueProbe(),
    },
    {
      provide: PLATFORM_INFRASTRUCTURE_INTEGRATIONS_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformInfrastructureIntegrationsRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
})
export class PlatformInfrastructureModule {}
