import assert from "node:assert/strict";
import test from "node:test";
import { BillingController, toBillingResponse } from "./payment-platform.controller.js";

function subscription(ids: {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  asaasCustomerId?: string;
  asaasSubscriptionId?: string;
}) {
  return {
    plan: "growth",
    planName: "Growth",
    monthlyPriceBrl: 99,
    transactionFeeCents: 0,
    buyerServiceFeeCents: 0,
    limits: {},
    features: {},
    status: "active",
    provider: ids.asaasSubscriptionId ? "asaas" : "stripe",
    trialEndsAt: null,
    trialExpired: false,
    trialDaysRemaining: 0,
    currentPeriodEnd: "2026-10-24T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    ...ids,
  } as Parameters<typeof toBillingResponse>[0];
}

test("billing response reports a usable active subscription for either provider", () => {
  const asaas = toBillingResponse(subscription({
    asaasCustomerId: "cus_asaas",
    asaasSubscriptionId: "sub_asaas",
  }));
  const stripe = toBillingResponse(subscription({
    stripeCustomerId: "cus_stripe",
    stripeSubscriptionId: "sub_stripe",
  }));

  assert.equal(asaas.billing_provider, "asaas");
  assert.equal(asaas.has_billing_customer, true);
  assert.equal(asaas.has_subscription, true);
  assert.equal(stripe.billing_provider, "stripe");
  assert.equal(stripe.has_billing_customer, true);
  assert.equal(stripe.has_subscription, true);
});

test("billing plan change forwards the selected billing cycle", async () => {
  const received: unknown[] = [];
  const controller = new BillingController(
    { execute: async () => subscription({ asaasSubscriptionId: "sub_asaas" }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { execute: async (input: unknown) => { received.push(input); } } as never,
    {} as never,
  );

  await controller.changePlanRoute({
    tenantPrincipal: { kind: "human", tenantId: "merchant", userId: "user", email: "owner@example.test", role: "owner" },
  }, { targetPlan: "scale", billingCycle: "annual" });

  assert.deepEqual(received, [{ merchantId: "merchant", targetPlanKey: "scale", billingCycle: "annual" }]);
});
