import type { CheckoutSettingsContext } from "@zyon/shared-types";

export const CHECKOUT_SETTINGS_PORT = Symbol("CHECKOUT_SETTINGS_PORT");

export interface InterventionPolicy {
  progressiveDiscount?: {
    enabled: boolean;
    stages?: {
      initial_coupon?: number;
      exit_intent?: number;
      abandoned_cart?: number;
      payment_nudge?: number;
    };
  };
}

export interface CheckoutSettingsPort {
  getContext(merchantId: string): Promise<CheckoutSettingsContext | undefined>;
  /**
   * Fetch intervention configuration (advanced rules + policy) for a merchant.
   * Used by checkout use-cases to configure rule-based nudges.
   */
  getInterventionConfig(
    merchantId: string
  ): Promise<{ advancedRules: unknown[] | null; interventionPolicy: InterventionPolicy | null }>;
}
