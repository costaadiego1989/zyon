import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";
import { HandleStripeWebhookUseCase } from "../../payment/application/handle-stripe-webhook.use-case.js";
import { HandleStripePlatformEventUseCase } from "../../payment/application/payment-platform/platform-events/handle-stripe-platform-event.use-case.js";
import { InMemoryPaymentRepository } from "../../payment/infrastructure/in-memory-payment.repository.js";
import { InMemoryPaymentPlatformRepository } from "../../payment/infrastructure/in-memory-payment-platform.repository.js";
import { StripePlatformAdapter } from "../../payment/infrastructure/stripe-platform.adapter.js";
test("base billing ignores signed addon metadata and actual addon subscriptions without changing base contract", async () => {
  const billing = new InMemoryPaymentPlatformRepository(); await billing.saveBilling({ merchantId: "store-a", provider: "stripe", stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_base", planKey: "growth", billingAmountCents: 34900, status: "active" }); const before = await billing.getBilling("store-a");
  const events = new HandleStripePlatformEventUseCase(billing); const uc = Object.create(HandleStripeWebhookUseCase.prototype) as HandleStripeWebhookUseCase;
  Object.assign(uc, { payments: new InMemoryPaymentRepository(), platformEvents: events, logger: { error: () => undefined }, billingStripe: { retrieveBillingSubscription: async () => ({ merchantId: "store-a", module: "meta_ads_agent", customerId: "cus_a", subscriptionId: "sub_addon", status: "active", cancelAtPeriodEnd: false, billingAmountCents: 14900 }) } });
  const metadata = { merchant_id: "store-a", zyon_module: "meta_ads_agent" };
  const objects = [
    { type: "checkout.session.completed", object: { id: "cs_addon", mode: "subscription", subscription: "sub_addon", customer: "cus_a", metadata } },
    { type: "customer.subscription.updated", object: { id: "sub_addon", metadata } },
    { type: "invoice.paid", object: { id: "in_addon", parent: { subscription_details: { subscription: "sub_addon", metadata } } } },
    { type: "checkout.session.completed", object: { id: "cs_without_metadata", mode: "subscription", subscription: "sub_addon", customer: "cus_a", metadata: { merchant_id: "store-a" } } },
    { type: "customer.subscription.updated", object: { id: "sub_addon", metadata: {} } },
    { type: "invoice.paid", object: { id: "in_without_metadata", parent: { subscription_details: { subscription: "sub_addon" } } } },
  ];
  for (const [index, value] of objects.entries()) { const result = await uc.dispatchEvent({ id: `evt_isolation_${index}`, type: value.type, data: { object: value.object } } as unknown as Stripe.Event); assert.match(JSON.stringify(result), /non_base_billing_module/); assert.deepEqual(await billing.getBilling("store-a"), before); }
});
test("Stripe base subscription projection preserves module ownership for downstream guards", async () => {
  const adapter = new StripePlatformAdapter("sk_test_local"); Object.assign(adapter, { stripe: { subscriptions: { retrieve: async () => ({ id: "sub_addon", customer: "cus_a", metadata: { merchant_id: "store-a", zyon_module: "meta_ads_agent" }, items: { data: [] }, status: "active", cancel_at_period_end: false }) } } }); const subscription = await adapter.retrieveBillingSubscription("sub_addon"); assert.equal(subscription.module, "meta_ads_agent"); assert.equal(subscription.subscriptionId, "sub_addon");
});
test("base platform events also reject addon ownership when invoked outside the webhook dispatcher", async () => {
  const billing = new InMemoryPaymentPlatformRepository(); await billing.saveBilling({ merchantId: "store-a", planKey: "growth", status: "active", stripeSubscriptionId: "sub_base" }); const before = await billing.getBilling("store-a");
  await new HandleStripePlatformEventUseCase(billing).subscriptionUpdated({ merchantId: "store-a", module: "meta_ads_agent", customerId: "cus_a", subscriptionId: "sub_addon", status: "active", cancelAtPeriodEnd: false, billingAmountCents: 14900 });
  assert.deepEqual(await billing.getBilling("store-a"), before);
});
