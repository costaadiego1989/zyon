import test from "node:test";
import assert from "node:assert/strict";
import { effectiveBillingPlan, freeTrialState, merchantTransactionFeeCentsFor } from "../domain/billing-plans.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import { StartTrialUseCase } from "./payment-platform/billing/start-trial.use-case.js";
import { SubscribeToPlanUseCase } from "./payment-platform/billing/subscribe-to-plan.use-case.js";
import { HandleAsaasBillingWebhookUseCase } from "./payment-platform/billing/handle-asaas-billing-webhook.use-case.js";
import { HandleStripePlatformEventUseCase } from "./payment-platform/platform-events/handle-stripe-platform-event.use-case.js";
import { GetBillingSubscriptionUseCase } from "./payment-platform/billing/get-billing-subscription.use-case.js";
import { BillingEntityMapper } from "../../public-api/billing/application/mappers/billing-entity.mapper.js";
import type { BillingProviderPort, CreateSubscriptionInput } from "../domain/ports/billing-provider.port.js";
import { quoteBilling } from "../infrastructure/billing-offers.js";

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
  assert.equal(merchantTransactionFeeCentsFor(sub, end), 199);
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
  assert.equal(merchantTransactionFeeCentsFor(sub), 199);
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

test("Asaas subscription creation does not grant paid access before the first confirmed charge", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-15T12:00:00.000Z") });
  const repository = new InMemoryPaymentPlatformRepository();
  const subscriptions: CreateSubscriptionInput[] = [];
  const provider = {
    async createCustomer() { return { customerId: "cus_asaas_1" }; },
    async createSubscription(input: CreateSubscriptionInput) {
      subscriptions.push(input);
      // Provider recurrence being ACTIVE does not prove its first charge paid.
      return { subscriptionId: "sub_asaas_1", status: "ACTIVE" };
    },
    async updateSubscription() { assert.fail("Subscription creation must not update another recurrence"); },
    async ensureSubscriptionInactive() { assert.fail("Subscription creation must not suspend a recurrence"); },
    async cancelSubscription() { assert.fail("Subscription creation must not cancel a recurrence"); },
    async getSubscription() { assert.fail("Subscription creation must not read a remote recurrence"); },
  } satisfies BillingProviderPort;
  const subscribe = new SubscribeToPlanUseCase(repository, provider);
  await subscribe.execute({
    merchantId: "asaas_pending",
    planKey: "growth",
    card: { holderName: "Merchant", number: "4111111111111111", expiryMonth: "12", expiryYear: "2030", ccv: "123" },
    holderInfo: { name: "Merchant", email: "merchant@example.test", cpfCnpj: "12345678909", postalCode: "01001000", addressNumber: "1", phone: "11999999999" },
  });

  const pending = await repository.getBilling("asaas_pending");
  const expectedAmount = quoteBilling("growth", "monthly").amountCents;
  assert.equal(pending?.status, "trialing");
  assert.equal(effectiveBillingPlan(pending), "starter");
  assert.equal(pending?.merchantId, "asaas_pending");
  assert.equal(pending?.asaasSubscriptionId, "sub_asaas_1");
  assert.equal(pending?.pendingUpgradeAmountCents, expectedAmount);
  assert.equal(pending?.pendingUpgradePlanKey, "growth");
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].valueBrl * 100, expectedAmount);

  const handler = new HandleAsaasBillingWebhookUseCase(repository);
  const payment = {
    event: "PAYMENT_CONFIRMED",
    subscriptionId: "sub_asaas_1",
    eventId: "evt_asaas_pending_confirmed",
    paymentId: "pay_asaas_pending",
    paymentValueCents: expectedAmount,
    paymentDueAt: "2026-09-15T00:00:00.000Z",
    occurredAt: "2026-09-15T12:00:00.000Z",
  };
  assert.deepEqual(await handler.execute(payment), { outcome: "processed", merchantId: "asaas_pending" });
  const active = await repository.getBilling("asaas_pending");
  assert.equal(active?.status, "active");
  assert.equal(effectiveBillingPlan(active), "growth");
  assert.equal(active?.merchantId, "asaas_pending");
  assert.equal(active?.asaasSubscriptionId, "sub_asaas_1");
  assert.equal(active?.billingAmountCents, expectedAmount);
  assert.equal(active?.currentPeriodEnd, "2026-10-15T00:00:00.000Z");
  assert.equal(active?.lastBillingPaymentId, payment.paymentId);
  assert.equal(active?.pendingUpgradePlanKey, undefined);

  // Exactly once within the repository's in-memory event/payment gate, not a
  // claim about PostgreSQL locks or live provider delivery.
  t.mock.timers.tick(60_000);
  assert.deepEqual(await handler.execute(payment), { outcome: "duplicate", merchantId: "asaas_pending" });
  assert.deepEqual(await handler.execute({ ...payment, eventId: "evt_received_later", event: "PAYMENT_RECEIVED" }), {
    outcome: "ignored", merchantId: "asaas_pending",
  });
  assert.deepEqual(await repository.getBilling("asaas_pending"), active);
});

for (const invalidAmount of [undefined, 0, 34_900, 44_899, 44_901, 44_900.5]) {
  test(`Asaas pending access rejects an invalid charge amount (${invalidAmount})`, async () => {
    const repository = new InMemoryPaymentPlatformRepository();
    await repository.saveBilling({
      merchantId: "pending_amount", provider: "asaas", asaasSubscriptionId: "sub_pending_amount",
      status: "incomplete", planKey: "starter", billingCycle: "monthly",
      billingAmountCents: 44_900, pendingUpgradePlanKey: "growth", pendingUpgradeAmountCents: 44_900,
    });
    const before = await repository.getBilling("pending_amount");
    const outcome = await new HandleAsaasBillingWebhookUseCase(repository).execute({
      event: "PAYMENT_CONFIRMED", subscriptionId: "sub_pending_amount", eventId: "evt_invalid_amount",
      paymentId: "pay_invalid_amount", paymentValueCents: invalidAmount,
      paymentDueAt: "2026-09-15T00:00:00.000Z", occurredAt: "2026-09-15T12:00:00.000Z",
    });
    assert.deepEqual(outcome, { outcome: "ignored", merchantId: "pending_amount" });
    assert.deepEqual(await repository.getBilling("pending_amount"), before);
    assert.equal(effectiveBillingPlan(await repository.getBilling("pending_amount")), "starter");
  });
}

test("Asaas confirmed charge is bound to the persisted subscription and cannot grant another merchant's pending plan", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  for (const merchantId of ["merchant_a", "merchant_b"]) {
    await repository.saveBilling({
      merchantId, provider: "asaas", asaasSubscriptionId: `sub_${merchantId}`,
      status: "incomplete", planKey: "starter", billingCycle: "monthly",
      billingAmountCents: 44_900, pendingUpgradePlanKey: "growth", pendingUpgradeAmountCents: 44_900,
    });
  }
  const beforeA = await repository.getBilling("merchant_a");
  const beforeB = await repository.getBilling("merchant_b");
  const handler = new HandleAsaasBillingWebhookUseCase(repository);
  const payment = {
    event: "PAYMENT_CONFIRMED", eventId: "evt_subscription_bound", paymentId: "pay_subscription_bound",
    paymentValueCents: 44_900, paymentDueAt: "2026-09-15T00:00:00.000Z", occurredAt: "2026-09-15T12:00:00.000Z",
  };
  assert.deepEqual(await handler.execute({ ...payment, subscriptionId: "sub_unknown" }), { outcome: "ignored" });
  assert.deepEqual(await repository.getBilling("merchant_a"), beforeA);
  assert.deepEqual(await repository.getBilling("merchant_b"), beforeB);
  assert.deepEqual(await handler.execute({ ...payment, subscriptionId: "sub_merchant_a" }), {
    outcome: "processed", merchantId: "merchant_a",
  });
  assert.equal((await repository.getBilling("merchant_a"))?.status, "active");
  assert.equal((await repository.getBilling("merchant_a"))?.currentPeriodEnd, "2026-10-15T00:00:00.000Z");
  assert.deepEqual(await repository.getBilling("merchant_b"), beforeB);
});

test("billing API returns the plan, trial and portal fields needed by dashboard", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await repository.saveBilling({ merchantId: "contract", status: "starter", trialEndsAt: "2020-01-01T00:00:00Z" });
  const snapshot = await new GetBillingSubscriptionUseCase(repository).execute("contract");
  const response = BillingEntityMapper.toSubscriptionResponse(snapshot);
  assert.equal(response.plan, "starter");
  assert.equal(response.plan_name, "Free");
  assert.equal(response.trial_expired, true);
  assert.equal(response.transaction_fee_cents, 199);
  assert.equal(response.has_billing_customer, false);
  assert.ok(response.limits);
});
