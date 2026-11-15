import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAccess, PurchaseSignal, WhatsappConversionsContextPort } from "../domain/types.js";
import { ConversionsApiAdapter } from "./conversions-api.adapter.js";
const access: MetaAccess = { merchantId: "store-a", accessToken: "scoped-token", clientConversationId: "AbCdEfGhIjKlMnOpQr12", connectionEpoch: 1, accountId: "100", pageId: "110", catalogId: null, datasetId: "120", whatsappId: "5511999999999" };
const signal: PurchaseSignal = { eventId: "zyon_purchase_stable", eventTime: "2026-11-15T12:00:00Z", orderId: "order-a", valueCents: 1099, currency: "BRL", source: "store", fbc: "fb.1.1794744000000.click", fbp: "fb.1.1794744000000.browser", eventSourceUrl: "https://store.example.test/store/loja", clientUserAgent: "Mozilla/5.0 Real Browser" };
const env = { META_ADS_AGENT_CONVERSIONS_ENABLED: "true", META_ADS_GRAPH_API_VERSION: "v27.0" };
const clock = () => new Date("2026-11-15T12:00:00Z");
test("CAPI website sends exact canonical money, stable identity, source URL and actual user agent", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = new ConversionsApiAdapter(env, async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ events_received: 1 })); }, undefined, clock);
  assert.deepEqual(await adapter.send(access, signal), { status: "sent", error: null }); assert.equal(requests.length, 1); assert.equal(requests[0].url, "https://graph.facebook.com/v27.0/120/events"); assert.equal(new Headers(requests[0].init!.headers).get("Authorization"), "Bearer scoped-token"); const body = JSON.parse(String(requests[0].init!.body));
  assert.deepEqual(body.data[0], { event_name: "Purchase", event_time: 1794744000, event_id: "zyon_purchase_stable", action_source: "website", event_source_url: signal.eventSourceUrl, user_data: { fbc: signal.fbc, fbp: signal.fbp, client_user_agent: signal.clientUserAgent }, custom_data: { currency: "BRL", value: 10.99 } }); assert.equal(JSON.stringify(body).includes("scoped-token"), false); assert.equal(JSON.stringify(body).includes("order-a"), false);
});
test("CAPI WhatsApp verifies the canonical WABA phone and linked dataset and uses ctwa_clid", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const context: WhatsappConversionsContextPort = { get: async merchantId => merchantId === "store-a" ? { merchantId, wabaId: "700", phoneNumberId: "710", phoneNumber: "+55 11 99999-9999", accessToken: "waba-token" } : null };
  const adapter = new ConversionsApiAdapter(env, async (url, init) => { calls.push({ url: String(url), init }); assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer waba-token"); return new Response(JSON.stringify(String(url).includes("phone_numbers") ? { data: [{ id: "710", display_phone_number: "+55 11 99999-9999" }] } : String(url).includes("/dataset") ? { data: [{ id: "720" }] } : { events_received: 1 })); }, context, clock);
  assert.equal((await adapter.send(access, { ...signal, source: "whatsapp", ctwaClid: "verified-click" })).status, "sent"); assert.equal(calls.at(-1)!.url, "https://graph.facebook.com/v27.0/720/events"); const event = JSON.parse(String(calls.at(-1)!.init!.body)).data[0]; assert.equal(event.action_source, "business_messaging"); assert.equal(event.messaging_channel, "whatsapp"); assert.deepEqual(event.user_data, { whatsapp_business_account_id: "700", ctwa_clid: "verified-click" }); assert.equal(event.event_id, signal.eventId); assert.equal(event.event_source_url, undefined);
});
test("CAPI missing website context, invalid money or stale events fail before sending", async () => {
  let calls = 0; const adapter = new ConversionsApiAdapter(env, async () => { calls++; return new Response("{}"); }, undefined, clock);
  for (const invalid of [{ ...signal, clientUserAgent: undefined }, { ...signal, eventSourceUrl: "http://localhost" }, { ...signal, valueCents: -1 }, { ...signal, eventTime: "2026-10-01T00:00:00Z" }, { ...signal, eventTime: "2026-12-01T00:00:00Z" }, { ...signal, fbc: null, fbp: null }]) assert.equal((await adapter.send(access, invalid)).status, "failed"); assert.equal(calls, 0);
  const disabled = new ConversionsApiAdapter({}, async () => { calls++; throw new Error("must not send"); }, undefined, clock); assert.equal((await disabled.send(access, signal)).error, "meta_conversions_not_configured"); assert.equal(calls, 0);
});
test("CAPI a foreign or unlinked WhatsApp asset cannot send any event", async () => {
  let posts = 0; const context: WhatsappConversionsContextPort = { get: async () => ({ merchantId: "store-b", wabaId: "700", phoneNumberId: "710", phoneNumber: access.whatsappId!, accessToken: "secret" }) }; const adapter = new ConversionsApiAdapter(env, async (_url, init) => { if (init?.method === "POST") posts++; return new Response(JSON.stringify({ data: [] })); }, context, clock); assert.equal((await adapter.send(access, { ...signal, source: "whatsapp", ctwaClid: "click" })).status, "failed"); assert.equal(posts, 0);
});
test("CAPI permission failures remain failed and ambiguous sends remain unknown without retries", async () => {
  let calls = 0; const request: typeof fetch = async () => { calls++; throw new Error("network contains credential"); }; const timeout = new ConversionsApiAdapter(env, request, undefined, clock); assert.deepEqual(await timeout.send(access, signal), { status: "unknown", error: "meta_conversion_outcome_unknown" }); assert.equal(calls, 1);
  const denied = new ConversionsApiAdapter(env, async () => new Response(JSON.stringify({ error: { code: 190, message: "secret" } }), { status: 403 }), undefined, clock); assert.deepEqual(await denied.send(access, signal), { status: "failed", error: "meta_conversion_rejected" }); const ambiguous = new ConversionsApiAdapter(env, async () => new Response(JSON.stringify({ events_received: 0 })), undefined, clock); assert.equal((await ambiguous.send(access, signal)).status, "unknown");
});
test("CAPI a revoked send lease is checked immediately before the event POST", async () => {
  let posts = 0; const adapter = new ConversionsApiAdapter(env, async () => { posts++; return new Response(JSON.stringify({ events_received: 1 })); }, undefined, clock);
  const result = await adapter.send({ ...access, assertWriteAuthorized: async () => { throw new Error("consent revoked"); } }, signal);
  assert.equal(result.status, "failed"); assert.equal(posts, 0);
});
