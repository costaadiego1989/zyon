import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import {
  BILLING_PROVIDER,
  type BillingProviderPort,
} from "../../../domain/ports/billing-provider.port.js";

export interface CancelSubscriptionInput {
  merchantId: string;
  immediate?: boolean;
}

@Injectable()
export class CancelSubscriptionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
  ) {}

  async execute(input: CancelSubscriptionInput) {
    const billing = await this.repository.getBilling(input.merchantId);
    if (!billing) {
      return undefined;
    }

    if (input.immediate && billing.asaasSubscriptionId) {
      await this.provider.cancelSubscription(billing.asaasSubscriptionId);
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        status: "cancelled",
        cancelAtPeriodEnd: false,
      });
    } else {
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        cancelAtPeriodEnd: true,
      });
    }

    return this.repository.getBilling(input.merchantId);
  }
}
