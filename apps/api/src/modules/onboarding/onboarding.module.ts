import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthModule } from "../auth/auth.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { GetOnboardingStateUseCase } from "./application/get-onboarding-state.use-case.js";
import { CompleteOnboardingStepUseCase } from "./application/complete-onboarding-step.use-case.js";
import { ONBOARDING_STATE_REPOSITORY } from "./domain/ports/onboarding-state.repository.port.js";
import { PrismaOnboardingStateRepository } from "./infrastructure/prisma-onboarding-state.repository.js";
import { OnboardingController } from "./presentation/http/onboarding.controller.js";

@Module({
  imports: [AuthModule, MerchantModule],
  controllers: [OnboardingController],
  providers: [
    GetOnboardingStateUseCase,
    CompleteOnboardingStepUseCase,
    {
      provide: ONBOARDING_STATE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaOnboardingStateRepository(prisma),
      inject: [PRISMA_CLIENT]
    }
  ],
  exports: [ONBOARDING_STATE_REPOSITORY]
})
export class OnboardingModule {}
