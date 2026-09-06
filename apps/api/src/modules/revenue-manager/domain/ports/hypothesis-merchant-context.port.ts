import type { MerchantRules } from "@zyon/shared-types";

export const HYPOTHESIS_MERCHANT_CONTEXT_PORT = Symbol("HYPOTHESIS_MERCHANT_CONTEXT_PORT");

/** Read-only context: absent policy or a non-reproducible baseline blocks generation. */
export interface HypothesisMerchantContextPort {
  getRules(merchantId: string): Promise<MerchantRules | undefined>;
  getCurrentPrompt(merchantId: string): Promise<string | undefined>;
}
