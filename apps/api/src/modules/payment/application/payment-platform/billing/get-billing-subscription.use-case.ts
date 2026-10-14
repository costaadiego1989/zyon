import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  BILLING_TRIAL_JOB_QUEUE,
  type BillingTrialJobQueue,
} from "../../../domain/ports/billing-trial-job-queue.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import { BILLING_PLANS, effectiveBillingPlan, freeTrialState, merchantTransactionFeeCentsFor } from "../../../domain/billing-plans.js";
import { BillingPlanMeteringService } from "../../../domain/billing-plan-guard.js";
import type { BillingSubscriptionWithPlanSnapshot } from "../../../domain/payment-platform.types.js";
import { readBuyerServiceFeeCents } from "../../../infrastructure/stripe-env.js";
import { scheduleTrialExpiration } from "../shared.js";
import { OrderQuotaService } from "../../services/order-quota.service.js";

@Injectable()
export class GetBillingSubscriptionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Optional()
    @Inject(BILLING_TRIAL_JOB_QUEUE)
    private readonly trialJobs?: BillingTrialJobQueue,
    private readonly metering?: BillingPlanMeteringService,
    private readonly orderQuota?: OrderQuotaService,
  ) {}

  async execute(merchantId: string): Promise<BillingSubscriptionWithPlanSnapshot> {
    const subscription = await this.repository.getBilling(merchantId);
    const now = new Date().toISOString();
    const pendingSelection = subscription === undefined;
    const snapshot = subscription ?? {
      merchantId,
      status: "incomplete" as const,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
      provider: "stripe" as const,
      planKey: "starter" as const,
    };
    if (subscription?.status === "trialing") await scheduleTrialExpiration(this.trialJobs, subscription);
    const plan = effectiveBillingPlan(snapshot);
    const config = BILLING_PLANS[plan];
    const trial = freeTrialState(snapshot);
    const usage = await this.metering?.getUsage(merchantId);
    const commercial = await this.orderQuota?.getSnapshot(merchantId);
    return {
      ...snapshot,
      plan,
      planName: config.name,
      monthlyPriceBrl: config.monthlyPriceBrl,
      transactionFeeCents: merchantTransactionFeeCentsFor(snapshot),
      // A merchant without a selected plan has not exhausted the Free trial.
      trialExpired: pendingSelection ? false : trial.expired,
      trialDaysRemaining: trial.daysRemaining,
      buyerServiceFeeCents: readBuyerServiceFeeCents(),
      limits: config.limits,
      features: config.features,
      usage,
      commercial,
    };
  }
}
