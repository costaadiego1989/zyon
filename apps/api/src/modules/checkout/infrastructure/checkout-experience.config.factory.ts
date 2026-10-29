/**
 * Factory used by NestJS module providers to build CheckoutExperienceConfig
 * from environment variables. Centralizes the `process.env` reads so the
 * application/service layer never sees them.
 */
import type { CheckoutExperienceConfig } from "../domain/checkout-experience.config.js";
import { readPlatformFeeBrl } from "../../../shared/config/platform-fee.config.js";

export function createCheckoutExperienceConfig(env: NodeJS.ProcessEnv = process.env): CheckoutExperienceConfig {
  return {
    platformFeeBrl: readPlatformFeeBrl(env)
  };
}
