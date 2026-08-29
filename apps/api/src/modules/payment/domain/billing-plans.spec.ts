import test from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_PLANS,
  BUYER_SERVICE_FEE_CENTS,
  effectiveBillingPlan,
  merchantTransactionFeeCentsFor,
} from "./billing-plans.js";

test("BILLING_PLANS matches current pricing: starter R$0/mês + R$1,99/venda, growth R$249/mês + R$1,49/venda, scale R$599/mês + R$0,99/venda", () => {
  // Starter
  assert.equal(BILLING_PLANS.starter.monthlyPriceBrl, 0);
  assert.equal(BILLING_PLANS.starter.transactionFeeCents, 199);
  assert.equal(BILLING_PLANS.starter.limits.ordersPerMonth, 100);
  assert.equal(BILLING_PLANS.starter.limits.webhookEndpoints, null);
  assert.equal(BILLING_PLANS.starter.limits.crossSellPromotions, 1);
  assert.equal(BILLING_PLANS.starter.features.customAgentName, true);
  assert.equal(BILLING_PLANS.starter.features.whiteLabel, false); // Free mostra badge
  assert.equal(BILLING_PLANS.starter.features.publicApiV1, false);
  assert.equal(BILLING_PLANS.starter.features.abTests, false);

  // Growth
  assert.equal(BILLING_PLANS.growth.monthlyPriceBrl, 249);
  assert.equal(BILLING_PLANS.growth.transactionFeeCents, 149);
  assert.equal(BILLING_PLANS.growth.limits.sessionsPerMonth, 1_000);
  assert.equal(BILLING_PLANS.growth.limits.commerceConnections, 2);
  assert.equal(BILLING_PLANS.growth.features.whiteLabel, true); // paga = remove badge
  assert.equal(BILLING_PLANS.growth.features.publicApiV1, true);
  assert.equal(BILLING_PLANS.growth.features.voiceCheckout, true);
  assert.equal(BILLING_PLANS.growth.features.abTests, false);

  // Scale
  assert.equal(BILLING_PLANS.scale.monthlyPriceBrl, 599);
  assert.equal(BILLING_PLANS.scale.transactionFeeCents, 99);
  assert.equal(BILLING_PLANS.scale.limits.ordersPerMonth, null);
  assert.equal(BILLING_PLANS.scale.features.whiteLabel, true);
  assert.equal(BILLING_PLANS.scale.features.publicApiV1, true);
  assert.equal(BILLING_PLANS.scale.features.abTests, true);
  assert.equal(BILLING_PLANS.scale.features.marketplace, true);
  assert.equal(BILLING_PLANS.scale.features.intentMemory, true);
  assert.equal(BILLING_PLANS.scale.features.revenueLift, true);
});

test("buyer service fee é fixo, independe do plano", () => {
  assert.equal(BUYER_SERVICE_FEE_CENTS, 99);
});

test("trial usa Starter plan e fee fixo de Starter", () => {
  const trial = {
    status: "trialing" as const,
    trialEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    stripePriceId: undefined,
  };
  assert.equal(effectiveBillingPlan(trial), "starter");
  assert.equal(merchantTransactionFeeCentsFor(trial), 199);
});

test("expired or inactive subscriptions fall back to Starter", () => {
  assert.equal(effectiveBillingPlan({ status: "cancelled", stripePriceId: undefined }), "starter");
  assert.equal(effectiveBillingPlan({ status: "trialing", trialEndsAt: "2020-01-01T00:00:00.000Z", stripePriceId: undefined }), "starter");
  assert.equal(merchantTransactionFeeCentsFor({ status: "cancelled", stripePriceId: undefined }), 199);
});
