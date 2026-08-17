import { BadRequestException, Inject, Injectable , Logger} from "@nestjs/common";
import type { OnboardingStateResponse } from "@zyon/shared-types";
import {
  ONBOARDING_STATE_REPOSITORY,
  type OnboardingStateRepository
} from "../domain/ports/onboarding-state.repository.port.js";
import { OnboardingStateEntity } from "../domain/entities/onboarding-state.entity.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GetOnboardingStateUseCase {
  private readonly logger = new Logger(GetOnboardingStateUseCase.name);

  constructor(
    @Inject(ONBOARDING_STATE_REPOSITORY) private readonly repository: OnboardingStateRepository
  ) {}

  async execute(merchantId: string): Promise<OnboardingStateResponse> {
    const id = merchantId?.trim();
    if (!id) throw new BadRequestException("onboarding_merchant_required");

    const existing = await this.repository.findByMerchant(id);
    if (existing) return existing.toResponse();

    // First read: the merchant already exists (authenticated), so the account
    // step is satisfied. Return computed default in-memory — do NOT persist on
    // read (lazy-persist on first write is intentional, keeps GET side-effect-free).
    // ONB-M1: Use snapshot approach to avoid mutating the entity reference.
    const now = new Date();
    const snapshot = OnboardingStateEntity.create(id, now).toSnapshot();
    snapshot.steps["account"] = { status: "completed", completedAt: now.toISOString() };
    return OnboardingStateEntity.rehydrate(snapshot).toResponse();
  }
}
