import { Module, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";
import { RedisModule } from "../../shared/cache/redis.module.js";
import { MessagingModule } from "../../shared/messaging/messaging.module.js";
import { ExperimentsModule } from "../experiments/experiments.module.js";

// Ports
import { OBSERVATION_REPOSITORY_PORT } from "./domain/ports/observation-repository.port.js";
import { HYPOTHESIS_REPOSITORY_PORT } from "./domain/ports/hypothesis-repository.port.js";
import { STRATEGY_LESSON_REPOSITORY_PORT } from "./domain/ports/strategy-lesson-repository.port.js";
import { HYPOTHESIS_GENERATOR_PORT } from "./domain/ports/hypothesis-generator.port.js";

// Repositories
import { PrismaObservationRepository } from "./infrastructure/prisma-observation.repository.js";
import { PrismaHypothesisRepository } from "./infrastructure/prisma-hypothesis.repository.js";
import { PrismaStrategyLessonRepository } from "./infrastructure/prisma-strategy-lesson.repository.js";

// Adapters
import { LLMHypothesisGenerator } from "./infrastructure/hypothesis-generator.adapter.js";

// Use Cases
import { ApproveHypothesisUseCase } from "./application/use-cases/approve-hypothesis.use-case.js";
import { RejectHypothesisUseCase } from "./application/use-cases/reject-hypothesis.use-case.js";
import { RecordStrategyLessonUseCase } from "./application/use-cases/record-strategy-lesson.use-case.js";
import { ObserveMetricsUseCase } from "./application/use-cases/observe-metrics.use-case.js";
import { GenerateHypothesisUseCase } from "./application/use-cases/generate-hypothesis.use-case.js";
import { CreateExperimentFromHypothesisUseCase } from "./application/use-cases/create-experiment-from-hypothesis.use-case.js";

// Workers
import { StrategyFeedbackWorker } from "./infrastructure/workers/strategy-feedback.worker.js";
import { DailyObservationScheduler, DailyObservationWorker } from "./infrastructure/jobs/daily-observation.job.js";

// Controllers
import { RevenueManagerController } from "./presentation/http/revenue-manager.controller.js";

@Module({
  imports: [PersistenceModule, RedisModule, MessagingModule, ExperimentsModule],
  controllers: [RevenueManagerController],
  providers: [
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: OBSERVATION_REPOSITORY_PORT,
      useFactory: (prisma: PrismaClient) => new PrismaObservationRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: HYPOTHESIS_REPOSITORY_PORT,
      useFactory: (prisma: PrismaClient) => new PrismaHypothesisRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: STRATEGY_LESSON_REPOSITORY_PORT,
      useFactory: (prisma: PrismaClient) => new PrismaStrategyLessonRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    // Hypothesis generator port — LLM-backed adapter
    {
      provide: HYPOTHESIS_GENERATOR_PORT,
      useClass: LLMHypothesisGenerator,
    },
    ApproveHypothesisUseCase,
    RejectHypothesisUseCase,
    RecordStrategyLessonUseCase,
    ObserveMetricsUseCase,
    GenerateHypothesisUseCase,
    CreateExperimentFromHypothesisUseCase,
    StrategyFeedbackWorker,
    DailyObservationScheduler,
    DailyObservationWorker,
  ],
  exports: [
    OBSERVATION_REPOSITORY_PORT,
    HYPOTHESIS_REPOSITORY_PORT,
    STRATEGY_LESSON_REPOSITORY_PORT,
    ApproveHypothesisUseCase,
    RejectHypothesisUseCase,
    RecordStrategyLessonUseCase,
    ObserveMetricsUseCase,
    GenerateHypothesisUseCase,
    CreateExperimentFromHypothesisUseCase,
    DailyObservationWorker,
  ],
})
export class RevenueManagerModule implements OnModuleInit {
  constructor(
    private readonly dailyObservationScheduler: DailyObservationScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    // Register recurring daily observation job on boot
    await this.dailyObservationScheduler.ensureRecurringJob();
  }
}
