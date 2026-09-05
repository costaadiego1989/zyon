import test from "node:test";
import assert from "node:assert/strict";
import { effectiveBillingPlan, freeTrialState, merchantTransactionFeeCentsFor } from "../domain/billing-plans.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import { StartTrialUseCase } from "./payment-platform/billing/start-trial.use-case.js";
import { HandleStripePlatformEventUseCase } from "./payment-platform/platform-events/handle-stripe-platform-event.use-case.js";
import { GetBillingSubscriptionUseCase } from "./payment-platform/billing/get-billing-subscription.use-case.js";
import { BillingEntityMapper } from "../../public-api/billing/application/mappers/billing-entity.mapper.js";

test("cancellation of an older subscription does not replace the current subscription", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await repository.saveBilling({ merchantId: "paid", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_current", status: "active", stripePriceId: "scale" });
  await new HandleStripePlatformEventUseCase(repository).subscriptionUpdated({ merchantId: "paid", customerId: "cus_1", subscriptionId: "sub_old", status: "cancelled", cancelAtPeriodEnd: false });
  assert.equal((await repository.getBilling("paid"))?.stripeSubscriptionId, "sub_current");
  assert.equal(effectiveBillingPlan(await repository.getBilling("paid")), "scale");
});

test("Free trial changes fee at the exact expiry without blocking the Free plan", () => {
  const end = new Date("2026-09-19T12:00:00Z");
  const sub = { status: "trialing" as const, trialEndsAt: end.toISOString(), planKey: "starter" as const };
  assert.equal(merchantTransactionFeeCentsFor(sub, new Date(end.getTime() - 1)), 0);
  assert.equal(merchantTransactionFeeCentsFor(sub, end), 299);
  assert.equal(freeTrialState(sub, end).expired, true);
  assert.equal(effectiveBillingPlan(sub, end), "starter");
});

test("Free selection never resets an expired trial and keeps its date", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const end = "2020-01-01T00:00:00.000Z";
  await repository.saveBilling({ merchantId: "trial", status: "trialing", trialEndsAt: end });
  await new StartTrialUseCase(repository).execute("trial");
  await new StartTrialUseCase(repository).execute("trial");
  const sub = await repository.getBilling("trial");
  assert.equal(sub?.status, "starter");
  assert.equal(sub?.trialEndsAt, end);
  assert.equal(merchantTransactionFeeCentsFor(sub), 299);
});

test("checkout completion does not grant paid access; subscription status does", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const events = new HandleStripePlatformEventUseCase(repository);
  await events.checkoutCompleted({ merchantId: "paid", customerId: "cus_1", subscriptionId: "sub_1" });
  assert.equal(effectiveBillingPlan(await repository.getBilling("paid")), "starter");
  await events.subscriptionUpdated({ merchantId: "paid", customerId: "cus_1", subscriptionId: "sub_1", priceId: "growth", status: "active", cancelAtPeriodEnd: true });
  await new StartTrialUseCase(repository).execute("paid");
  const sub = await repository.getBilling("paid");
  assert.equal(effectiveBillingPlan(sub), "growth");
  assert.equal(freeTrialState(sub).expired, false);
  assert.equal(sub?.cancelAtPeriodEnd, true);
  await events.subscriptionUpdated({ customerId: "cus_1", subscriptionId: "sub_1", priceId: "growth", status: "cancelled", cancelAtPeriodEnd: false });
  assert.equal(effectiveBillingPlan(await repository.getBilling("paid")), "starter");
});

test("billing API returns the plan, trial and portal fields needed by dashboard", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await repository.saveBilling({ merchantId: "contract", status: "starter", trialEndsAt: "2020-01-01T00:00:00Z" });
  const snapshot = await new GetBillingSubscriptionUseCase(repository).execute("contract");
  const response = BillingEntityMapper.toSubscriptionResponse(snapshot);
  assert.equal(response.plan, "starter");
  assert.equal(response.plan_name, "Free");
  assert.equal(response.trial_expired, true);
  assert.equal(response.transaction_fee_cents, 299);
  assert.equal(response.has_billing_customer, false);
  assert.ok(response.limits);
});
