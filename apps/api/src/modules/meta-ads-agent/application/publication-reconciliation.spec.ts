import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsCampaignDraft, MetaAdsProduct, MetaAdsExecutionStatus } from "@zyon/shared-types";
import { applicationFixture } from "./__tests__/fixture.js";
import { ConnectionService } from "./connection.service.js";
import { CampaignService } from "./campaign.service.js";
import { ProposalService } from "./proposal.service.js";
import { ExecutionService } from "./execution.service.js";
import { MetaMcpAdapter } from "../infrastructure/meta-mcp.adapter.js";

async function fixture() {
  const f = await applicationFixture(); let sequence = 0;
  const rows: Record<string, Array<Record<string, unknown>>> = {
    campaign: [{ id: "200", status: "PAUSED", effective_status: "PAUSED", daily_budget: "2000" }],
    adset: [{ id: "300", status: "PAUSED", effective_status: "PAUSED", targeting: {} }],
    ad: ["500", "501"].map((id, i) => ({ id, status: "PAUSED", effective_status: "PAUSED", creative_id: String(400 + i), impressions: "0" })),
  };
  const calls: Array<{name: string; args: Record<string, unknown>}> = [];
  const tools = ["ads_get_ad_accounts", "ads_get_field_context", "ads_get_ad_entities", "ads_activate_entity"];
  const request: typeof fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer scoped-test-token");
    const rpc = JSON.parse(String(init?.body)); let result: unknown;
    if (rpc.method === "notifications/initialized") return new Response(null, {status: 202});
    if (rpc.method === "initialize") result = {protocolVersion: "2025-03-26", capabilities: {tools: {}}, serverInfo: {name: "controlled-meta", version: "1"}};
    else if (rpc.method === "tools/list") result = {tools: tools.map(name => ({name, inputSchema: {type: "object", properties: {}, additionalProperties: true}}))};
    else {
      const call = {name: rpc.params.name as string, args: rpc.params.arguments as Record<string, unknown>}; calls.push(call); let body: unknown;
      if (call.name === "ads_get_ad_accounts") body = {ad_accounts: [{ad_account_id: "100", is_queryable: true, is_ads_mcp_enabled: true, has_payment_method: true, currency: "BRL"}]};
      else if (call.name === "ads_get_field_context") body = {fields: (call.args.field_names as string[]).map(name => ({name, levels: ["campaign", "adset", "ad", "ad_account"]})), unknown_fields: []};
      else if (call.name === "ads_get_ad_entities") body = {ad_entities: JSON.stringify(rows[String(call.args.level)] ?? [])};
      else if (call.name === "ads_activate_entity") body = {result: JSON.stringify({status: "PUBLISHING", success: null})};
      else throw new Error(`Unexpected tool ${call.name}`);
      result = {structuredContent: body, content: [{type: "text", text: JSON.stringify(body)}]};
    }
    return new Response(JSON.stringify({jsonrpc: "2.0", id: rpc.id, result}), {headers: {"Content-Type": "application/json", "Mcp-Session-Id": "controlled-session"}});
  };
  const product: MetaAdsProduct = {productId: "product-a", variantId: "variant-a", name: "Produto", description: "Dados", sku: "A", imageUrl: "https://media.example.test/source.png", priceCents: 10000, currency: "BRL", stockQuantity: 5, active: true, storefrontUrl: "https://store.example.test/product-a", commercialVersion: "version-a"};
  f.commerce.products = async () => [product];
  const adapter = new MetaMcpAdapter({META_ADS_AGENT_REMOTE_WRITES_ENABLED: "true"}, request);
  f.provider.snapshot = adapter.snapshot.bind(adapter); f.provider.execute = adapter.execute.bind(adapter); f.provider.reconcile = adapter.reconcile.bind(adapter);
  const connection = new ConnectionService(f.repo, f.commerce, f.oauth, f.codec, f.provider, f.redirect, f.clock);
  const auth = await connection.begin("store-a", "owner-a"); await connection.complete("store-a", "owner-a", new URL(auth.authorizationUrl).searchParams.get("state")!, "code"); await connection.select("store-a", {accountId: "100", pageId: "110", datasetId: "120"});
  const campaigns = new CampaignService(f.repo, f.commerce, connection, f.provider, f.clock, () => `campaign-${++sequence}`);
  const draft: MetaAdsCampaignDraft = {name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: {amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null}, mediaIds: [], headline: "Produto", primaryText: "Conheça", country: "BR"};
  const campaign = await campaigns.create("store-a", draft, "create-a");
  await f.repo.mutate("store-a", [], state => {
    state.media["media-a"] = {id: "media-a", campaignId: campaign.id, productId: product.productId, variantId: product.variantId, productVersion: "version-a", url: "https://media.example.test/result.png", createdAt: f.clock().toISOString(), commercialReview: {status: "verified", productVersion: "version-a", imageSha256: "a".repeat(64)}};
    Object.assign(state.campaigns[campaign.id], {remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500", "501"], remoteCreativeIds: ["400", "401"], remoteAccountId: "100", status: "remote_paused"});
    return {result: null};
  });
  await campaigns.save("store-a", campaign.id, {...draft, mediaIds: ["media-a"]});
  const proposals = new ProposalService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock, () => `proposal-${++sequence}`);
  const service = new ExecutionService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock, () => `execution-${++sequence}`);
  const proposal = await proposals.create("store-a", campaign.id, {kind: "publish", after: {}, reasoning: "Revisado", idempotencyKey: "publish-a"});
  await proposals.approve("store-a", proposal.id, "owner-a", proposal.digest);
  return {...f, rows, calls, campaign, proposal, service};
}

test("MGA-48 real MCP reconciliation persists publishing until every expected child is active and distinguishes delivery", async () => {
  const f = await fixture();
  try {
    const execution = await f.service.execute("store-a", f.proposal.id, "owner-a"); assert.equal(execution.status, "publishing");
    const verify = async (expected: MetaAdsExecutionStatus) => {
      const result = await f.service.reconcile("store-a", execution.id); const state = await f.repo.read("store-a");
      assert.equal(result.status, expected); assert.equal(state.executions[execution.id].status, expected); assert.equal(state.campaigns[f.campaign.id].status, expected);
      assert.deepEqual(state.campaigns[f.campaign.id].remoteAdIds, ["500", "501"]); assert.deepEqual(result.objects, execution.objects);
      assert.equal(f.calls.filter(call => call.name === "ads_activate_entity").length, 1);
    };
    f.rows.campaign[0].status = "IN_PROCESS"; await verify("publishing");
    f.rows.campaign[0].status = "ACTIVE"; f.rows.campaign[0].effective_status = "ACTIVE"; await verify("publishing");
    f.rows.adset[0].status = "ACTIVE"; f.rows.adset[0].effective_status = "ACTIVE";
    f.rows.ad.forEach(ad => {ad.status = "ACTIVE"; ad.effective_status = "ACTIVE";});
    const set = f.rows.adset.pop()!; await verify("publishing"); f.rows.adset.push(set);
    const ad = f.rows.ad.pop()!; await verify("publishing"); f.rows.ad.push(ad);
    f.rows.ad[1].effective_status = "PENDING_REVIEW"; await verify("publishing"); f.rows.ad[1].effective_status = "ACTIVE";
    f.rows.adset[0].effective_status = "IN_PROCESS"; await verify("publishing"); f.rows.adset[0].effective_status = "ACTIVE";
    f.rows.campaign[0].effective_status = "IN_PROCESS"; await verify("publishing"); f.rows.campaign[0].effective_status = "ACTIVE";
    f.rows.ad[1].status = "PAUSED"; await verify("publishing"); f.rows.ad[1].status = "ACTIVE";
    await verify("active_unconfirmed");
    f.rows.ad.push({id: "999", status: "ACTIVE", effective_status: "ACTIVE", impressions: "100"}); await verify("active_unconfirmed"); f.rows.ad.pop();
    f.rows.ad[1].impressions = "1"; await verify("delivered");
    const childReads = f.calls.filter(call => call.name === "ads_get_ad_entities" && ["ad", "adset"].includes(String(call.args.level)));
    assert.equal(childReads.every(call => (call.args.fields as string[]).includes("status") && (call.args.fields as string[]).includes("effective_status")), true);
  } finally {await f.close();}
});

test("MGA-44 remote child state changes invalidate the approved snapshot before any publication write", async () => {
  const f = await fixture();
  try {
    f.rows.adset[0].status = "ACTIVE";
    await assert.rejects(f.service.execute("store-a", f.proposal.id, "owner-a"), {code: "proposal_stale"});
    assert.equal(f.calls.filter(call => call.name === "ads_activate_entity").length, 0);
    const state = await f.repo.read("store-a"); const attempts = Object.values(state.executions);
    assert.equal(attempts.length, 1); assert.equal(attempts[0].status, "failed"); assert.equal(attempts[0].error, "proposal_stale"); assert.deepEqual(attempts[0].objects, []); assert.equal(state.proposals[f.proposal.id].status, "stale");
  } finally {await f.close();}
});
