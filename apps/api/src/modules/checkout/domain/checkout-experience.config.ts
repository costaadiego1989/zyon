/**
 * Configuration interface for checkout experience builder.
 *
 * Holds environment-derived values that were previously read via `process.env`
 * inside the application/service layer. Resolved once at module init and
 * injected via DI — application code never touches `process.env` directly.
 */
export interface CheckoutExperienceConfig {
  /**
   * Platform service fee in BRL applied to checkout totals.
   * Defaults to "1.99" when `PLATFORM_FEE_BRL` is unset/invalid.
   */
  platformFeeBrl: number;
}

export const CHECKOUT_EXPERIENCE_CONFIG = Symbol.for("CheckoutExperienceConfig");