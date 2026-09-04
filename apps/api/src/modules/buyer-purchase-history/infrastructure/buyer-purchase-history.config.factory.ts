/**
 * Factory used by NestJS module providers to build BuyerPurchaseHistoryConfig
 * from environment variables. Centralizes the `process.env` reads so the
 * application layer never sees them.
 */
import type { BuyerPurchaseHistoryConfig } from "../domain/buyer-purchase-history.config.js";

export function createBuyerPurchaseHistoryConfig(): BuyerPurchaseHistoryConfig {
  return {
    meterFirstTimeLookups: process.env.METER_FIRST_TIME_LOOKUPS === "true"
  };
}