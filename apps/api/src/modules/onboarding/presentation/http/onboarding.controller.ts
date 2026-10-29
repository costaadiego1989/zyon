import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
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
  state(@Req() request: TenantPrincipalRequest) {
    return this.getState.execute(currentTenantPrincipal(request).tenantId);
  }

  @Post("steps/:step/complete")
  complete(@Req() request: TenantPrincipalRequest, @Param("step") step: string) {
    return this.completeStep.execute({
      merchantId: currentTenantPrincipal(request).tenantId,
      step
    });
  }
}
