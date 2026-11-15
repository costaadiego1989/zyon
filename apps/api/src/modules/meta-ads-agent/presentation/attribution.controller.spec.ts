import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import type { CheckoutSession } from "@zyon/shared-types";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";
import { applicationFixture } from "../application/__tests__/fixture.js";
import { AttributionService } from "../application/attribution.service.js";
import { MetaAdsAgentService } from "../application/meta-ads-agent.service.js";
import { META_ADS_SESSION_BINDING, type MetaAccess, type PaidOrderFact } from "../domain/types.js";
import { CheckoutSessionBindingAdapter } from "../infrastructure/checkout-session-binding.adapter.js";
import { AttributionController } from "./attribution.controller.js";
import { MetaAdsHttpErrorFilter } from "./meta-ads-agent.controller.js";
async function fixture() {
  const f = await applicationFixture(); let sent = 0;
  await f.repo.mutate("store-a", [], state => { state.campaigns["campaign-a"] = { id: "campaign-a", draft: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: [], mediaIds: [], budget: null, country: "BR", headline: "", primaryText: "" }, products: [], createdByAgent: true, managed: true, remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], remoteAccountId: "100", status: "active_unconfirmed", createdAt: f.clock().toISOString(), updatedAt: f.clock().toISOString() }; state.connection.dataset = { id: "120", name: "Compras" }; return { result: null, records: [{ key: "campaign-origin:campaign-a", kind: "audit", payload: { source: "agent", campaignId: "campaign-a" }, createdAt: f.clock().toISOString() }] }; });
  const fact: PaidOrderFact = { merchantId: "store-a", orderId: "canonical-a", sessionId: "checkout-a", paid: true, paidAt: f.clock().toISOString(), currency: "BRL", paidCents: 10000, refundedCents: 0, costCents: null, costCoverage: "unavailable" };
  f.commerce.paidOrder = async (merchantId, orderId) => merchantId === "store-a" && ["canonical-a", "external-a"].includes(orderId) ? { ...fact } : null;
  const attribution = new AttributionService(f.repo, f.commerce, { access: async () => ({ accountId: "100", connectionEpoch: 1 } as MetaAccess) }, { send: async () => { sent++; return { status: "sent", error: null }; } }, Buffer.alloc(32, 3).toString("base64"), f.clock);
  const binding = new CheckoutSessionBindingAdapter({ getSession: async (merchantId, sessionId) => merchantId === "store-a" && ["checkout-a", "checkout-other"].includes(sessionId) ? { merchantId, sessionId, cart: { source: "storefront", cart_ref: sessionId === "checkout-a" ? "conversation-a" : "conversation-other" } } as unknown as CheckoutSession : undefined });
  const capabilities = new RealtimeCapabilityService("local-capability-test-secret-with-32-characters");
  @Module({ controllers: [AttributionController], providers: [{ provide: AttributionService, useValue: attribution }, { provide: MetaAdsAgentService, useValue: { repo: f.repo, commerce: f.commerce } }, { provide: META_ADS_SESSION_BINDING, useValue: binding }, { provide: RealtimeCapabilityService, useValue: capabilities }, MetaAdsHttpErrorFilter] }) class AttributionTestModule {}
  const app = await NestFactory.create(AttributionTestModule, { logger: false }); await app.listen(0, "127.0.0.1"); const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/storefront/conversations/conversation-a/meta-ads`;
  const token = capabilities.issue({ purpose: "storefront-conversation", merchantId: "store-a", resourceId: "conversation-a", origin: "https://store.example.test" }).token;
  const post = async (path: string, body: unknown, proof = token, origin = "https://store.example.test") => fetch(`${base}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${proof}`, Origin: origin, "Content-Type": "application/json", "User-Agent": "Actual-Test-Browser" }, body: JSON.stringify(body) });
  const capture = () => post("attribution", { token: attribution.trackingToken("store-a", "campaign-a"), consent: true, consentVersion: "storefront-v1", fbc: "fb.1.1794657600000.click", fbp: "fb.1.1794657600000.browser" });
  return { ...f, post, capture, attribution, capabilities, token, fact, sent: () => sent, closeHttp: async () => { await app.close(); await f.close(); } };
}
test("public attribution requires a signed capability bound to the exact origin, tenant and conversation", async () => {
  const f = await fixture(); try { assert.equal((await f.post("attribution", {}, "forged")).status, 401); assert.equal((await f.post("attribution", {}, f.token, "https://evil.example.test")).status, 401);
    const other = f.capabilities.issue({ purpose: "storefront-conversation", merchantId: "store-b", resourceId: "conversation-other", origin: "https://store.example.test" }).token; assert.equal((await f.post("attribution", {}, other)).status, 403); const expired = f.capabilities.issue({ purpose: "storefront-conversation", merchantId: "store-a", resourceId: "conversation-a", origin: "https://store.example.test" }, Math.floor(Date.now() / 1000) - 7200).token; assert.equal((await f.post("attribution", {}, expired)).status, 401);
    assert.equal((await f.capture()).status, 201); const record = (await f.repo.getRecord<{ sessionId: string; clientUserAgent: string }>("store-a", "attribution-session:conversation-a"))!; assert.equal(record.payload.sessionId, "conversation-a"); assert.equal(record.payload.clientUserAgent, "Actual-Test-Browser"); assert.equal(await f.repo.getRecord("store-b", record.key), null);
  } finally { await f.closeHttp(); }
});
test("server checkout proof binds the original receipt and canonical purchase alias shares the server event ID", async () => {
  const f = await fixture(); try { await f.capture(); assert.equal((await f.post("bind", { checkoutSessionId: "checkout-other" })).status, 403); assert.equal((await f.post("bind", { checkoutSessionId: "checkout-a" })).status, 201); const receipt = (await f.repo.getRecord<{ originSessionId: string }>("store-a", "attribution-session:checkout-a"))!; assert.equal(receipt.payload.originSessionId, "conversation-a");
    const response = await f.post("purchase", { checkoutSessionId: "checkout-a", orderId: "external-a" }); assert.equal(response.status, 201); const browser = await response.json(); const state = await f.repo.read("store-a"); assert.equal(browser.eventId, state.purchases!["canonical-a"].eventId); assert.equal(browser.valueCents, 10000); assert.equal(browser.currency, "BRL"); assert.equal(browser.pixelId, "120"); assert.equal(f.sent(), 1); await f.post("purchase", { checkoutSessionId: "checkout-a", orderId: "external-a" }); assert.equal(f.sent(), 1); assert.equal((await f.post("purchase", { checkoutSessionId: "checkout-other", orderId: "external-a" })).status, 403);
  } finally { await f.closeHttp(); }
});
test("revoking a conversation prevents advertising signals from all already-bound checkouts", async () => {
  const f = await fixture(); try { await f.capture(); await f.post("bind", { checkoutSessionId: "checkout-a" }); assert.equal((await f.post("revoke", {})).status, 201); const response = await f.post("purchase", { checkoutSessionId: "checkout-a", orderId: "external-a" }); assert.equal(response.status, 201); assert.equal(await response.json(), null); assert.equal(f.sent(), 0); assert.equal((await f.repo.read("store-a")).purchases!["canonical-a"].netRevenueCents, 10000);
  } finally { await f.closeHttp(); }
});
test("buyer request fields cannot declare another tenant, payment result, amount or Meta token", async () => {
  const f = await fixture(); try { await f.capture(); for (const extra of [{ merchantId: "store-b" }, { valueCents: 1 }, { paid: true }, { accessToken: "browser-token" }]) assert.equal((await f.post("purchase", { checkoutSessionId: "checkout-a", orderId: "external-a", ...extra })).status, 400); assert.equal(f.sent(), 0); assert.equal(Object.keys((await f.repo.read("store-a")).purchases ?? {}).length, 0); assert.equal((await f.post("bind", { checkoutSessionId: "missing" })).status, 403);
  } finally { await f.closeHttp(); }
});
