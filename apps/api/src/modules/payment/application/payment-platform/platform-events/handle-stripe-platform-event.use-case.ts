import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { BillingSubscriptionSnapshot } from "../../../domain/payment-platform.types.js";

@Injectable()
export class HandleStripePlatformEventUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async accountUpdated(input: {
    merchantId: string;
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirements: string[];
  }): Promise<void> {
    const current = await this.repository.getConnection(
      input.merchantId,
      "stripe",
    );
    await this.repository.saveConnection({
      merchantId: input.merchantId,
      provider: "stripe",
      environment: current?.environment ?? "test",
      status:
        input.chargesEnabled &&
        input.payoutsEnabled &&
        input.detailsSubmitted &&
        input.requirements.length === 0
          ? "active"
          : "restricted",
      externalAccountId: input.accountId,
      chargesEnabled: input.chargesEnabled,
      payoutsEnabled: input.payoutsEnabled,
      requirements: input.requirements,
      syncedAt: new Date().toISOString(),
    });
  }

  async checkoutCompleted(input: {
    merchantId: string;
    customerId?: string;
    subscriptionId?: string;
  }): Promise<void> {
    await this.repository.saveBilling({
      merchantId: input.merchantId,
      stripeCustomerId: input.customerId,
      stripeSubscriptionId: input.subscriptionId,
      status: "active",
    });
  }

  async subscriptionUpdated(input: {
    merchantId?: string;
    customerId: string;
    subscriptionId: string;
    priceId?: string;
    status: BillingSubscriptionSnapshot["status"];
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    const merchantId =
      input.merchantId ??
      (await this.repository.findMerchantByStripeSubscriptionId(
        input.subscriptionId,
      )) ??
      (await this.repository.findMerchantByStripeCustomerId(
        input.customerId,
      ));
    if (!merchantId) return;
    await this.repository.saveBilling({
      merchantId,
      stripeCustomerId: input.customerId,
      stripeSubscriptionId: input.subscriptionId,
      stripePriceId: input.priceId,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    });
  }
}

