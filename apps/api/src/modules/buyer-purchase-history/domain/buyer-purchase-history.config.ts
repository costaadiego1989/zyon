/**
 * Configuration interface for buyer purchase history use cases.
 *
 * Holds environment-derived values that were previously read via `process.env`
 * inside the application layer. Resolved once at module init and injected via
 * DI — application code never touches `process.env` directly.
 */
export interface BuyerPurchaseHistoryConfig {
  /**
   * Whether to record metering events for first-time (unknown) buyer lookups.
   * Defaults to false when `METER_FIRST_TIME_LOOKUPS` is unset.
   */
  meterFirstTimeLookups: boolean;
}

export const BUYER_PURCHASE_HISTORY_CONFIG = Symbol.for("BuyerPurchaseHistoryConfig");