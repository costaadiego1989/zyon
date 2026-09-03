import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { TRACK_RECOVERY_OUTCOME_USE_CASE } from "./cart-recovery.tokens.js";
import { RecoveryScannerJob } from "./infrastructure/jobs/recovery-scanner.job.js";
import { CartRecoveryOnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";
import { AttemptCartRecoveryUseCase } from "./application/use-cases/attempt-cart-recovery.use-case.js";
import { TrackRecoveryOutcomeUseCase } from "./application/use-cases/track-recovery-outcome.use-case.js";
import { GetRecoveryMetricsUseCase } from "./application/use-cases/get-recovery-metrics.use-case.js";
import { GetStrategyPreferencesUseCase } from "./application/use-cases/get-strategy-preferences.use-case.js";
import { UpdateStrategyPreferencesUseCase } from "./application/use-cases/update-strategy-preferences.use-case.js";
import { GetStrategyConfigUseCase } from "./application/use-cases/get-strategy-config.use-case.js";
import { UpdateStrategyConfigUseCase } from "./application/use-cases/update-strategy-config.use-case.js";
import { RECOVERY_ATTEMPT_REPOSITORY } from "./domain/ports/recovery-attempt-repository.port.js";
import { STRATEGY_PREFERENCES_REPOSITORY } from "./domain/ports/strategy-preferences-repository.port.js";
import { PrismaRecoveryAttemptRepository } from "./infrastructure/repositories/prisma-recovery-attempt.repository.js";
import { PrismaStrategyPreferencesRepository } from "./infrastructure/repositories/prisma-strategy-preferences.repository.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CHECKOUT_SESSION_REPOSITORY } from "../checkout/domain/ports/checkout-session.repository.port.js";
import { PrismaCheckoutRepository } from "../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { BuyerAccountRepositoryModule } from "../buyer-account/buyer-account-repository.module.js";
import { RevenueLiftModule } from "../revenue-lift/revenue-lift.module.js";
import { CartRecoveryController } from "./presentation/http/cart-recovery.controller.js";
import { CartRecoveryDashboardController } from "./presentation/http/cart-recovery-dashboard.controller.js";
import { WHATSAPP_SENDER_PORT } from "../notifications/domain/ports/whatsapp-sender.port.js";
import { EMAIL_SENDER_PORT } from "../notifications/domain/ports/email-sender.port.js";
import { WhatsAppTemplatesModule } from "../whatsapp-templates/whatsapp-templates.module.js";
import { SendWhatsAppMessageUseCase } from "../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";

export const ATTEMPT_CART_RECOVERY_USE_CASE = Symbol("ATTEMPT_CART_RECOVERY_USE_CASE");
// Imported from tokens file (single source) to avoid the module↔handler cycle;
// re-exported so existing importers of this module keep working.
export { TRACK_RECOVERY_OUTCOME_USE_CASE };
export const GET_RECOVERY_METRICS_USE_CASE = Symbol("GET_RECOVERY_METRICS_USE_CASE");
export const GET_STRATEGY_PREFERENCES_USE_CASE = Symbol("GET_STRATEGY_PREFERENCES_USE_CASE");
export const UPDATE_STRATEGY_PREFERENCES_USE_CASE = Symbol("UPDATE_STRATEGY_PREFERENCES_USE_CASE");
export const GET_STRATEGY_CONFIG_USE_CASE = Symbol("GET_STRATEGY_CONFIG_USE_CASE");
export const UPDATE_STRATEGY_CONFIG_USE_CASE = Symbol("UPDATE_STRATEGY_CONFIG_USE_CASE");

/**
 * CartRecoveryModule — Background scanner that detects abandoned sessions
 * (triggerAgent=true, abandonmentScore >= 0.55) and applies recovery strategies.
 *
 * Widget integration: Scanner updates session → Widget polls session → sees new offer.
 */
@Module({
  imports: [
    MerchantModule,
    BuyerPurchaseHistoryModule,
    NotificationsModule,
    BuyerAccountRepositoryModule,
    RevenueLiftModule,
    WhatsAppTemplatesModule,
  ],
  controllers: [CartRecoveryController, CartRecoveryDashboardController],
  providers: [
    {
      provide: CHECKOUT_SESSION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCheckoutRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: RECOVERY_ATTEMPT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaRecoveryAttemptRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: STRATEGY_PREFERENCES_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaStrategyPreferencesRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    RecoveryScannerJob,
    CartRecoveryOnOrderCompletedHandler,
    {
      provide: ATTEMPT_CART_RECOVERY_USE_CASE,
      useFactory: (repo: any, whatsapp: any, email: any, sendWa: SendWhatsAppMessageUseCase) =>
        new AttemptCartRecoveryUseCase(repo, undefined, whatsapp, undefined, email, sendWa),
      inject: [RECOVERY_ATTEMPT_REPOSITORY, WHATSAPP_SENDER_PORT, EMAIL_SENDER_PORT, SendWhatsAppMessageUseCase],
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
    {
      provide: GET_STRATEGY_PREFERENCES_USE_CASE,
      useFactory: (repo) => new GetStrategyPreferencesUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
    {
      provide: GetStrategyPreferencesUseCase,
      useFactory: (repo) => new GetStrategyPreferencesUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
    {
      provide: UPDATE_STRATEGY_PREFERENCES_USE_CASE,
      useFactory: (repo) => new UpdateStrategyPreferencesUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
    {
      provide: UpdateStrategyPreferencesUseCase,
      useFactory: (repo) => new UpdateStrategyPreferencesUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
    {
      provide: GET_STRATEGY_CONFIG_USE_CASE,
      useFactory: (repo) => new GetStrategyConfigUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
    {
      provide: GetStrategyConfigUseCase,
      useFactory: (repo) => new GetStrategyConfigUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
    {
      provide: UPDATE_STRATEGY_CONFIG_USE_CASE,
      useFactory: (repo) => new UpdateStrategyConfigUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
    {
      provide: UpdateStrategyConfigUseCase,
      useFactory: (repo) => new UpdateStrategyConfigUseCase(repo),
      inject: [STRATEGY_PREFERENCES_REPOSITORY],
    },
  ],
  exports: [
    RECOVERY_ATTEMPT_REPOSITORY,
    STRATEGY_PREFERENCES_REPOSITORY,
    RecoveryScannerJob,
    ATTEMPT_CART_RECOVERY_USE_CASE,
    TRACK_RECOVERY_OUTCOME_USE_CASE,
    GET_RECOVERY_METRICS_USE_CASE,
    GET_STRATEGY_PREFERENCES_USE_CASE,
    UPDATE_STRATEGY_PREFERENCES_USE_CASE,
    GET_STRATEGY_CONFIG_USE_CASE,
    UPDATE_STRATEGY_CONFIG_USE_CASE,
    GetRecoveryMetricsUseCase,
    GetStrategyPreferencesUseCase,
    UpdateStrategyPreferencesUseCase,
    GetStrategyConfigUseCase,
    UpdateStrategyConfigUseCase,
  ]
})
export class CartRecoveryModule {}
