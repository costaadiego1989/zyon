import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsCampaign, MetaAdsExecution, MetaAdsMedia, MetaAdsProposal } from "@zyon/shared-types";
import type { MetaAccess } from "../domain/types.js";
import { MetaMcpAdapter } from "./meta-mcp.adapter.js";

const access = (): MetaAccess => ({ merchantId: "store-a", accessToken: "scoped-token", clientConversationId: "AbCdEfGhIjKlMnOpQr12", connectionEpoch: 1, accountId: "100", pageId: "110", catalogId: null, datasetId: "120", whatsappId: null });
const campaign = (): MetaAdsCampaign => ({ id: "local-a", createdByAgent: true, managed: true, remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], status: "remote_paused", createdAt: "2026-11-14T12:00:00Z", updatedAt: "2026-11-14T12:00:00Z", products: [{ productId: "product-a", variantId: "variant-a", name: "Produto", description: "Produto real", sku: "SKU-A", imageUrl: "https://media.example.test/original.png", priceCents: 10000, currency: "BRL", stockQuantity: 5, active: true, storefrontUrl: "https://store.example.test/product-a", commercialVersion: "v1" }], draft: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: { amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null }, mediaIds: ["media-a"], headline: "Produto", primaryText: "Conheca o produto", country: "BR" } });
const media: MetaAdsMedia[] = [{ id: "media-a", campaignId: "local-a", variantId: "variant-a", productId: "product-a", url: "https://media.example.test/generated.png", productVersion: "v1", createdAt: "2026-11-14T12:00:00Z" }];
const proposal = (kind: MetaAdsProposal["kind"]): MetaAdsProposal => ({ id: "proposal-a", campaignId: "local-a", kind, status: "approved", before: {}, after: {}, digest: "approved-digest", connectionEpoch: 1, reasoning: "Revisado", createdAt: "2026-11-14T12:00:00Z", approvedAt: "2026-11-14T12:01:00Z", approvedBy: "owner-a", executionId: null });

test('ADAS-29 native MCP budget currency wrappers normalize major BRL units to exact cents', async () => {
  const f = fixture(call => call.name === 'ads_get_ad_entities' && call.args.level === 'campaign' ? { ad_entities: JSON.stringify({ data: [{ id: '200', status: 'PAUSED', effective_status: 'PAUSED', daily_budget: { value: 0, unit: 'BRL' }, lifetime_budget: { value: '100.05', unit: 'BRL' }, spend_cap: { value: 0, unit: 'BRL' } }] }) } : undefined);
  const snapshot = await f.adapter.snapshot(access(), campaign());
  assert.deepEqual(snapshot.budget, { daily_budget: 0, lifetime_budget: 10005, spend_cap: 0 });
});
type Call = { name: string; args: Record<string, unknown> };
const toolNames = ["ads_get_ad_accounts", "ads_get_ad_account_pages", "ads_get_user_pages", "ads_catalog_list_catalogs", "ads_get_datasets", "ads_get_field_context", "ads_get_ad_entities", "ads_create_campaign", "ads_create_ad_set", "ads_create_creative", "ads_create_ad", "ads_activate_entity", "ads_update_entity", "ads_get_opportunity_score", "ads_account_get_activity_logs"];
function fixture(override?: (call: Call) => unknown | Promise<unknown>, omitted: string[] = []) {
  const calls: Call[] = []; const requests: Array<{ url: string; init?: RequestInit }> = [];
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer scoped-token");
    const rpc = JSON.parse(String(init?.body));
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown;
    if (rpc.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "controlled-meta", version: "1" } };
    else if (rpc.method === "tools/list") result = { tools: toolNames.filter(n => !omitted.includes(n)).map(name => ({ name, inputSchema: { type: "object", properties: {}, additionalProperties: true } })) };
    else {
      const call: Call = { name: rpc.params.name, args: rpc.params.arguments }; calls.push(call);
      assert.equal(call.args.client_conversation_id, "AbCdEfGhIjKlMnOpQr12");
      assert.equal(JSON.stringify(call.args).includes("scoped-token"), false);
      const custom = await override?.(call);
      if (custom instanceof Response) return custom;
      let body: unknown = custom;
      if (body === undefined) {
        switch (call.name) {
          case "ads_get_ad_accounts": body = { ad_accounts: [{ ad_account_id: "100", ad_account_name: "Loja", is_queryable: true, is_ads_mcp_enabled: true, has_payment_method: true, currency: "BRL", min_daily_budget_cents: 100 }] }; break;
          case "ads_get_ad_account_pages": case "ads_get_user_pages": body = { pages: [{ page_id: "110", page_name: "Pagina" }] }; break;
          case "ads_catalog_list_catalogs": body = { catalogs: [] }; break;
          case "ads_get_datasets": body = { datasets: [{ dataset_id: "120", name: "Compras", is_active: true }] }; break;
          case "ads_get_field_context": body = { fields: (call.args.field_names as string[]).map(name => ({ name, levels: ["campaign", "adset", "ad", "ad_account"] })), unknown_fields: [] }; break;
          case "ads_get_ad_entities": body = { ad_entities: JSON.stringify([{ id: call.args.level === "adset" ? "300" : call.args.level === "ad" ? "500" : "200", name: "Campanha", status: "PAUSED", effective_status: "PAUSED", daily_budget: "2000", lifetime_budget: "0", spend_cap: "0", targeting: { geo_locations: { countries: ["BR"] } }, currency: "BRL", timezone_name: "America/Sao_Paulo", impressions: "0" }]) }; break;
          case "ads_create_campaign": body = { campaign_id: "200", status: "PAUSED", valid_optimization_goals: '["OFFSITE_CONVERSIONS","CONVERSATIONS"]' }; break;
          case "ads_create_ad_set": body = { ad_set_id: "300", status: "PAUSED" }; break;
          case "ads_create_creative": body = { creative_id: "400", account_id: "100" }; break;
          case "ads_create_ad": body = { ad_id: "500", status: "PAUSED" }; break;
          case "ads_update_entity": body = { success: true, is_draft: false }; break;
          case "ads_activate_entity": body = { result: JSON.stringify({ status: "PUBLISHING", success: null }) }; break;
          default: body = {};
        }
      }
      result = { structuredContent: body, content: [{ type: "text", text: JSON.stringify(body) }] };
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "controlled-session" } });
  };
  return { adapter: new MetaMcpAdapter({ META_ADS_AGENT_REMOTE_WRITES_ENABLED: "true" }, request), calls, requests, request };
}

test("MCP discovery uses scoped bearer credentials and preserves catalog permission failures", async () => {
  const f = fixture(call => call.name === "ads_catalog_list_catalogs" ? new Response("denied", { status: 401 }) : undefined);
  const discovery = await f.adapter.discover(access());
  assert.deepEqual(discovery.accounts.map(a => a.id), ["100"]); assert.deepEqual(discovery.pages.map(p => p.id), ["110"]);
  assert.equal(discovery.capabilities.catalog, false); assert.equal(discovery.errors.includes("catalog_access_denied"), true);
  assert.equal(f.requests.every(r => r.url === "https://mcp.facebook.com/ads"), true);
});
test("MCP follows required read continuations in step order and never executes suggested writes", async () => {
  const f = fixture(call => call.name === "ads_get_ad_entities" ? { ad_entities: '[{"id":"200","name":"Existente","status":"ACTIVE"}]', next_actions: { actions: [
    { step: 2, strength: "required", read_only: true, requires_user_confirmation: false, tool: "ads_get_opportunity_score", suggested_args: '{"ad_account_id":"100"}' },
    { step: 1, strength: "required", read_only: true, requires_user_confirmation: false, tool: "ads_account_get_activity_logs", suggested_args: '{"ad_account_id":"100"}' },
    { step: 3, strength: "required", read_only: false, requires_user_confirmation: true, tool: "ads_update_entity", suggested_args: '{}' },
  ] } } : undefined);
  assert.deepEqual(await f.adapter.existingCampaigns(access()), [{ id: "200", name: "Existente", status: "ACTIVE" }]);
  assert.deepEqual(f.calls.slice(-2).map(c => c.name), ["ads_account_get_activity_logs", "ads_get_opportunity_score"]);
  assert.equal(f.calls.some(c => c.name === "ads_update_entity"), false);
});
test("MCP persists created objects progressively and never retries a timed-out write", async () => {
  const f = fixture(call => { if (call.name === "ads_create_ad_set") throw new Error("network interrupted after submission"); });
  const progress: MetaAdsExecution["objects"][] = [];
  const result = await f.adapter.prepare(access(), { ...campaign(), remoteCampaignId: null, remoteAdSetId: null, remoteAdIds: [] }, media, async objects => { progress.push(structuredClone(objects)); });
  assert.equal(result.status, "execution_unknown"); assert.deepEqual(result.objects, [{ type: "campaign", id: "200" }]); assert.deepEqual(progress, [[{ type: "campaign", id: "200" }]]);
  assert.equal(f.calls.filter(c => c.name === "ads_create_campaign").length, 1); assert.equal(f.calls.filter(c => c.name === "ads_create_ad_set").length, 1);
});
test("MCP creates a paused store campaign with the exact budget and product media", async () => {
  const f = fixture(); const result = await f.adapter.prepare(access(), campaign(), media, async () => {});
  assert.equal(result.status, "remote_paused"); assert.equal(result.objects.length, 4);
  const create = f.calls.find(c => c.name === "ads_create_campaign")!.args; assert.equal(create.campaign_daily_budget, 2000); assert.equal(create.objective, "OUTCOME_SALES");
  const set = f.calls.find(c => c.name === "ads_create_ad_set")!.args; assert.equal(set.destination_type, "WEBSITE"); assert.equal(set.optimization_goal, "OFFSITE_CONVERSIONS"); assert.equal(set.daily_budget, undefined); assert.deepEqual(JSON.parse(String(set.promoted_object)), { pixel_id: "120", custom_event_type: "PURCHASE" });
  const creative = f.calls.find(c => c.name === "ads_create_creative")!.args; assert.equal(creative.image_url, media[0].url); assert.equal(creative.link_url, campaign().products[0].storefrontUrl);
  assert.equal(f.calls.some(c => c.name === "ads_activate_entity"), false);
});
test("MCP pause updates only PAUSED and verifies by reading without reactivation", async () => {
  const f = fixture(); const result = await f.adapter.execute(access(), campaign(), proposal("pause"), async () => {});
  assert.equal(result.status, "remote_paused"); assert.deepEqual(JSON.parse(String(f.calls.find(c => c.name === "ads_update_entity")!.args.fields)), { status: "PAUSED" });
  assert.equal(f.calls.some(c => c.name === "ads_activate_entity"), false);
});
test("MCP publication reports an asynchronous handoff without claiming delivery", async () => {
  const f = fixture(); const result = await f.adapter.execute(access(), campaign(), proposal("publish"), async () => {});
  assert.equal(result.status, "publishing"); assert.equal(f.calls.filter(c => c.name === "ads_activate_entity").length, 1);
  assert.deepEqual(f.calls.find(c => c.name === "ads_activate_entity")!.args.object_ids, ["200", "300", "500"]);
});
test("MCP rejects foreign accounts, invalid conversation ids and writes to existing campaigns", async () => {
  const f = fixture(); await assert.rejects(f.adapter.discover({ ...access(), accountId: "other-account" }), { code: "meta_asset_forbidden", status: 403 });
  const before = f.requests.length; await assert.rejects(f.adapter.discover({ ...access(), clientConversationId: "merchant-personal-id" }), { code: "meta_conversation_invalid" }); assert.equal(f.requests.length, before);
  await assert.rejects(f.adapter.execute(access(), { ...campaign(), createdByAgent: false }, proposal("pause"), async () => {}), { code: "campaign_read_only", status: 403 });
});
test("MCP missing capabilities fail closed instead of using another write tool", async () => {
  const f = fixture(undefined, ["ads_create_ad_set"]); const result = await f.adapter.prepare(access(), campaign(), media, async () => {});
  assert.equal(result.status, "failed"); assert.equal(result.error, "meta_capability_unavailable");
  assert.equal(f.calls.some(c => c.name.startsWith("ads_create_")), false);
});

test("MCP WhatsApp campaigns verify the page phone and use the same messaging destination", async () => {
  const f = fixture();
  const request: typeof fetch = async (url, init) => String(url).startsWith("https://graph.facebook.com/")
    ? new Response(JSON.stringify({ id: "110", whatsapp_number: "+55 11 99999-9999", has_whatsapp_number: true })) : f.request(url, init);
  const adapter = new MetaMcpAdapter({ META_ADS_AGENT_REMOTE_WRITES_ENABLED: "true", META_ADS_GRAPH_API_VERSION: "v26.0" }, request);
  const scoped = { ...access(), whatsappId: "5511999999999" };
  const discovery = await adapter.discover(scoped);
  assert.deepEqual(discovery.whatsappNumbers, [{ id: "5511999999999", name: "WhatsApp 5511999999999", pageId: "110", accountId: "100" }]);
  const c = campaign(); c.draft.destination = "whatsapp";
  assert.equal((await adapter.prepare(scoped, c, media, async () => {})).status, "remote_paused");
  const set = f.calls.find(call => call.name === "ads_create_ad_set")!.args;
  assert.equal(set.destination_type, "WHATSAPP"); assert.equal(set.optimization_goal, "CONVERSATIONS"); assert.deepEqual(JSON.parse(String(set.promoted_object)), { page_id: "110" });
  const creative = f.calls.find(call => call.name === "ads_create_creative")!.args;
  assert.equal(creative.call_to_action_type, "WHATSAPP_MESSAGE"); assert.equal(creative.link_url, "https://wa.me/5511999999999");
});
test("MCP static carousel preserves five images and their canonical product links", async () => {
  const f = fixture(); const images = Array.from({ length: 5 }, (_, i) => ({ ...media[0], id: `media-${i}`, url: `https://media.example.test/${i}.png` }));
  assert.equal((await f.adapter.prepare(access(), campaign(), images, async () => {})).status, "remote_paused");
  const creative = f.calls.find(call => call.name === "ads_create_creative")!.args;
  assert.equal(creative.image_url, undefined); assert.equal((creative.cards as unknown[]).length, 5);
  assert.deepEqual((creative.cards as Array<Record<string, unknown>>).map(card => [card.image_url, card.link]), images.map(image => [image.url, campaign().products[0].storefrontUrl]));
});
test("MCP a sent pause with failed verification remains unknown instead of reporting a rollback", async () => {
  const f = fixture(call => { if (call.name === "ads_get_ad_entities") throw new Error("read unavailable"); });
  const result = await f.adapter.execute(access(), campaign(), proposal("pause"), async () => {});
  assert.equal(result.status, "execution_unknown"); assert.equal(f.calls.filter(c => c.name === "ads_update_entity").length, 1);
  assert.equal(f.calls.some(c => c.name === "ads_activate_entity"), false);
});

test("MCP streamable HTTP accepts SSE responses and keeps its server session header", async () => {
  const f = fixture();
  const request: typeof fetch = async (url, init) => {
    const rpc = JSON.parse(String(init?.body));
    const header = new Headers(init?.headers);
    assert.equal(header.get("Accept"), "application/json, text/event-stream");
    if (rpc.method !== "initialize") assert.equal(header.get("Mcp-Session-Id"), "controlled-session");
    const result = await f.request(url, init);
    if (result.status === 202) return result;
    return new Response(`event: message\ndata: ${await result.text()}\n\n`, { headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": "controlled-session" } });
  };
  const adapter = new MetaMcpAdapter({}, request);
  assert.deepEqual((await adapter.discover(access())).accounts.map(a => a.id), ["100"]);
});

test("MCP awaits the server lease before every write and stops a partially prepared structure", async () => {
  const f = fixture(); const scoped = access(); let writes = 0;
  scoped.assertWriteAuthorized = async () => { if (++writes > 1) throw new Error("lease revoked"); };
  const result = await f.adapter.prepare(scoped, campaign(), media, async () => {});
  assert.equal(result.objects[0].id, "200"); assert.equal(f.calls.filter(call => call.name.startsWith("ads_create_")).length, 1);
  assert.equal(result.status, "failed"); assert.equal(f.calls.some(call => call.name === "ads_activate_entity"), false);
});
test("MCP a successful creative update without matching readback stays unknown", async () => {
  const f = fixture(); const p = proposal("creative"); p.after.media = media;
  const result = await f.adapter.execute(access(), campaign(), p, async () => {});
  assert.equal(result.status, "execution_unknown"); assert.equal(result.error, "meta_creative_unconfirmed");
  assert.equal(result.objects.find(ref => ref.type === "creative")!.id, "400");
});
test("MCP a successful audience update without matching readback stays unknown", async () => {
  const f = fixture(); const p = proposal("audience"); p.after.country = "PT";
  const result = await f.adapter.execute(access(), campaign(), p, async () => {});
  assert.equal(result.status, "execution_unknown"); assert.equal(result.error, "meta_audience_unconfirmed");
});
test("MCP store creatives carry server-issued campaign origin links in every carousel card", async () => {
  const f = fixture(); const adapter = new MetaMcpAdapter({ META_ADS_AGENT_REMOTE_WRITES_ENABLED: "true" }, f.request, (merchantId, campaignId, original) => `${original}?zyon_ad=${merchantId}-${campaignId}-signed`);
  const images = [media[0], { ...media[0], id: "media-b" }]; const result = await adapter.prepare(access(), campaign(), images, async () => {});
  assert.equal(result.status, "remote_paused"); const cards = f.calls.find(call => call.name === "ads_create_creative")!.args.cards as Array<{ link: string }>;
  assert.deepEqual(cards.map(card => card.link), images.map(() => "https://store.example.test/product-a?zyon_ad=store-a-local-a-signed"));
});
