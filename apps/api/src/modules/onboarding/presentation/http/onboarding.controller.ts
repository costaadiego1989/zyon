import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { GetOnboardingStateUseCase } from "../../application/get-onboarding-state.use-case.js";
import { CompleteOnboardingStepUseCase } from "../../application/complete-onboarding-step.use-case.js";

@UseGuards(AuthGuard)
@Controller("onboarding")
export class OnboardingController {
  constructor(
    private readonly getState: GetOnboardingStateUseCase,
    private readonly completeStep: CompleteOnboardingStepUseCase
  ) {}

  @Get()
  state(@Req() request: unknown) {
    return this.getState.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Post("steps/:step/complete")
  complete(@Req() request: unknown, @Param("step") step: string) {
    return this.completeStep.execute({
      merchantId: currentUser(request as { user?: unknown }).merchantId,
      step
    });
  }
}
