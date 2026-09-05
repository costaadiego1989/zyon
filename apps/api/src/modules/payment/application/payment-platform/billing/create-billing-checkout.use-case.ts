import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  STRIPE_PLATFORM_PORT,
  BILLING_CONFIG_PORT,
  type StripePlatformPort,
  type BillingConfigPort,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import {
  BILLING_TRIAL_JOB_QUEUE,
  type BillingTrialJobQueue,
} from "../../../domain/ports/billing-trial-job-queue.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../../../merchant/domain/ports/merchant-repository.port.js";
import type { BillingPlan } from "../../../domain/payment-platform.types.js";
import { scheduleTrialExpiration } from "../shared.js";

@Injectable()
export class CreateBillingCheckoutUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
    @Optional()
    @Inject(BILLING_TRIAL_JOB_QUEUE)
    private readonly trialJobs?: BillingTrialJobQueue,
  ) {}

  async execute(input: {
    merchantId: string;
    email: string;
    plan: BillingPlan;
  }): Promise<{ url: string; sessionId: string }> {
    if (input.plan !== "growth" && input.plan !== "scale") throw new BadRequestException("billing_paid_plan_required");
    const priceId = this.billingConfig.priceId(input.plan);
    const profile = await this.merchants.getProfile(input.merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");
    const billing = await this.repository.getOrCreateTrial(
      input.merchantId,
      14,
    );
    await scheduleTrialExpiration(this.trialJobs, billing);
    if ((billing.stripeSubscriptionId || billing.asaasSubscriptionId) && ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(billing.status)) {
      throw new ConflictException("billing_subscription_exists_use_portal");
    }
    let customerId = billing.stripeCustomerId;
    if (!customerId) {
      customerId = (
        await this.stripe.createBillingCustomer({
          merchantId: input.merchantId,
          merchantName: profile.name,
          email: input.email,
        })
      ).customerId;
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        stripeCustomerId: customerId,
      });
    }
    const consoleUrl = this.billingConfig.consoleUrl();
    return this.stripe.createSubscriptionCheckout({
      merchantId: input.merchantId,
      customerId,
      priceId,
      successUrl: `${consoleUrl}/?billing=success#billing-plans`,
      cancelUrl: `${consoleUrl}/?billing=cancelled#billing-plans`,
    });
  }
}

