import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { OnboardingStateResponse } from "@aacp/shared-types";
import {
  ONBOARDING_STATE_REPOSITORY,
  type OnboardingStateRepository
} from "../domain/ports/onboarding-state.repository.port.js";
import { OnboardingStateEntity } from "../domain/entities/onboarding-state.entity.js";

@Injectable()
export class GetOnboardingStateUseCase {
  constructor(
    @Inject(ONBOARDING_STATE_REPOSITORY) private readonly repository: OnboardingStateRepository
  ) {}

  async execute(merchantId: string): Promise<OnboardingStateResponse> {
    const id = merchantId?.trim();
    if (!id) throw new BadRequestException("onboarding_merchant_required");

    const existing = await this.repository.findByMerchant(id);
    if (existing) return existing.toResponse();

    // First read: the merchant already exists (authenticated), so the account
    // step is satisfied. Persist so progress is resumable from now on.
    const created = OnboardingStateEntity.create(id);
    created.completeStep("account");
    await this.repository.save(created);
    return created.toResponse();
  }
}
