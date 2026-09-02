import { BadRequestException } from "@nestjs/common";
import type {
  BillingConfigPort,
} from "../domain/ports/payment-platform-provider.port.js";
import type { BillingPlan } from "../domain/payment-platform.types.js";

const PRICE_ENV: Record<BillingPlan, string> = {
  starter: "STRIPE_BILLING_PRICE_STARTER",
  growth: "STRIPE_BILLING_PRICE_GROWTH",
  scale: "STRIPE_BILLING_PRICE_SCALE",
};

export function billingPriceId(
  plan: BillingPlan,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const priceId = env[PRICE_ENV[plan]]?.trim();
  if (!priceId) {
    // In dev, fall back to plan name — Stripe adapter will use it for sandbox testing
    if (env.NODE_ENV !== "production") {
      return plan;
    }
    throw new BadRequestException("billing_plan_not_configured");
  }
  return priceId;
}

export function merchantConsoleUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.MERCHANT_CONSOLE_URL?.trim() || env.DASHBOARD_URL?.trim();

  // Dev/test: fall back to the local dashboard so onboarding return URLs work
  // out of the box. Production: the console URL MUST come from env — no
  // hardcoded fallback that could silently send buyers to the wrong origin.
  if (env.NODE_ENV !== "production") {
    return new URL(configured || "http://localhost:5175").origin;
  }

  if (!configured) {
    throw new Error("merchant_console_url_not_configured");
  }
  const url = new URL(configured);
  if (url.protocol !== "https:") {
    throw new Error("merchant_console_https_required");
  }
  return url.origin;
}

export class EnvironmentBillingConfig implements BillingConfigPort {
  priceId(plan: BillingPlan): string {
    return billingPriceId(plan);
  }

  consoleUrl(): string {
    return merchantConsoleUrl();
  }
}
