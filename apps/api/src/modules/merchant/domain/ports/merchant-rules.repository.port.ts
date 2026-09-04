import type { MerchantRules } from "@zyon/shared-types";

export const MERCHANT_RULES_REPOSITORY = Symbol("MERCHANT_RULES_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface MerchantRulesRepository {
  getRules(merchantId: string): MaybePromise<MerchantRules>;
  updateRules(merchantId: string, rules: Partial<MerchantRules>): MaybePromise<MerchantRules>;
}
