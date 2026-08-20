export interface FeatureFlags {
  negotiation: boolean;
  crossSell: boolean;
  progressiveDiscount: boolean;
  cartRecovery: boolean;
  intentPersonalization: boolean;
  experimentVariantId?: string;
}

export interface RevenueData {
  orderValueCents: number;
  discountCents: number;
  shippingSubsidyCents: number;
}

export interface TagInput {
  sessionId: string;
  orderId: string;
  cohort: "holdout" | "treatment";
  features: FeatureFlags;
  revenue: RevenueData;
  aiCostCents: number;
}

export interface AttributionTag {
  sessionId: string;
  orderId: string;
  cohort: "holdout" | "treatment";
  negotiationApplied: boolean;
  crossSellApplied: boolean;
  progressiveDiscountApplied: boolean;
  cartRecoveryApplied: boolean;
  intentPersonalizationApplied: boolean;
  experimentVariantId?: string;
  orderValueCents: number;
  discountGivenCents: number;
  shippingSubsidyCents: number;
  aiCostCents: number;
}

import { Injectable } from "@nestjs/common";

/**
 * Attribution tagger for multi-touch feature tracking.
 *
 * INVARIANT A3: Holdout cohort safety guard — all features forced to false
 * regardless of upstream input. This is a safety measure against contamination.
 */
@Injectable()
export class AttributionTaggerService {
  tag(input: TagInput): AttributionTag {
    const {
      sessionId,
      orderId,
      cohort,
      features,
      revenue,
      aiCostCents,
    } = input;

    // A3: Safety guard — holdout cannot have features applied
    if (cohort === "holdout") {
      return {
        sessionId,
        orderId,
        cohort,
        negotiationApplied: false,
        crossSellApplied: false,
        progressiveDiscountApplied: false,
        cartRecoveryApplied: false,
        intentPersonalizationApplied: false,
        experimentVariantId: undefined,
        orderValueCents: revenue.orderValueCents,
        discountGivenCents: revenue.discountCents,
        shippingSubsidyCents: revenue.shippingSubsidyCents,
        aiCostCents: 0, // holdout sessions cost 0
      };
    }

    // A2/A4: Multi-touch — all features that are true get credited
    return {
      sessionId,
      orderId,
      cohort,
      negotiationApplied: features.negotiation,
      crossSellApplied: features.crossSell,
      progressiveDiscountApplied: features.progressiveDiscount,
      cartRecoveryApplied: features.cartRecovery,
      intentPersonalizationApplied: features.intentPersonalization,
      experimentVariantId: features.experimentVariantId,
      orderValueCents: revenue.orderValueCents,
      discountGivenCents: revenue.discountCents,
      shippingSubsidyCents: revenue.shippingSubsidyCents,
      aiCostCents,
    };
  }
}
