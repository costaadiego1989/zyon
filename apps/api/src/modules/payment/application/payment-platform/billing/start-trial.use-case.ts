import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";

@Injectable()
export class StartTrialUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string) {
    const billing = await this.repository.getOrCreateTrial(merchantId, 14);
    if (billing.stripeSubscriptionId || billing.asaasSubscriptionId) return billing;
    await this.repository.saveBilling({
      merchantId,
      provider: "stripe",
      planKey: "starter",
    });
    return billing;
  }
}
