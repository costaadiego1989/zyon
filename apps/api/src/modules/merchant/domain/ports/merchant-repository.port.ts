import type { MerchantProfile, MerchantRules } from "../merchant.types.js";

export const MERCHANT_REPOSITORY = Symbol("MERCHANT_REPOSITORY");

export interface MerchantRepository {
  getProfile(merchantId: string): Promise<MerchantProfile | undefined>;
  getRules(merchantId: string): Promise<MerchantRules>;
  updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules>;
}
