import test from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_PLANS,
  calculatePlatformFeeCents,
  effectiveBillingPlan,
  transactionFeePercentFor,
} from "./billing-plans.js";

test("BILLING_PLANS matches Starter/Growth/Scale commercial config", () => {
  assert.equal(BILLING_PLANS.starter.monthlyPriceBrl, 89);
  assert.equal(BILLING_PLANS.starter.transactionFeePercent, 1.99);
  assert.equal(BILLING_PLANS.starter.limits.ordersPerMonth, 50);
  assert.equal(BILLING_PLANS.starter.limits.webhookEndpoints, null);
  assert.equal(BILLING_PLANS.starter.limits.crossSellPromotions, 1);
  assert.equal(BILLING_PLANS.starter.limits.activeCoupons, 1);
  assert.equal(BILLING_PLANS.starter.features.customAgentName, true);
  assert.equal(BILLING_PLANS.starter.features.customTheme, true);
  assert.equal(BILLING_PLANS.starter.features.whiteLabel, true);

  assert.equal(BILLING_PLANS.growth.monthlyPriceBrl, 199);
  assert.equal(BILLING_PLANS.growth.transactionFeePercent, 1.49);
  assert.equal(BILLING_PLANS.growth.limits.sessionsPerMonth, 1_000);
  assert.equal(BILLING_PLANS.growth.limits.commerceConnections, 2);
  assert.equal(BILLING_PLANS.growth.limits.webhookEndpoints, null);
  assert.equal(BILLING_PLANS.growth.limits.crossSellPromotions, 10);
  assert.equal(BILLING_PLANS.growth.limits.activeCoupons, 10);
  assert.equal(BILLING_PLANS.growth.features.faceBiometry, true);
  assert.equal(BILLING_PLANS.growth.features.cryptoPayments, true);

  assert.equal(BILLING_PLANS.scale.monthlyPriceBrl, 499);
  assert.equal(BILLING_PLANS.scale.transactionFeePercent, 0.99);
  assert.equal(BILLING_PLANS.scale.limits.ordersPerMonth, null);
  assert.equal(BILLING_PLANS.scale.limits.webhookEndpoints, null);
  assert.equal(BILLING_PLANS.scale.features.cryptoPayments, true);
});

test("trial uses Starter plan and Starter transaction fee", () => {
  const trial = {
    status: "trialing" as const,
    trialEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    stripePriceId: undefined,
  };
  assert.equal(effectiveBillingPlan(trial), "starter");
  assert.equal(transactionFeePercentFor(trial), 1.99);
});

test("expired or inactive subscriptions fall back to Starter", () => {
  assert.equal(effectiveBillingPlan({ status: "cancelled", stripePriceId: undefined }), "starter");
  assert.equal(effectiveBillingPlan({ status: "trialing", trialEndsAt: "2020-01-01T00:00:00.000Z", stripePriceId: undefined }), "starter");
});

test("fee calculation uses percentage over order amount in cents", () => {
  assert.equal(calculatePlatformFeeCents(10_000, 1.99), 199);
  assert.equal(calculatePlatformFeeCents(10_000, 1.49), 149);
  assert.equal(calculatePlatformFeeCents(10_000, 0.99), 99);
});
