import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import { FREE_TRIAL_DAYS } from "@zyon/shared-types";

@Injectable()
export class StartTrialUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string) {
    const billing = await this.repository.getOrCreateTrial(merchantId, FREE_TRIAL_DAYS);
    if (billing.stripeSubscriptionId || billing.asaasSubscriptionId) return billing;
    await this.repository.saveBilling({
      merchantId,
      provider: "stripe",
      planKey: "starter",
    });
    return billing;
  }
}
