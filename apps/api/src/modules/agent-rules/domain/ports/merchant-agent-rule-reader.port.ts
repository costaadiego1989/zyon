/** Public merchant-agent configuration needed by storefront consumers. */
export interface MerchantAgentRuleProjection {
  identity: unknown;
  checkoutSettings: unknown;
}

export const MERCHANT_AGENT_RULE_READER = Symbol("MERCHANT_AGENT_RULE_READER");

export interface MerchantAgentRuleReaderPort {
  findForMerchant(merchantId: string): Promise<MerchantAgentRuleProjection | null>;
}

