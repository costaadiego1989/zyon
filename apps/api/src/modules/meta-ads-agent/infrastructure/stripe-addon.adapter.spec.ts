import assert from "node:assert/strict";
import { test } from "node:test";
import Stripe from "stripe";
import { readOffer } from "../domain/offer.js";
import type { BillingCheckoutRequest } from "../domain/types.js";
import { StripeAddonAdapter } from "./stripe-addon.adapter.js";

const env = { META_ADS_STRIPE_SECRET_KEY: "sk_test_local", META_ADS_STRIPE_WEBHOOK_SECRET: "whsec_local", META_ADS_STRIPE_MONTHLY_PRICE_ID: "price_addon", META_ADS_DASHBOARD_URL: "https://dashboard.example.test", NODE_ENV: "test" };
const price = { id: "price_addon", active: true, currency: "brl", unit_amount: 14900, billing_scheme: "per_unit", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
const metadata = { zyon_module: "meta_ads_agent", merchant_id: "store-a", contract_id: "contract-a", offer_version: readOffer({}).version, accepted_amount_cents: "14900", kind: "subscription" };
const checkoutInput: BillingCheckoutRequest = { merchantId: "store-a", contractId: "contract-a", idempotencyKey: "meta-ads:store-a:request-a", kind: "subscription", offer: readOffer({}), profile: { name: "Loja", email: "owner@example.test", storefrontUrl: "https://store.example.test", stripeCustomerId: null } };
function fixture(overrides: { price?: unknown; subscription?: unknown; invoice?: unknown; session?: unknown; payment?: unknown } = {}) {
  const creations: Array<{ params: Record<string, unknown>; options: unknown }> = []; const reads: string[] = []; const updates: unknown[] = [];
  const sdk = new Stripe("sk_test_local", { apiVersion: "2026-04-22.dahlia" });
  const client = {
    webhooks: sdk.webhooks,
    prices: { retrieve: async () => overrides.price ?? price },
    checkout: { sessions: {
      create: async (params: Record<string, unknown>, options: unknown) => { creations.push({ params, options }); const extra = params.mode === "payment"; return { id: "cs_addon", url: "https://checkout.stripe.com/c/pay/local", amount_total: extra ? 3900 : 14900, currency: "brl" }; },
      retrieve: async () => { reads.push("session"); return overrides.session ?? { id: "cs_extra", mode: "payment", payment_status: "paid", amount_total: 3900, currency: "brl", metadata: { ...metadata, kind: "extra_images", accepted_amount_cents: "3900" }, payment_intent: "pi_extra", customer: "cus_a" }; },
    } },
    subscriptions: { retrieve: async () => { reads.push("subscription"); return overrides.subscription ?? { id: "sub_addon", status: "active", customer: "cus_a", metadata, items: { data: [{ price, quantity: 1 }] } }; }, update: async (...args: unknown[]) => { updates.push(args); return {}; } },
    invoices: { retrieve: async () => { reads.push("invoice"); return overrides.invoice ?? { id: "in_addon", status: "paid", amount_paid: 14900, currency: "brl", customer: "cus_a", parent: { subscription_details: { subscription: "sub_addon" } }, lines: { data: [{ period: { start: 1793491200, end: 1796083200 } }] } }; } },
    paymentIntents: { retrieve: async () => { reads.push("payment"); return overrides.payment ?? { id: "pi_extra", status: "succeeded", amount_received: 3900, currency: "brl", metadata: { ...metadata, kind: "extra_images", accepted_amount_cents: "3900" } }; } },
  };
  return { adapter: new StripeAddonAdapter(env, client as unknown as Stripe), creations, reads, updates, sdk };
}
function signed(sdk: Stripe, type: string, id: string) {
  const raw = Buffer.from(JSON.stringify({ id: `evt_${type}`, type, created: Math.floor(Date.now() / 1000), data: { object: { id } } }));
  return { raw, signature: sdk.webhooks.generateTestHeaderString({ payload: raw.toString(), secret: env.META_ADS_STRIPE_WEBHOOK_SECRET }) };
}
test("MGA-04 provider price, currency and monthly cadence must match the accepted offer before checkout", async () => {
  for (const invalid of [{ ...price, unit_amount: 19900 }, { ...price, currency: "usd" }, { ...price, recurring: { interval: "year", interval_count: 1 } }, { ...price, recurring: { interval: "month", interval_count: 2 } }, { ...price, active: false }]) {
    const f = fixture({ price: invalid }); await assert.rejects(f.adapter.createCheckout(checkoutInput), { code: "addon_provider_price_mismatch" }); assert.equal(f.creations.length, 0);
  }
});
test("Stripe checkout creates a separate monthly subscription with immutable module metadata", async () => {
  const f = fixture(); const result = await f.adapter.createCheckout(checkoutInput); const creation = f.creations[0];
  assert.equal(result.amountCents, 14900); assert.equal(result.currency, "BRL"); assert.equal(creation.params.mode, "subscription"); assert.deepEqual(creation.params.line_items, [{ price: "price_addon", quantity: 1 }]);
  assert.deepEqual((creation.params.subscription_data as Record<string, unknown>).metadata, metadata); assert.equal(creation.params.allow_promotion_codes, false);
  assert.deepEqual(creation.options, { idempotencyKey: checkoutInput.idempotencyKey });
});
test("Stripe extras use an explicitly purchased one-time pack without altering any subscription", async () => {
  const f = fixture(); const result = await f.adapter.createCheckout({ ...checkoutInput, kind: "extra_images" }); const params = f.creations[0].params;
  assert.equal(result.kind, "extra_images"); assert.equal(result.amountCents, 3900); assert.equal(params.mode, "payment"); assert.equal(params.subscription_data, undefined);
  const lines = params.line_items as Array<{ price_data: { unit_amount: number; currency: string } }>;
  assert.equal(lines[0].price_data.unit_amount, 3900); assert.equal(lines[0].price_data.currency, "brl"); assert.equal(f.updates.length, 0);
});
test("signed invoice processing retrieves provider truth and keeps the actual invoice period", async () => {
  const f = fixture(); const event = signed(f.sdk, "invoice.paid", "in_addon"); const result = await f.adapter.verifiedEvent(event.raw, event.signature);
  assert.equal(result!.merchantId, "store-a"); assert.equal(result!.contractId, "contract-a"); assert.equal(result!.subscriptionId, "sub_addon"); assert.equal(result!.paymentId, "in_addon"); assert.equal(result!.amountCents, 14900); assert.equal(result!.periodStart, new Date(1793491200000).toISOString()); assert.equal(result!.periodEnd, new Date(1796083200000).toISOString());
  assert.deepEqual(f.reads, ["invoice", "subscription"]);
});
test("Stripe rejects invalid signatures before any provider read and never trusts an unpaid event", async () => {
  const f = fixture({ invoice: { id: "in_addon", status: "open" } }); const event = signed(f.sdk, "invoice.paid", "in_addon");
  await assert.rejects(f.adapter.verifiedEvent(event.raw, "invalid"), { code: "addon_webhook_signature_invalid" }); assert.deepEqual(f.reads, []);
  await assert.rejects(f.adapter.verifiedEvent(event.raw, event.signature), { code: "addon_payment_not_confirmed" });
});
test("extras confirmation verifies the paid session and payment without inventing a subscription id", async () => {
  const f = fixture(); const event = signed(f.sdk, "checkout.session.completed", "cs_extra"); const result = await f.adapter.verifiedEvent(event.raw, event.signature);
  assert.equal(result!.kind, "extra_images_paid"); assert.equal(result!.checkoutId, "cs_extra"); assert.equal(result!.subscriptionId, null); assert.equal(result!.paymentId, "pi_extra"); assert.equal(result!.amountCents, 3900); assert.deepEqual(f.reads, ["session", "payment"]);
});
test("base-plan webhooks are ignored and cancellation only schedules addon renewal to stop", async () => {
  const f = fixture({ subscription: { id: "sub_base", metadata: { merchant_id: "store-a" } } }); const event = signed(f.sdk, "customer.subscription.deleted", "sub_base");
  assert.equal(await f.adapter.verifiedEvent(event.raw, event.signature), null);
  await f.adapter.cancelRenewal("sub_addon");
  assert.deepEqual(f.updates[0], ["sub_addon", { cancel_at_period_end: true }, { idempotencyKey: "meta-ads-cancel:sub_addon" }]);
});
