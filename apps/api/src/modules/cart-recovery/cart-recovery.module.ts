import { Module, forwardRef } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { RecoveryScannerJob } from "./infrastructure/jobs/recovery-scanner.job.js";
import { AttemptCartRecoveryUseCase } from "./application/use-cases/attempt-cart-recovery.use-case.js";
import { TrackRecoveryOutcomeUseCase } from "./application/use-cases/track-recovery-outcome.use-case.js";
import { GetRecoveryMetricsUseCase } from "./application/use-cases/get-recovery-metrics.use-case.js";
import { RECOVERY_ATTEMPT_REPOSITORY } from "./domain/ports/recovery-attempt-repository.port.js";
import { InMemoryRecoveryAttemptRepository } from "./infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";
import { CartRecoveryController } from "./presentation/http/cart-recovery.controller.js";

export const ATTEMPT_CART_RECOVERY_USE_CASE = Symbol("ATTEMPT_CART_RECOVERY_USE_CASE");
export const TRACK_RECOVERY_OUTCOME_USE_CASE = Symbol("TRACK_RECOVERY_OUTCOME_USE_CASE");
export const GET_RECOVERY_METRICS_USE_CASE = Symbol("GET_RECOVERY_METRICS_USE_CASE");

/**
 * CartRecoveryModule — Background scanner that detects abandoned sessions
 * (triggerAgent=true, abandonmentScore >= 0.55) and applies recovery strategies.
 *
 * Widget integration: Scanner updates session → Widget polls session → sees new offer.
 */
@Module({
  imports: [
    forwardRef(() => CheckoutModule),
    MerchantModule,
    BuyerPurchaseHistoryModule,
  ],
  controllers: [CartRecoveryController],
  providers: [
    {
      provide: RECOVERY_ATTEMPT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => {
        // TODO: Replace with PrismaRecoveryAttemptRepository when table is migrated
        return new InMemoryRecoveryAttemptRepository();
      },
      inject: [PRISMA_CLIENT],
    },
    RecoveryScannerJob,
    {
      provide: ATTEMPT_CART_RECOVERY_USE_CASE,
      useFactory: (repo) => new AttemptCartRecoveryUseCase(repo),
      inject: [RECOVERY_ATTEMPT_REPOSITORY],
    },
    {
      provide: TRACK_RECOVERY_OUTCOME_USE_CASE,
      useFactory: (repo) => new TrackRecoveryOutcomeUseCase(repo),
      inject: [RECOVERY_ATTEMPT_REPOSITORY],
    },
    {
      provide: GET_RECOVERY_METRICS_USE_CASE,
      useFactory: (repo) => new GetRecoveryMetricsUseCase(repo),
      inject: [RECOVERY_ATTEMPT_REPOSITORY],
    },
    {
      provide: GetRecoveryMetricsUseCase,
      useFactory: (repo) => new GetRecoveryMetricsUseCase(repo),
      inject: [RECOVERY_ATTEMPT_REPOSITORY],
    },
  ],
  exports: [
    RECOVERY_ATTEMPT_REPOSITORY,
    RecoveryScannerJob,
    ATTEMPT_CART_RECOVERY_USE_CASE,
    TRACK_RECOVERY_OUTCOME_USE_CASE,
    GET_RECOVERY_METRICS_USE_CASE,
    GetRecoveryMetricsUseCase,
  ]
})
export class CartRecoveryModule {}
