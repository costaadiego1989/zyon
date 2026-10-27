import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { billingOffer, type BillingCycle, type BillingOffer } from "@zyon/shared-types";
import { BILLING_PLANS } from "../domain/billing-plans.js";
import type { BillingPlan } from "../domain/payment-platform.types.js";

export function annualBillingConfig(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.BILLING_ANNUAL_DISCOUNT_PERCENT?.trim() ?? "15";
  const discountPercent = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  return { enabled: env.BILLING_ANNUAL_ENABLED?.trim() === "true" && Number.isInteger(discountPercent) &&
    discountPercent >= 0 && discountPercent < 100, discountPercent };
}

export function quoteBilling(plan: BillingPlan, cycle: BillingCycle = "monthly", env: NodeJS.ProcessEnv = process.env): BillingOffer {
  if (!Object.hasOwn(BILLING_PLANS, plan) || !["monthly", "annual"].includes(cycle)) {
    throw new BadRequestException("invalid_billing_selection");
  }
  const annual = annualBillingConfig(env);
  if (cycle === "annual" && (plan === "starter" || !annual.enabled)) {
    throw new ServiceUnavailableException({ code: "billing_annual_unavailable", detail: "A assinatura anual não está disponível no momento. Escolha a opção mensal." });
  }
  return billingOffer(Math.round(BILLING_PLANS[plan].monthlyPriceBrl * 100), cycle, cycle === "annual" ? annual.discountPercent : 0);
}

export function billingOffers(plan: BillingPlan, env: NodeJS.ProcessEnv = process.env): BillingOffer[] {
  const offers = [quoteBilling(plan, "monthly", env)];
  if (plan !== "starter" && annualBillingConfig(env).enabled) offers.push(quoteBilling(plan, "annual", env));
  return offers;
}
