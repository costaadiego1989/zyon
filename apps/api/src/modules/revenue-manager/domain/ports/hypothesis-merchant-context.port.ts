import type { MerchantRules } from "@zyon/shared-types";
import type { CheckoutChatBaseline } from "../../../checkout/domain/services/checkout-chat-baseline.js";
import type { StrategyMeasurementPlanning } from "../strategy-measurement.js";
import type { StrategyDiscountStudy } from "../strategy-discount-study.js";
import type { RevenueIncentiveOptions } from "../revenue-incentive-options.js";

export const HYPOTHESIS_MERCHANT_CONTEXT_PORT = Symbol("HYPOTHESIS_MERCHANT_CONTEXT_PORT");

/** Read-only context: absent policy or a non-reproducible baseline blocks generation. */
export interface HypothesisMerchantContextPort {
  getRules(merchantId: string): Promise<MerchantRules | undefined>;
  getCurrentPrompt(merchantId: string): Promise<string | undefined>;
  getCheckoutBaseline?(merchantId: string): Promise<CheckoutChatBaseline | undefined>;
  getMeasurementPlanning?(merchantId: string, context: { runId: string; leaseToken: number }): Promise<StrategyMeasurementPlanning | undefined>;
  getDiscountStudy?(merchantId: string, context: { runId: string; leaseToken: number }): Promise<StrategyDiscountStudy | undefined>;
  getIncentiveOptions?(merchantId: string, context: { runId: string; leaseToken: number }): Promise<RevenueIncentiveOptions | undefined>;
}
