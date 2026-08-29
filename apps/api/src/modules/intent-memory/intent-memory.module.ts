import { Module } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { INTENT_MEMORY_REPOSITORY, BUYER_INTENT_CONSENT_REPOSITORY } from "./domain/ports/intent-memory-repository.port.js";
import { InMemoryIntentMemoryRepository } from "./infrastructure/repositories/in-memory-intent-memory.repository.js";
import { InMemoryBuyerIntentConsentRepository } from "./infrastructure/repositories/in-memory-buyer-intent-consent.repository.js";
import { ClassifyCustomerIntentUseCase, RecordIntentIfConsentedUseCase } from "./application/use-cases/classify-customer-intent.use-case.js";
import { IntentMemoryController } from "./presentation/http/intent-memory.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

/**
 * IntentMemoryModule — LGPD-compliant buyer intent classification and memory.
 *
 * Consent gating: intent is recorded ONLY when buyer has active consent.
 * Integration point: StartCheckoutUseCase loads intent into agentContext for conversation personalization.
 */
@Module({
  controllers: [IntentMemoryController],
  providers: [
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: INTENT_MEMORY_REPOSITORY,
      // TODO: Replace with PrismaIntentMemoryRepository when table is migrated
      useFactory: () => new InMemoryIntentMemoryRepository(),
    },
    {
      provide: BUYER_INTENT_CONSENT_REPOSITORY,
      // TODO: Replace with PrismaBuyerIntentConsentRepository when table is migrated
      useFactory: () => new InMemoryBuyerIntentConsentRepository(),
    },
    ClassifyCustomerIntentUseCase,
    RecordIntentIfConsentedUseCase,
  ],
  exports: [
    INTENT_MEMORY_REPOSITORY,
    BUYER_INTENT_CONSENT_REPOSITORY,
    ClassifyCustomerIntentUseCase,
    RecordIntentIfConsentedUseCase,
  ]
})
export class IntentMemoryModule {}
