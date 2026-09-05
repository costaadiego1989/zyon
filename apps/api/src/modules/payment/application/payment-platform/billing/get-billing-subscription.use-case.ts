import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  BILLING_TRIAL_JOB_QUEUE,
  type BillingTrialJobQueue,
} from "../../../domain/ports/billing-trial-job-queue.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import { BILLING_PLANS, BUYER_SERVICE_FEE_CENTS, effectiveBillingPlan, freeTrialState, merchantTransactionFeeCentsFor } from "../../../domain/billing-plans.js";
import { BillingPlanMeteringService } from "../../../domain/billing-plan-guard.js";
import type { BillingSubscriptionWithPlanSnapshot } from "../../../domain/payment-platform.types.js";
import { scheduleTrialExpiration } from "../shared.js";

@Injectable()
export class GetBillingSubscriptionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Optional()
    @Inject(BILLING_TRIAL_JOB_QUEUE)
    private readonly trialJobs?: BillingTrialJobQueue,
    private readonly metering?: BillingPlanMeteringService,
  ) {}

  async execute(merchantId: string): Promise<BillingSubscriptionWithPlanSnapshot> {
    const subscription = await this.repository.getOrCreateTrial(merchantId, 14);
    await scheduleTrialExpiration(this.trialJobs, subscription);
    const plan = effectiveBillingPlan(subscription);
    const config = BILLING_PLANS[plan];
    const trial = freeTrialState(subscription);
    const usage = await this.metering?.getUsage(merchantId);
    return {
      ...subscription,
      plan,
      planName: config.name,
      monthlyPriceBrl: config.monthlyPriceBrl,
      transactionFeeCents: merchantTransactionFeeCentsFor(subscription),
      trialExpired: trial.expired,
      trialDaysRemaining: trial.daysRemaining,
      buyerServiceFeeCents: BUYER_SERVICE_FEE_CENTS,
      limits: config.limits,
      features: config.features,
      usage,
    };
  }
}

