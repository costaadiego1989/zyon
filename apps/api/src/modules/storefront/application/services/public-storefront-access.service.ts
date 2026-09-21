import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { effectiveBillingPlan, freeTrialState } from "../../../payment/domain/billing-plans.js";
import { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";

const DEFAULT_ZYON_MAIN_SITE_URL = "https://www.zyon-payments.com.br/";

/**
 * Owns the public-store admission rule. A storefront is available during its
 * 14-day trial and while it has an active paid subscription. The response
 * contract deliberately contains the Zyon site destination so every public
 * surface can handle an expired trial consistently.
 */
@Injectable()
export class PublicStorefrontAccessService {
  constructor(
    @Inject(BillingPlanMeteringService)
    private readonly billing: Pick<BillingPlanMeteringService, "getSubscription">,
  ) {}

  async assertMerchantCanServe(merchantId: string, now = new Date()): Promise<void> {
    const subscription = await this.billing.getSubscription(merchantId);
    const trial = freeTrialState(subscription, now);
    const paid = subscription?.status === "active" &&
      effectiveBillingPlan(subscription, now) !== "starter";

    if (trial.active || paid) return;

    throw new ForbiddenException({
      code: "store_subscription_required",
      redirect_url: zyonMainSiteUrl(),
    });
  }
}

export function zyonMainSiteUrl(value = process.env.ZYON_MAIN_SITE_URL): string {
  if (!value?.trim()) return DEFAULT_ZYON_MAIN_SITE_URL;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : DEFAULT_ZYON_MAIN_SITE_URL;
  } catch {
    return DEFAULT_ZYON_MAIN_SITE_URL;
  }
}
