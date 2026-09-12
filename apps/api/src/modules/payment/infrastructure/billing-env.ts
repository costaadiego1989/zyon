import { ServiceUnavailableException } from "@nestjs/common";
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
    throw new ServiceUnavailableException({
      code: "billing_plan_not_configured",
      detail: "A assinatura deste plano ainda não está configurada. Tente novamente em alguns minutos.",
    });
  }
  return priceId;
}

export function merchantConsoleUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.MERCHANT_CONSOLE_URL?.trim() || env.DASHBOARD_URL?.trim();

  if (env.NODE_ENV !== "production") {
    return new URL(configured || "http://localhost:5175").origin;
  }

  if (!configured) {
    throw new ServiceUnavailableException({
      code: "merchant_console_url_not_configured",
      detail: "O retorno da assinatura ainda não está configurado. Tente novamente em alguns minutos.",
    });
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ServiceUnavailableException({
      code: "merchant_console_url_invalid",
      detail: "O retorno da assinatura ainda não está configurado. Tente novamente em alguns minutos.",
    });
  }

  if (url.protocol !== "https:") {
    throw new ServiceUnavailableException({
      code: "merchant_console_https_required",
      detail: "O retorno da assinatura ainda não está configurado. Tente novamente em alguns minutos.",
    });
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
