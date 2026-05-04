import type { CheckoutSettingsContext } from "@aacp/shared-types";

export const CHECKOUT_SETTINGS_CONTEXT_PORT = Symbol("CHECKOUT_SETTINGS_CONTEXT_PORT");

export interface CheckoutSettingsContextPort {
  getContext(merchantId: string): Promise<CheckoutSettingsContext | undefined>;
}
