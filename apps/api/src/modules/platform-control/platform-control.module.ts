import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PasswordHasher } from "../auth/domain/services/password-hasher.service.js";
import { LoginRateLimiter } from "../auth/domain/services/login-rate-limiter.service.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { LoginPlatformOperatorWithRateLimitUseCase } from "./application/login-platform-operator-with-rate-limit.use-case.js";
import { ChangePlatformFeedbackTreatmentUseCase } from "./application/change-platform-feedback-treatment.use-case.js";
import { ListPlatformAiUsageByMerchantUseCase } from "./application/list-platform-ai-usage-by-merchant.use-case.js";
import { ListPlatformAuditEventsUseCase } from "./application/list-platform-audit-events.use-case.js";
import { ListPlatformBillingSubscriptionsUseCase } from "./application/list-platform-billing-subscriptions.use-case.js";
import { ListPlatformBillingReceivablesUseCase } from "./application/list-platform-billing-receivables.use-case.js";
import { ListPlatformFeedbackUseCase } from "./application/list-platform-feedback.use-case.js";
import { LoginPlatformOperatorUseCase } from "./application/login-platform-operator.use-case.js";
import { RefreshPlatformSessionUseCase } from "./application/refresh-platform-session.use-case.js";
import { PLATFORM_OPERATOR_REPOSITORY } from "./domain/ports/platform-operator-repository.port.js";
import { PLATFORM_LOGIN_RATE_LIMITER } from "./domain/ports/platform-login-rate-limiter.port.js";
import { PLATFORM_FEEDBACK_REPOSITORY } from "./domain/ports/platform-feedback-repository.port.js";
import { PLATFORM_AI_USAGE_REPOSITORY } from "./domain/ports/platform-ai-usage-repository.port.js";
import { PLATFORM_BILLING_SUBSCRIPTION_REPOSITORY } from "./domain/ports/platform-billing-subscription-repository.port.js";
import { PLATFORM_BILLING_RECEIVABLE_REPOSITORY } from "./domain/ports/platform-billing-receivable-repository.port.js";
import { PLATFORM_AUDIT_REPOSITORY } from "./domain/ports/platform-audit-repository.port.js";
import { PlatformJwtService } from "./domain/services/platform-jwt.service.js";
import { PrismaPlatformOperatorRepository } from "./infrastructure/prisma-platform-operator.repository.js";
import { PrismaPlatformFeedbackRepository } from "./infrastructure/prisma-platform-feedback.repository.js";
import { PrismaPlatformAiUsageRepository } from "./infrastructure/prisma-platform-ai-usage.repository.js";
import { PrismaPlatformBillingSubscriptionRepository } from "./infrastructure/prisma-platform-billing-subscription.repository.js";
import { PrismaPlatformBillingReceivableRepository } from "./infrastructure/prisma-platform-billing-receivable.repository.js";
import { PrismaPlatformAuditRepository } from "./infrastructure/prisma-platform-audit.repository.js";
import { PlatformAccessGuard } from "./presentation/platform-access.guard.js";
import { PlatformAuthController } from "./presentation/platform-auth.controller.js";
import { PlatformFeedbackController } from "./presentation/platform-feedback.controller.js";
import { PlatformAiUsageController } from "./presentation/platform-ai-usage.controller.js";
import { PlatformBillingSubscriptionsController } from "./presentation/platform-billing-subscriptions.controller.js";
import { PlatformBillingReceivablesController } from "./presentation/platform-billing-receivables.controller.js";
import { PlatformAuditController } from "./presentation/platform-audit.controller.js";
import { PlatformPermissionGuard } from "./presentation/platform-permission.guard.js";

@Module({
  controllers: [PlatformAuthController, PlatformFeedbackController, PlatformAiUsageController, PlatformBillingSubscriptionsController, PlatformBillingReceivablesController, PlatformAuditController],
  providers: [
    LoginPlatformOperatorUseCase,
    LoginPlatformOperatorWithRateLimitUseCase,
    ListPlatformAiUsageByMerchantUseCase,
    ListPlatformAuditEventsUseCase,
    ListPlatformBillingSubscriptionsUseCase,
    ListPlatformBillingReceivablesUseCase,
    ListPlatformFeedbackUseCase,
    ChangePlatformFeedbackTreatmentUseCase,
    RefreshPlatformSessionUseCase,
    PlatformJwtService,
    PlatformAccessGuard,
    PlatformPermissionGuard,
    {
      provide: PLATFORM_OPERATOR_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformOperatorRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_FEEDBACK_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformFeedbackRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_AI_USAGE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformAiUsageRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_BILLING_SUBSCRIPTION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformBillingSubscriptionRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_BILLING_RECEIVABLE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformBillingReceivableRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_AUDIT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPlatformAuditRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: PLATFORM_LOGIN_RATE_LIMITER,
      useFactory: () => new LoginRateLimiter(
        Number(process.env.PLATFORM_CONTROL_LOGIN_MAX_ATTEMPTS ?? 5),
        Number(process.env.PLATFORM_CONTROL_LOGIN_WINDOW_MS ?? 15 * 60 * 1000),
      ),
    },
    PasswordHasher,
  ],
  exports: [
    PlatformAccessGuard,
    PlatformPermissionGuard,
    PlatformJwtService,
    PLATFORM_BILLING_RECEIVABLE_REPOSITORY,
  ],
})
export class PlatformControlModule {}
