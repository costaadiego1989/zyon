import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { RedisModule } from "../../shared/cache/redis.module.js";
import { MessagingModule } from "../../shared/messaging/messaging.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { EXPERIMENT_REPOSITORY_PORT } from "./domain/ports/experiment-repository.port.js";
import { PrismaExperimentRepository } from "./infrastructure/repositories/prisma-experiment.repository.js";
import { ExperimentRouterService } from "./domain/services/experiment-router.service.js";
import { SignificanceCalculator } from "./domain/services/significance-calculator.service.js";
import { CreateExperimentUseCase } from "./application/use-cases/create-experiment.use-case.js";
import { GetExperimentUseCase } from "./application/use-cases/get-experiment.use-case.js";
import { ListExperimentsUseCase } from "./application/use-cases/list-experiments.use-case.js";
import { UpdateExperimentUseCase } from "./application/use-cases/update-experiment.use-case.js";
import { StartExperimentUseCase } from "./application/use-cases/start-experiment.use-case.js";
import { StopExperimentUseCase } from "./application/use-cases/stop-experiment.use-case.js";
import { ArchiveExperimentUseCase } from "./application/use-cases/archive-experiment.use-case.js";
import { AssignVariantToSessionUseCase } from "./application/use-cases/assign-variant-to-session.use-case.js";
import { RecordExperimentResultUseCase } from "./application/use-cases/record-experiment-result.use-case.js";
import { RecordFunnelEventUseCase } from "./application/use-cases/record-funnel-event.use-case.js";
import { GetExperimentResultsUseCase } from "./application/use-cases/get-experiment-results.use-case.js";
import { PromoteWinnerUseCase } from "./application/use-cases/promote-winner.use-case.js";
import { ExpireSessionsScheduler, ExpireSessionsWorker } from "./infrastructure/jobs/expire-sessions.job.js";
import { AutoPromoteScheduler, AutoPromoteWorker } from "./infrastructure/jobs/auto-promote.job.js";

@Module({
  imports: [PersistenceModule, RedisModule, MessagingModule, IntegrationsModule],
  providers: [
    SignificanceCalculator,
    ExperimentRouterService,
    {
      provide: EXPERIMENT_REPOSITORY_PORT,
      useFactory: (prisma: PrismaClient) => new PrismaExperimentRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    CreateExperimentUseCase,
    GetExperimentUseCase,
    ListExperimentsUseCase,
    UpdateExperimentUseCase,
    StartExperimentUseCase,
    StopExperimentUseCase,
    ArchiveExperimentUseCase,
    AssignVariantToSessionUseCase,
    RecordExperimentResultUseCase,
    RecordFunnelEventUseCase,
    GetExperimentResultsUseCase,
    PromoteWinnerUseCase,
    // Background jobs: expire sessions (1h) + auto-promote (6h)
    ExpireSessionsScheduler,
    ExpireSessionsWorker,
    AutoPromoteScheduler,
    AutoPromoteWorker,
  ],
  exports: [
    EXPERIMENT_REPOSITORY_PORT,
    ExperimentRouterService,
    SignificanceCalculator,
    CreateExperimentUseCase,
    GetExperimentUseCase,
    ListExperimentsUseCase,
    UpdateExperimentUseCase,
    StartExperimentUseCase,
    StopExperimentUseCase,
    ArchiveExperimentUseCase,
    AssignVariantToSessionUseCase,
    RecordExperimentResultUseCase,
    RecordFunnelEventUseCase,
    GetExperimentResultsUseCase,
    PromoteWinnerUseCase,
  ],
})
export class ExperimentsModule {}
