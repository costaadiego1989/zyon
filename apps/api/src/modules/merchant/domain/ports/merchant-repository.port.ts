import type { MerchantProfile, MerchantRules, MerchantTheme, MerchantStoreSettings } from "../merchant.types.js";

export const MERCHANT_REPOSITORY = Symbol("MERCHANT_REPOSITORY");

export interface MerchantRepository {
  getProfile(merchantId: string): Promise<MerchantProfile | undefined>;
  getStripeConnectAccountId(merchantId: string): Promise<string | undefined>;
  setStripeConnectAccountId(merchantId: string, accountId: string): Promise<void>;
  getRules(merchantId: string): Promise<MerchantRules>;
  updateRules(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules>;
  updateTheme(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme>;
  updateStoreCategory(merchantId: string, storeCategory: string): Promise<void>;
  getStoreSettings(merchantId: string): Promise<MerchantStoreSettings>;
  updateStoreSettings(merchantId: string, settings: MerchantStoreSettings): Promise<MerchantStoreSettings>;
  /** Delivery feature: fetch raw merchant row (includes Melhor Envio token fields). Optional for test stubs. */
  getById?(merchantId: string): Promise<any | null>;
  /** Delivery feature: toggle Melhor Envio carrier. Optional for test stubs. */
  updateMelhorEnvioEnabled?(merchantId: string, enabled: boolean): Promise<void>;
}
