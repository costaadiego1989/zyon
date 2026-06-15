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
    throw new BadRequestException("billing_plan_not_configured");
  }
  return priceId;
}

export function merchantConsoleUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.MERCHANT_CONSOLE_URL?.trim() || "http://localhost:5173";
  const url = new URL(raw);
  if (
    env.NODE_ENV === "production" &&
    url.protocol !== "https:"
  ) {
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
