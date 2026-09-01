import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { INTENT_MEMORY_REPOSITORY, BUYER_INTENT_CONSENT_REPOSITORY } from "./domain/ports/intent-memory-repository.port.js";
import { InMemoryIntentMemoryRepository } from "./infrastructure/repositories/in-memory-intent-memory.repository.js";
import { InMemoryBuyerIntentConsentRepository } from "./infrastructure/repositories/in-memory-buyer-intent-consent.repository.js";
import { PrismaIntentMemoryRepository } from "./infrastructure/repositories/prisma-intent-memory.repository.js";
import { PrismaBuyerIntentConsentRepository } from "./infrastructure/repositories/prisma-buyer-intent-consent.repository.js";
import { ClassifyCustomerIntentUseCase, RecordIntentIfConsentedUseCase } from "./application/use-cases/classify-customer-intent.use-case.js";
import { IntentModulatedCapService } from "./application/services/intent-modulated-cap.service.js";
import { IntentMemoryController } from "./presentation/http/intent-memory.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

/**
 * IntentMemoryModule — LGPD-compliant buyer intent classification and memory.
 *
 * Consent gating: intent is recorded ONLY when buyer has active consent.
 * Integration point: StartCheckoutUseCase loads intent into agentContext for conversation personalization.
 *
 * Persistence: Uses Prisma-backed repositories for production.
 * In-memory test doubles exist as files for unit testing.
 */
@Module({
  controllers: [IntentMemoryController],
  providers: [
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: INTENT_MEMORY_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaIntentMemoryRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: BUYER_INTENT_CONSENT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerIntentConsentRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    ClassifyCustomerIntentUseCase,
    RecordIntentIfConsentedUseCase,
    IntentModulatedCapService,
  ],
  exports: [
    INTENT_MEMORY_REPOSITORY,
    BUYER_INTENT_CONSENT_REPOSITORY,
    ClassifyCustomerIntentUseCase,
    RecordIntentIfConsentedUseCase,
    IntentModulatedCapService,
  ]
})
export class IntentMemoryModule {}
