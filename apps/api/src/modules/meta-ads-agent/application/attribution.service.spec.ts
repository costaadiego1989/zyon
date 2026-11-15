import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaidOrderFact, PurchaseSignal, MetaAccess } from "../domain/types.js";
import { applicationFixture } from "./__tests__/fixture.js";
import { AttributionService } from "./attribution.service.js";

async function fixture() {
  const f = await applicationFixture(); const sent: PurchaseSignal[] = []; let sequence = 0;
  await f.repo.mutate("store-a", [], state => { state.campaigns["campaign-a"] = { id: "campaign-a", draft: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: [], mediaIds: [], budget: null, headline: "", primaryText: "", country: "BR" }, products: [], createdByAgent: true, managed: true, remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], remoteAccountId: "100", status: "active_unconfirmed", createdAt: f.clock().toISOString(), updatedAt: f.clock().toISOString() }; return { result: null, records: [{ key: "campaign-origin:campaign-a", kind: "audit", payload: { campaignId: "campaign-a", source: "agent" }, createdAt: f.clock().toISOString() }] }; });
  let fact: PaidOrderFact | null = { orderId: "order-a", sessionId: "session-a", merchantId: "store-a", paid: true, paidAt: "2026-11-14T12:00:00Z", paidCents: 10000, refundedCents: 0, currency: "BRL", costCents: null, costCoverage: "unavailable" };
  f.commerce.paidOrder = async (merchantId, orderId) => fact?.merchantId === merchantId && fact.orderId === orderId ? structuredClone(fact) : null;
  const access: MetaAccess = { merchantId: "store-a", accessToken: "test-secret", connectionEpoch: 1, clientConversationId: "AbCdEfGhIjKlMnOpQr12", accountId: "100", pageId: "110", catalogId: null, datasetId: "120", whatsappId: null };
  const conversions = { send: async (_access: MetaAccess, signal: PurchaseSignal) => { sent.push(signal); return { status: "sent" as const, error: null }; } };
  const connection = { access: async () => access };
  const service = new AttributionService(f.repo, f.commerce, connection, conversions, Buffer.alloc(32, 7).toString("base64"), f.clock, () => `attribution-${++sequence}`);
  const capture = (consent = true) => service.captureStore("store-a", { token: service.trackingToken("store-a", "campaign-a"), sessionId: "session-a", consent, consentVersion: "ads-v1", fbc: "fb.1.1794654000000.click-a", fbp: "fb.1.1794654000000.browser-a" });
  return { ...f, service, sent, capture, conversions, setFact: (value: PaidOrderFact | null) => { fact = value; }, fact: () => fact! };
}
test("MGA-53 verified store and WhatsApp origins correlate only canonical paid orders of the same tenant", async () => {
  const f = await fixture(); try { await f.capture(); const purchase = await f.service.reconcilePurchase("store-a", "order-a"); assert.equal(purchase!.campaignId, "campaign-a"); assert.equal(purchase!.netRevenueCents, 10000); assert.equal(purchase!.source, "store"); assert.equal(f.sent[0].valueCents, 10000);
    await f.service.captureWhatsapp("store-a", { adId: "500", sessionId: "session-wa", consent: true, consentVersion: "ads-v1", ctwaClid: "click-whatsapp" }); f.setFact({ ...f.fact(), orderId: "order-wa", sessionId: "session-wa" }); const whatsapp = await f.service.reconcilePurchase("store-a", "order-wa"); assert.equal(whatsapp!.campaignId, "campaign-a"); assert.equal(whatsapp!.source, "whatsapp"); assert.equal(f.sent[1].ctwaClid, "click-whatsapp"); assert.equal(await f.service.reconcilePurchase("store-b", "order-wa"), null);
  } finally { await f.close(); }
});
test("MGA-54 missing, forged or unrelated origin keeps paid purchases unattributed", async () => {
  const f = await fixture(); try { const purchase = await f.service.reconcilePurchase("store-a", "order-a"); assert.equal(purchase!.campaignId, null); assert.equal(purchase!.source, null); assert.equal(f.sent.length, 0); await assert.rejects(f.service.captureStore("store-a", { token: f.service.trackingToken("store-b", "campaign-a"), sessionId: "session-a", consent: true, consentVersion: "v1" }), { code: "attribution_origin_invalid" }); await assert.rejects(f.service.captureWhatsapp("store-a", { adId: "999", sessionId: "session-a", consent: true, consentVersion: "v1", ctwaClid: "click" }), { code: "attribution_origin_invalid" }); assert.equal(f.sent.length, 0); } finally { await f.close(); }
});
test("MGA-55 browser and server use the same event identity and duplicate purchase events send once", async () => {
  const f = await fixture(); try { await f.capture(); const purchases = await Promise.all([f.service.reconcilePurchase("store-a", "order-a"), f.service.reconcilePurchase("store-a", "order-a")]); const browser = await f.service.browserPurchase("store-a", "session-a", "order-a"); assert.equal(purchases[0]!.eventId, purchases[1]!.eventId); assert.equal(browser!.eventId, purchases[0]!.eventId); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].eventId, browser!.eventId); await assert.rejects(f.service.browserPurchase("store-a", "session-other", "order-a"), { code: "attribution_session_forbidden" }); assert.equal(browser!.valueCents, 10000); } finally { await f.close(); }
});
test("MGA-56 absent or revoked ad consent prevents signals while purchases still reconcile", async () => {
  const f = await fixture(); try { const receipt = await f.capture(false); assert.equal(receipt.fbc, null); assert.equal(receipt.fbp, null); assert.equal((await f.service.reconcilePurchase("store-a", "order-a"))!.netRevenueCents, 10000); assert.equal(f.sent.length, 0); assert.equal(await f.service.browserPurchase("store-a", "session-a", "order-a"), null);
    await f.service.captureWhatsapp("store-a", { adId: "500", sessionId: "session-wa", consent: true, consentVersion: "v1", ctwaClid: "click" }); await f.service.revoke("store-a", "session-wa"); f.setFact({ ...f.fact(), orderId: "order-wa", sessionId: "session-wa" }); assert.equal((await f.service.reconcilePurchase("store-a", "order-wa"))!.campaignId, "campaign-a"); assert.equal(f.sent.length, 0); assert.equal(await f.service.browserPurchase("store-a", "session-wa", "order-wa"), null);
  } finally { await f.close(); }
});
test("MGA-57 refund reconciliation adjusts net revenue without sending a second purchase", async () => {
  const f = await fixture(); try { await f.capture(); const original = await f.service.reconcilePurchase("store-a", "order-a"); f.setFact({ ...f.fact(), refundedCents: 2500 }); const refund = await f.service.reconcilePurchase("store-a", "order-a"); assert.equal(refund!.netRevenueCents, 7500); assert.equal(refund!.eventId, original!.eventId); assert.equal(f.sent.length, 1); f.setFact({ ...f.fact(), refundedCents: 10000 }); assert.equal((await f.service.reconcilePurchase("store-a", "order-a"))!.netRevenueCents, 0); assert.equal(f.sent.length, 1); const report = await f.service.report("store-a", "2026-11-01", "2026-11-30"); assert.equal(report[0].fact.refundedCents, 10000); } finally { await f.close(); }
});
test("nonpaid or invalid canonical facts never become purchase signals and unknown sends are not repeated", async () => {
  const f = await fixture(); try { await f.capture(); f.setFact({ ...f.fact(), paid: false }); assert.equal(await f.service.reconcilePurchase("store-a", "order-a"), null); assert.equal(f.sent.length, 0); f.setFact({ ...f.fact(), paid: true }); let calls = 0; f.conversions.send = async () => { calls++; throw new Error("timeout secret"); }; const result = await f.service.reconcilePurchase("store-a", "order-a"); assert.equal(result!.signalStatus, "unknown"); await f.service.reconcilePurchase("store-a", "order-a"); assert.equal(calls, 1); assert.equal((await f.repo.getRecord<{ status: string }>("store-a", `purchase-signal-result:${result!.eventId}`))!.payload.status, "unknown"); } finally { await f.close(); }
});
test("an origin captured after payment cannot retrospectively attribute or advertise that purchase", async () => {
  const f = await fixture(); try { f.setNow("2026-11-14T13:00:00Z"); await f.capture(); const purchase = await f.service.reconcilePurchase("store-a", "order-a"); assert.equal(purchase!.campaignId, null); assert.equal(f.sent.length, 0); assert.equal(await f.service.browserPurchase("store-a", "session-a", "order-a"), null); } finally { await f.close(); }
});
test("reconciled date-only reports use the ad account timezone at midnight boundaries", async () => {
  const f = await fixture(); try {
    f.setNow("2026-11-16T12:00:00Z"); f.setFact({ ...f.fact(), paidAt: "2026-11-14T01:00:00Z" }); await f.service.reconcilePurchase("store-a", "order-a"); f.setFact({ ...f.fact(), orderId: "order-b", paidAt: "2026-11-15T01:00:00Z" }); await f.service.reconcilePurchase("store-a", "order-b");
    assert.deepEqual((await f.service.report("store-a", "2026-11-14", "2026-11-14", "America/Sao_Paulo")).map(row => row.orderId), ["order-b"]); assert.deepEqual((await f.service.report("store-a", "2026-11-14", "2026-11-14", "UTC")).map(row => row.orderId), ["order-a"]);
  } finally { await f.close(); }
});
test("a late browser revisit cannot emit another purchase outside the provider deduplication window", async () => {
  const f = await fixture(); try { await f.capture(); await f.service.reconcilePurchase("store-a", "order-a"); f.setNow("2026-11-16T13:00:00Z"); assert.equal(await f.service.browserPurchase("store-a", "session-a", "order-a"), null); assert.equal(f.sent.length, 1); } finally { await f.close(); }
});
