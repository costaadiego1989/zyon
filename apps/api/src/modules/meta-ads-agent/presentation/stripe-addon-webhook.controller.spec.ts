import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { applicationFixture } from "../application/__tests__/fixture.js";
import { BillingService } from "../application/billing.service.js";
import { MetaAdsAgentService } from "../application/meta-ads-agent.service.js";
import { StripeAddonAdapter } from "../infrastructure/stripe-addon.adapter.js";
import { readOffer } from "../domain/offer.js";
import { StripeAddonWebhookController } from "./stripe-addon-webhook.controller.js";
import { MetaAdsHttpErrorFilter } from "./meta-ads-agent.controller.js";
test("addon webhook validates actual rawBody signature, reads provider truth and credits a paid period once", async () => {
  const f = await applicationFixture(); let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined; let reads = 0;
  try {
    const sdk = new Stripe("sk_test_local", { apiVersion: "2026-04-22.dahlia" });
    const metadata = { zyon_module: "meta_ads_agent", merchant_id: "store-a", contract_id: "contract-a", offer_version: readOffer({}).version, accepted_amount_cents: "14900", kind: "subscription" };
    const client = { webhooks: sdk.webhooks, invoices: { retrieve: async () => { reads++; return { id: "in_addon", status: "paid", amount_paid: 14900, currency: "brl", customer: "cus_a", parent: { subscription_details: { subscription: "sub_addon" } }, lines: { data: [{ period: { start: 1793491200, end: 1796083200 } }] } }; } }, subscriptions: { retrieve: async () => ({ id: "sub_addon", customer: "cus_a", status: "active", metadata, items: { data: [{ quantity: 1, price: { id: "price_addon", active: true, currency: "brl", billing_scheme: "per_unit", unit_amount: 14900, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } } }] } }) } };
    const adapter = new StripeAddonAdapter({ META_ADS_STRIPE_WEBHOOK_SECRET: "whsec_local" }, client as unknown as Stripe); const billing = new BillingService(f.repo, f.commerce, adapter, () => readOffer({}), f.clock);
    await f.repo.mutate("store-a", [], state => { state.subscription!.providerSubscriptionId = "sub_addon"; state.credits.monthlyAvailable = 0; return { result: null }; });
    @Module({ controllers: [StripeAddonWebhookController], providers: [{ provide: MetaAdsAgentService, useValue: { billing } }, MetaAdsHttpErrorFilter] }) class WebhookTestModule {}
    app = await NestFactory.create(WebhookTestModule, { logger: false, rawBody: true }); await app.listen(0, "127.0.0.1"); const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/webhooks/stripe/meta-ads-agent`;
    const payload = JSON.stringify({ id: "evt_addon", object: "event", type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: { id: "in_addon", amount_paid: 1 } } }); const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: "whsec_local" });
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "invalid" }, body: payload })).status, 400); assert.equal(reads, 0); assert.equal((await f.repo.read("store-a")).credits.monthlyAvailable, 0);
    for (let i = 0; i < 2; i++) assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body: payload })).status, 200);
    const state = await f.repo.read("store-a"); assert.equal(state.credits.monthlyAvailable, 30); assert.equal(state.subscription!.offer.monthlyPriceCents, 14900); assert.equal(state.subscription!.providerSubscriptionId, "sub_addon"); assert.equal((await f.repo.read("store-b")).subscription, null); assert.equal((await f.repo.listRecords("store-a", "billing_period")).length, 1); assert.equal(reads, 2);
  } finally { await app?.close(); await f.close(); }
});
