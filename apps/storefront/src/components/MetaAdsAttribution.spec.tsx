import assert from "node:assert/strict";
import { test } from "node:test";
import { MetaAdsAttributionClient } from "../lib/meta-ads-attribution";
function fixture() {
  let consent = true; let now = 1794744000000; let source = "https://store.example.test/store/loja?zyon_ad=campaign-a.signed&fbclid=actual-click"; let cookies = "_fbp=fb.1.1794744000000.browser";
  const storage = new Map<string, string>(); const calls: Array<{ conversationId: string; action: string; body: Record<string, unknown> }> = []; const pixels: unknown[][] = [];
  let purchase: unknown = { eventId: "zyon_purchase_canonical", valueCents: 1099, currency: "BRL", pixelId: "123456789012345" }; let pending: Promise<unknown> | null = null; let failRevoke = false;
  const client = new MetaAdsAttributionClient({ merchantId: "store-a", storeKey: "store-a", pixelId: "123456789012345", consentVersion: "privacy-v1", consent: () => consent, sourceUrl: () => source, cookies: () => cookies, now: () => now,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } },
    send: async (conversationId, action, body) => { calls.push({ conversationId, action, body }); if (action === "revoke" && failRevoke) throw new Error("offline"); return action === "purchase" ? pending ?? purchase : action === "revoke" ? { revoked: true } : { receiptId: "receipt-a", campaignId: "campaign-a" }; }, pixel: (...args) => { pixels.push(args); } });
  const detail = { merchantId: "store-a", cartRef: "conversation-a", sessionId: "checkout-a", orderId: "external-a", value: 999999, currency: "USD" };
  return { client, calls, pixels, storage, detail, consent: (value: boolean) => { consent = value; }, cookies: (value: string) => { cookies = value; }, source: (value: string) => { source = value; }, now: (value: number) => { now = value; }, purchase: (value: unknown) => { purchase = value; }, pending: (value: Promise<unknown>) => { pending = value; }, failRevoke: (value: boolean) => { failRevoke = value; } };
}
test("storefront attribution captures signed source and actual click cookies only with current consent", async () => {
  const f = fixture(); f.consent(false); await f.client.capture("conversation-a"); assert.equal(f.calls.length, 0); assert.equal(f.storage.size, 0);
  f.consent(true); await f.client.capture("conversation-a"); assert.equal(f.calls[0].action, "attribution"); assert.equal(f.calls[0].conversationId, "conversation-a"); assert.deepEqual(f.calls[0].body, { token: "campaign-a.signed", consent: true, consentVersion: "privacy-v1", fbc: "fb.1.1794744000000.actual-click", fbp: "fb.1.1794744000000.browser" }); await f.client.capture("conversation-a"); assert.equal(f.calls.length, 1);
});
test("storefront Purchase uses only server-confirmed money and stable identity across duplicate browser hints", async () => {
  const f = fixture(); await f.client.capture("conversation-a"); await Promise.all([f.client.purchase(f.detail), f.client.purchase(f.detail)]); await f.client.purchase(f.detail);
  assert.equal(f.calls.filter(call => call.action === "purchase").length, 1); assert.deepEqual(f.calls.find(call => call.action === "purchase")!.body, { checkoutSessionId: "checkout-a", orderId: "external-a" });
  assert.deepEqual(f.pixels, [["trackSingle", "123456789012345", "Purchase", { value: 10.99, currency: "BRL" }, { eventID: "zyon_purchase_canonical" }]]);
});
test("foreign checkout hints, unpaid responses and mismatched pixels cannot produce a browser purchase", async () => {
  const f = fixture(); await f.client.capture("conversation-a"); await f.client.purchase({ ...f.detail, merchantId: "store-b" }); await f.client.purchase({ ...f.detail, cartRef: "foreign-conversation" }); assert.equal(f.calls.filter(call => call.action === "purchase").length, 0);
  f.purchase(null); await f.client.purchase(f.detail); assert.equal(f.pixels.length, 0); f.purchase({ eventId: "event-b", valueCents: 1099, currency: "BRL", pixelId: "999999999999999" }); await f.client.purchase({ ...f.detail, orderId: "external-b" }); assert.equal(f.pixels.length, 0);
});
test("revocation during server verification blocks the Pixel and reaches every captured conversation", async () => {
  const f = fixture(); await f.client.capture("conversation-a"); await f.client.capture("conversation-b"); let resolve!: (value: unknown) => void; f.pending(new Promise(done => { resolve = done; })); const request = f.client.purchase(f.detail); await Promise.resolve(); f.consent(false); await f.client.revoke(); resolve({ eventId: "paid-late", valueCents: 10000, currency: "BRL", pixelId: "123456789012345" }); await request;
  assert.equal(f.pixels.length, 0); assert.deepEqual(f.calls.filter(call => call.action === "revoke").map(call => call.conversationId).sort(), ["conversation-a", "conversation-b"]); assert.equal(f.client.pendingRevocations(), 0);
});
test("failed revocation retains a retry and attribution outages never invent a successful purchase", async () => {
  const f = fixture(); await f.client.capture("conversation-a"); f.failRevoke(true); f.consent(false); await f.client.revoke(); assert.equal(f.client.pendingRevocations(), 1); assert.ok([...f.storage.values()].some(value => value.includes("conversation-a"))); f.failRevoke(false); await f.client.revoke(); assert.equal(f.client.pendingRevocations(), 0); assert.equal(f.pixels.length, 0);
});
test("missing ad source never fabricates a click or starts attribution", async () => {
  const f = fixture(); f.source("https://store.example.test/store/loja"); await f.client.capture("conversation-a"); assert.equal(f.calls.length, 0); assert.equal(f.pixels.length, 0);
});
test("a fresh ad click replaces a stale fbc cookie instead of attributing the new visit to the old click", async () => {
  const f = fixture(); f.cookies("_fbc=fb.1.1794600000000.old-click; _fbp=fb.1.1794744000000.browser"); await f.client.capture("conversation-a"); assert.equal(f.calls[0].body.fbc, "fb.1.1794744000000.actual-click");
});
