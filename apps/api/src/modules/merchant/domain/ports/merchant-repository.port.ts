import type { MerchantProfile, MerchantRules, MerchantTheme } from "../merchant.types.js";

export const MERCHANT_REPOSITORY = Symbol("MERCHANT_REPOSITORY");

export interface MerchantRepository {
  getProfile(merchantId: string): Promise<MerchantProfile | undefined>;
  getStripeConnectAccountId(merchantId: string): Promise<string | undefined>;
  setStripeConnectAccountId(merchantId: string, accountId: string): Promise<void>;
  getRules(merchantId: string): Promise<MerchantRules>;
  updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules>;
  updateTheme(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme>;
}
