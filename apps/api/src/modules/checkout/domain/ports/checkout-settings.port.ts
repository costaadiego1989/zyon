import type { CheckoutSettingsContext } from "@zyon/shared-types";

export const CHECKOUT_SETTINGS_PORT = Symbol("CHECKOUT_SETTINGS_PORT");

export interface CheckoutSettingsPort {
  getContext(merchantId: string): Promise<CheckoutSettingsContext | undefined>;
}
