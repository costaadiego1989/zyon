import type { BillingPlanFeatureKey } from "../billing-plans.js";
import type { BillingPlan } from "../payment-platform.types.js";

/** Feature admission/read capability; metering implementation stays outside consumers. */
export const BILLING_PLAN_ACCESS = Symbol("BILLING_PLAN_ACCESS");

export interface BillingPlanAccessPort {
  getEffectivePlan(merchantId: string, now?: Date): Promise<BillingPlan>;
  assertAllowed(merchantId: string, requirement: { kind: "feature"; key: BillingPlanFeatureKey }): Promise<void>;
}

