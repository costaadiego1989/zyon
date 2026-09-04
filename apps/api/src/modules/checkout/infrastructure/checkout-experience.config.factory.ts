/**
 * Factory used by NestJS module providers to build CheckoutExperienceConfig
 * from environment variables. Centralizes the `process.env` reads so the
 * application/service layer never sees them.
 */
import type { CheckoutExperienceConfig } from "../domain/checkout-experience.config.js";

const DEFAULT_PLATFORM_FEE_BRL = 1.99;

function resolvePlatformFeeBrl(): number {
  const raw = process.env.PLATFORM_FEE_BRL?.trim() || "1.99";
  const major = Number(raw.replace(",", "."));
  return Number.isFinite(major) && major >= 0 ? major : DEFAULT_PLATFORM_FEE_BRL;
}

export function createCheckoutExperienceConfig(): CheckoutExperienceConfig {
  return {
    platformFeeBrl: resolvePlatformFeeBrl()
  };
}