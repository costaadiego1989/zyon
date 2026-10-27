import type { BillingCycle } from "@zyon/shared-types";
import { quoteBilling } from "../../../infrastructure/billing-offers.js";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  STRIPE_PLATFORM_PORT,
  BILLING_CONFIG_PORT,
  BILLING_CHECKOUT_PROMOTION_PORT,
  type BillingCheckoutPromotionPort,
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
import { stripeBillingError } from "./stripe-billing-error.js";

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
    @Optional() @Inject(BILLING_CHECKOUT_PROMOTION_PORT)
    private readonly promotions?: BillingCheckoutPromotionPort,
  ) {}

  async execute(input: {
    merchantId: string;
    email: string;
    plan: BillingPlan;
    billingCycle?: BillingCycle;
    promotionCode?: string;
  }): Promise<{ url: string; sessionId: string }> {
    if (input.plan !== "starter179" && input.plan !== "growth" && input.plan !== "scale") throw new BadRequestException("billing_paid_plan_required");
    const offer = quoteBilling(input.plan, input.billingCycle);
    const priceId = this.billingConfig.priceId(input.plan, offer.cycle);
    let promotionCodeId: string | undefined;
    if (input.promotionCode?.trim()) {
      if (!this.promotions) throw new BadRequestException("billing_promotions_unavailable");
      promotionCodeId = await this.promotions.resolveForCheckout({ code: input.promotionCode, plan: input.plan, cycle: offer.cycle });
    }
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
      try {
        customerId = (
          await this.stripe.createBillingCustomer({
            merchantId: input.merchantId,
            merchantName: profile.name,
            email: input.email,
          })
        ).customerId;
      } catch (error) {
        throw stripeBillingError(error);
      }
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        stripeCustomerId: customerId,
      });
    }
    const consoleUrl = this.billingConfig.consoleUrl();
    try {
      return await this.stripe.createSubscriptionCheckout({
        merchantId: input.merchantId,
        customerId,
        priceId,
        offer,
        promotionCodeId,
        successUrl: `${consoleUrl}/?billing=success#billing-plans`,
        cancelUrl: `${consoleUrl}/?billing=cancelled#billing-plans`,
      });
    } catch (error) {
      throw stripeBillingError(error);
    }
  }
}

