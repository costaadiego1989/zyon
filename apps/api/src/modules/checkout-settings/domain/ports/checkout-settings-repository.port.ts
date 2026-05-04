import type { CheckoutSettings } from "@aacp/shared-types";

export const CHECKOUT_SETTINGS_REPOSITORY = Symbol("CHECKOUT_SETTINGS_REPOSITORY");

export interface CheckoutSettingsRepository {
  get(merchantId: string): Promise<CheckoutSettings | undefined>;
  save(settings: CheckoutSettings): Promise<CheckoutSettings>;
  delete(merchantId: string): Promise<void>;
}
