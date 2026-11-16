import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsCampaignDraft, MetaAdsProduct, MetaAdsActionKind } from "@zyon/shared-types";
import { applicationFixture } from "./__tests__/fixture.js";
import { ConnectionService } from "./connection.service.js";
import { CampaignService } from "./campaign.service.js";
import { ProposalService } from "./proposal.service.js";
import { ExecutionService } from "./execution.service.js";
import { authorityFixture } from './__tests__/authority-fixture.js';

async function automaticFixture(prepared = true) {
  const f = await authorityFixture(prepared);
  const executor = new ExecutionService(f.repo, f.commerce, f.service.campaigns, f.service.connection, f.provider, f.clock, undefined,
    { authority: f.authority, exposure: f.exposure, budgetControl: f.budgetControl });
  return { ...f, executor };
}

test('ADAS-34 automatic execution records service policy authority without fictional human approval', async () => {
  const f = await automaticFixture();
  try {
    let writes = 0; f.provider.execute = async access => { await access.assertWriteAuthorized!(); writes++; return { status: 'remote_paused', objects: [{ type: 'campaign', id: '200' }] }; };
    const p = await f.propose(); const result = await f.executor.executeAutomatic('store-a', p.id, f.automatic);
    const state = await f.repo.read('store-a'), audit = (await f.repo.getRecord<Record<string, unknown>>('store-a', `execution-result:${result.id}:1`))!.payload;
    assert.equal(writes, 1); assert.equal(result.status, 'remote_paused'); assert.equal(state.proposals[p.id].status, 'executed');
    assert.equal(state.proposals[p.id].approvedBy, null); assert.equal(state.proposals[p.id].approvedAt, null);
    assert.equal(audit.actorId, 'service:meta-ads-agent'); assert.equal(audit.approvedBy, null);
    assert.equal((audit.authority as Record<string, unknown>).policyId, f.policy.id);
    assert.equal((audit.authority as Record<string, unknown>).policyVersion, f.policy.version);
    assert.equal(await f.repo.getRecord('store-a', `proposal-approval:${p.id}`), null);
  } finally { await f.close(); }
});

test('ADAS-31 optional automatic wiring preserves the exact manual approval guard', async () => {
  const f = await automaticFixture();
  try { const p = await f.propose(); await assert.rejects(f.executor.execute('store-a', p.id, 'owner-a'), { code: 'approval_required' }); assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0); assert.equal(f.calls.includes('execute'), false); }
  finally { await f.close(); }
});

test('ADAS-07 confirmed financial block prevents manual and automatic publication with no write', async () => {
  const f = await automaticFixture();
  try {
    const p = await f.propose('publish'); f.financialBlocked(true);
    await assert.rejects(f.executor.executeAutomatic('store-a', p.id, f.automatic), { code: 'meta_funding_blocked' });
    await f.service.proposals.approve('store-a', p.id, 'owner-a', p.digest);
    await assert.rejects(f.executor.execute('store-a', p.id, 'owner-a'), { code: 'meta_funding_blocked' });
    assert.equal(f.calls.includes('execute'), false); assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0);
  } finally { await f.close(); }
});

test('ADAS-38 revocation between prepare objects fences the next physical write and retains created IDs', async () => {
  const f = await automaticFixture(false);
  try {
    let writes = 0;
    f.provider.prepare = async (access, _campaign, _media, progress) => {
      await access.assertWriteAuthorized!(); writes++; await progress([{ type: 'campaign', id: '200' }]);
      await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'revoke-between-writes' });
      await access.assertWriteAuthorized!(); writes++; return { status: 'remote_paused', objects: [] };
    };
    const p = await f.propose('prepare'), result = await f.executor.executeAutomatic('store-a', p.id, f.automatic), state = await f.repo.read('store-a');
    assert.equal(writes, 1); assert.equal(result.status, 'execution_unknown'); assert.deepEqual(result.objects, [{ type: 'campaign', id: '200' }]);
    assert.equal(state.campaigns[f.campaignId].remoteCampaignId, '200'); assert.equal(state.exposure!.pending[result.id].status, 'unknown');
    assert.equal(state.proposals[p.id].approvedBy, null);
  } finally { await f.close(); }
});

test('ADAS-36 automatic budget holds exposure until exact remote confirmation', async () => {
  const f = await automaticFixture();
  try {
    await f.exposure.observe('store-a', f.reading()); let during = 0;
    f.provider.execute = async access => { await access.assertWriteAuthorized!(); const state = await f.repo.read('store-a'); during = Object.values(state.exposure!.pending)[0].targetBudget.amountCents; f.remoteAmount(8000); return { status: 'remote_paused', objects: [{ type: 'campaign', id: '200' }] }; };
    const p = await f.propose('budget', { budget: { ...f.budget, amountCents: 8000 } }), result = await f.executor.executeAutomatic('store-a', p.id, f.automatic);
    const state = await f.repo.read('store-a'); assert.equal(during, 8000); assert.equal(result.status, 'remote_paused');
    assert.deepEqual(state.exposure!.pending, {}); assert.equal(state.exposure!.allocations[f.campaignId].amountCents, 8000);
    assert.equal(state.campaigns[f.campaignId].draft.budget!.amountCents, 8000);
    assert.equal((await f.exposure.read('store-a', result.id)).status, 'confirmed');
  } finally { await f.close(); }
});

test('ADAS-50 unknown automatic budget cannot release money or resend and reconciles after revocation', async () => {
  const f = await automaticFixture();
  try {
    await f.exposure.observe('store-a', f.reading()); let writes = 0;
    f.provider.execute = async access => { await access.assertWriteAuthorized!(); writes++; f.remoteAmount(8000); throw new Error('uncertain scoped-test-token'); };
    const p = await f.propose('budget', { budget: { ...f.budget, amountCents: 8000 } }), result = await f.executor.executeAutomatic('store-a', p.id, f.automatic);
    assert.equal(result.status, 'execution_unknown'); assert.equal((await f.exposure.read('store-a', result.id)).status, 'unknown');
    await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'revoke-after-send' });
    assert.equal((await f.executor.executeAutomatic('store-a', p.id, f.automatic)).id, result.id); assert.equal(writes, 1);
    f.provider.reconcile = async (_access, _campaign, execution) => ({ status: 'remote_paused', objects: execution.objects });
    const reconciled = await f.executor.reconcile('store-a', result.id); assert.equal(reconciled.status, 'remote_paused');
    const state = await f.repo.read('store-a'); assert.deepEqual(state.exposure!.pending, {}); assert.equal(state.exposure!.allocations[f.campaignId].amountCents, 8000); assert.equal(writes, 1);
    assert.equal(JSON.stringify(await f.repo.getRecord('store-a', `execution-input:${result.id}`)).includes('scoped-test-token'), false);
  } finally { await f.close(); }
});

test('ADAS-37 unavailable remote control prevents automatic publication before reservation or send', async () => {
  const f = await automaticFixture();
  try { const p = await f.propose('publish'); f.controlAvailable(false); await assert.rejects(f.executor.executeAutomatic('store-a', p.id, f.automatic), { code: 'automatic_budget_control_unavailable' }); const state = await f.repo.read('store-a'); assert.equal(Object.keys(state.executions).length, 0); assert.deepEqual(state.exposure?.pending ?? {}, {}); assert.equal(f.calls.includes('execute'), false); }
  finally { await f.close(); }
});

test('ADAS-39 role loss after reservation prevents physical execution and cancels unsent exposure', async () => {
  const f = await automaticFixture();
  try {
    let writes = 0; const reserve = f.exposure.reserve.bind(f.exposure);
    f.exposure.reserve = async (...args) => { const result = await reserve(...args); f.role(false); return result; };
    f.provider.execute = async () => { writes++; return { status: 'remote_paused', objects: [] }; };
    const p = await f.propose('publish'); await assert.rejects(f.executor.executeAutomatic('store-a', p.id, f.automatic), { code: 'meta_ads_role_forbidden' });
    const state = await f.repo.read('store-a'); assert.equal(writes, 0); assert.deepEqual(state.exposure!.pending, {});
    const execution = Object.values(state.executions)[0]; assert.equal(execution.status, 'failed'); assert.equal((await f.exposure.read('store-a', execution.id)).status, 'cancelled');
  } finally { await f.close(); }
});

test('ADAS-34 automatic entry is unavailable without server authority wiring', async () => {
  const f = await fixture();
  try { const p = await f.review(); await assert.rejects(f.service.executeAutomatic('store-a', p.id, { kind: 'automatic', policyId: 'policy-forged', policyVersion: 1, policyDigest: 'f'.repeat(64) }), { code: 'automatic_authority_unavailable' }); assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0); }
  finally { await f.close(); }
});

async function fixture(prepared = true) {
  const f = await applicationFixture(); let sequence = 0;
  const product: MetaAdsProduct = { productId: "product-a", variantId: "variant-a", name: "Produto", description: "Dados", sku: "A", imageUrl: "https://media.example.test/source.png", priceCents: 10000, currency: "BRL", stockQuantity: 5, active: true, storefrontUrl: "https://store.example.test/product-a", commercialVersion: "version-a" };
  f.commerce.products = async () => [product];
  const connection = new ConnectionService(f.repo, f.commerce, f.oauth, f.codec, f.provider, f.redirect, f.clock);
  const authorization = await connection.begin("store-a", "owner-a"); await connection.complete("store-a", "owner-a", new URL(authorization.authorizationUrl).searchParams.get("state")!, "code"); await connection.select("store-a", { accountId: "100", pageId: "110", datasetId: "120" });
  const campaigns = new CampaignService(f.repo, f.commerce, connection, f.provider, f.clock, () => `campaign-${++sequence}`);
  const draft: MetaAdsCampaignDraft = { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: { amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null }, mediaIds: [], headline: "Produto", primaryText: "Conheca", country: "BR" };
  const campaign = await campaigns.create("store-a", draft, "create-a");
  await f.repo.mutate("store-a", [], state => { state.media["media-a"] = { id: "media-a", campaignId: campaign.id, productId: product.productId, variantId: product.variantId, productVersion: "version-a", url: "https://media.example.test/result.png", createdAt: f.clock().toISOString(), commercialReview: { status: "verified", productVersion: "version-a", imageSha256: "a".repeat(64) } }; return { result: null }; });
  await campaigns.save("store-a", campaign.id, { ...draft, mediaIds: ["media-a"] });
  if (prepared) await f.repo.mutate("store-a", [], state => { Object.assign(state.campaigns[campaign.id], { remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], remoteCreativeIds: ["400"], remoteAccountId: "100", status: "remote_paused" }); return { result: null }; });
  const proposals = new ProposalService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock, () => `proposal-${++sequence}`);
  const service = new ExecutionService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock, () => `execution-${++sequence}`);
  const review = async (kind: MetaAdsActionKind = prepared ? "pause" : "prepare") => { const proposal = await proposals.create("store-a", campaign.id, { kind, after: {}, reasoning: "Revisado", idempotencyKey: `request-${++sequence}` }); await proposals.approve("store-a", proposal.id, "owner-a", proposal.digest); return proposal; };
  return { ...f, product, campaign, proposals, service, review, connection };
}
test("MGA-46 another proposal cannot resend an unknown campaign preparation", async () => {
  const f=await fixture(false); let writes=0;
  try {
    f.provider.prepare=async()=>{writes++;return{status:"execution_unknown",objects:[]};};
    const first=await f.review();const result=await f.service.execute("store-a",first.id,"owner-a");assert.equal(result.status,"execution_unknown");
    const second=await f.review();await assert.rejects(f.service.execute("store-a",second.id,"owner-a"),{code:"campaign_execution_pending",status:409});
    assert.equal(writes,1);const state=await f.repo.read("store-a");assert.equal(Object.keys(state.executions).length,1);assert.equal(state.proposals[second.id].executionId,null);
    assert.equal((await f.service.execute("store-a",first.id,"owner-a")).id,result.id);assert.equal(writes,1);
  } finally {await f.close();}
});
test("MGA-45 two separately approved proposals serialize campaign writes and cannot prepare twice", async () => {
  const f=await fixture(false);let writes=0;let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(yes=>{release=yes;}),started=new Promise<void>(yes=>{entered=yes;});let running:ReturnType<typeof f.service.execute>|undefined;
  try {
    f.provider.prepare=async(_access,_campaign,_media,progress)=>{writes++;const objects=[{type:"campaign" as const,id:"200"}];await progress(objects);if(writes===1){entered();await hold;}return{status:"remote_paused",objects};};
    const first=await f.review(),second=await f.review();running=f.service.execute("store-a",first.id,"owner-a");await started;
    await assert.rejects(f.service.execute("store-a",second.id,"owner-a"),{code:"campaign_execution_pending",status:409});assert.equal(writes,1);
    release();const result=await running;assert.equal(result.status,"remote_paused");
    await assert.rejects(f.service.execute("store-a",second.id,"owner-a"),{code:"campaign_already_prepared",status:409});
    assert.equal(writes,1);assert.equal(Object.keys((await f.repo.read("store-a")).executions).length,1);
  } finally {release();await running?.catch(()=>undefined);await f.close();}
});
test("MGA-47 preapproved second preparation cannot recreate a partial remote structure", async () => {
  const f=await fixture(false);let writes=0;
  try {
    const first=await f.review(),second=await f.review();
    f.provider.prepare=async(_access,_campaign,_media,progress)=>{writes++;const objects=[{type:"campaign" as const,id:"200"}];await progress(objects);return{status:"remote_draft",objects,error:"meta_validation_errors"};};
    const result=await f.service.execute("store-a",first.id,"owner-a");assert.equal(result.status,"remote_draft");assert.deepEqual(result.objects,[{type:"campaign",id:"200"}]);
    await assert.rejects(f.service.execute("store-a",second.id,"owner-a"),{code:"campaign_already_prepared",status:409});
    const state=await f.repo.read("store-a");assert.equal(state.campaigns[f.campaign.id].remoteCampaignId,"200");assert.equal(Object.keys(state.executions).length,1);assert.equal(writes,1);assert.equal(f.calls.includes("execute"),false);
  } finally {await f.close();}
});
test("MGA-41 a missing approval rejects every Meta write", async () => {
  const f = await fixture(); try { const p = await f.proposals.create("store-a", f.campaign.id, { kind: "pause", after: {}, reasoning: "Teste", idempotencyKey: "pending-a" }); await assert.rejects(f.service.execute("store-a", p.id, "owner-a"), { code: "approval_required" }); assert.equal(f.calls.includes("execute"), false); assert.equal(Object.keys((await f.repo.read("store-a")).executions).length, 0); } finally { await f.close(); }
});
test("MGA-42 approved preparation persists paused objects without activating them", async () => {
  const f = await fixture(false); try { f.provider.prepare = async (access, campaign, media, progress) => { await access.assertWriteAuthorized!(); assert.equal(campaign.draft.budget!.amountCents, 2000); assert.equal(media[0].id, "media-a"); const objects = [{ type: "campaign" as const, id: "200" }, { type: "ad_set" as const, id: "300" }, { type: "creative" as const, id: "400" }, { type: "ad" as const, id: "500" }]; await progress(objects); return { status: "remote_paused", objects }; }; const p = await f.review(); const result = await f.service.execute("store-a", p.id, "owner-a"); assert.equal(result.status, "remote_paused"); assert.deepEqual(result.objects.map(o => o.type), ["campaign", "ad_set", "creative", "ad"]); const campaign = (await f.repo.read("store-a")).campaigns[f.campaign.id]; assert.equal(campaign.remoteAccountId, "100"); assert.deepEqual(campaign.remoteCreativeIds, ["400"]); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); }
});
test("MGA-26 changed stock or price invalidates approval before sending", async () => {
  for (const change of [{ stockQuantity: 0 }, { commercialVersion: "new-price", priceCents: 12000 }]) { const f = await fixture(); try { const p = await f.review(); Object.assign(f.product, change); await assert.rejects(f.service.execute("store-a", p.id, "owner-a"), { code: "proposal_stale" }); assert.equal((await f.repo.read("store-a")).proposals[p.id].status, "stale"); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); } }
});
test("MGA-44 a manual remote change invalidates the reviewed action", async () => {
  const f = await fixture(); try { const p = await f.review(); const snapshot = await f.provider.snapshot({} as never, f.campaign); f.provider.snapshot = async () => ({ ...snapshot, budget: { daily_budget: "9900" } }); await assert.rejects(f.service.execute("store-a", p.id, "owner-a"), { code: "proposal_stale" }); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); }
});
test("MGA-45 concurrent submissions and replay share exactly one persisted execution", async () => {
  const f = await fixture(); try { let writes = 0; f.provider.execute = async (access) => { await access.assertWriteAuthorized!(); writes++; return { status: "remote_paused", objects: [{ type: "campaign", id: "200" }] }; }; const p = await f.review(); const results = await Promise.all([f.service.execute("store-a", p.id, "owner-a"), f.service.execute("store-a", p.id, "owner-a")]); const replay = await f.service.execute("store-a", p.id, "owner-a"); assert.equal(results[0].id, results[1].id); assert.equal(replay.id, results[0].id); assert.equal(writes, 1); assert.equal(Object.keys((await f.repo.read("store-a")).executions).length, 1); } finally { await f.close(); }
});
test("MGA-46 a timeout stays unknown and replay reconciles by read without resending", async () => {
  const f = await fixture(); try { let writes = 0; f.provider.execute = async () => { writes++; throw new Error("timeout scoped-test-token"); }; const p = await f.review(); const unknown = await f.service.execute("store-a", p.id, "owner-a"); assert.equal(unknown.status, "execution_unknown"); assert.equal(unknown.error, "meta_execution_unknown"); await f.service.execute("store-a", p.id, "owner-a"); assert.equal(writes, 1); const reconciled = await f.service.reconcile("store-a", unknown.id); assert.equal(reconciled.id, unknown.id); assert.equal(reconciled.status, "remote_paused"); assert.equal(writes, 1); } finally { await f.close(); }
});
test("MGA-47 partial preparation preserves created IDs and error without delete or activation", async () => {
  const f = await fixture(false); try { f.provider.prepare = async (_a, _c, _m, progress) => { const objects = [{ type: "campaign" as const, id: "200" }]; await progress(objects); return { status: "failed", objects, error: "meta_dataset_required" }; }; const p = await f.review(); const result = await f.service.execute("store-a", p.id, "owner-a"); assert.equal(result.status, "failed"); assert.equal(result.error, "meta_dataset_required"); assert.deepEqual(result.objects, [{ type: "campaign", id: "200" }]); assert.equal((await f.repo.read("store-a")).campaigns[f.campaign.id].remoteCampaignId, "200"); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); }
});
test("MGA-48 publishing remains pending until a real reconciliation result arrives", async () => {
  const f = await fixture(); try { f.provider.execute = async () => ({ status: "publishing", objects: [{ type: "campaign", id: "200" }] }); f.provider.reconcile = async (_a, _c, execution) => ({ status: "publishing", objects: execution.objects }); const p = await f.review("publish"); const result = await f.service.execute("store-a", p.id, "owner-a"); assert.equal(result.status, "publishing"); assert.equal((await f.service.reconcile("store-a", result.id)).status, "publishing"); f.provider.reconcile = async (_a, _c, execution) => ({ status: "active_unconfirmed", objects: execution.objects }); assert.equal((await f.service.reconcile("store-a", result.id)).status, "active_unconfirmed"); } finally { await f.close(); }
});
test("MGA-49 active configuration is distinct from observed delivery", async () => {
  const f = await fixture(); try { f.provider.execute = async () => ({ status: "active_unconfirmed", objects: [{ type: "campaign", id: "200" }] }); const p = await f.review("publish"); const result = await f.service.execute("store-a", p.id, "owner-a"); assert.equal(result.status, "active_unconfirmed"); assert.equal((await f.repo.read("store-a")).campaigns[f.campaign.id].status, "active_unconfirmed"); f.provider.reconcile = async (_a, _c, execution) => ({ status: "delivered", objects: execution.objects }); assert.equal((await f.service.reconcile("store-a", result.id)).status, "delivered"); } finally { await f.close(); }
});
test("MGA-50 execution audit retains actor, approval, action, time, objects and result without credentials", async () => {
  const f = await fixture(); try { const p = await f.review(); const result = await f.service.execute("store-a", p.id, "owner-a"); const audit = await f.repo.getRecord<Record<string, unknown>>("store-a", `execution-result:${result.id}:1`); assert.equal(audit!.payload.actorId, "owner-a"); assert.equal(audit!.payload.approvedBy, "owner-a"); assert.equal(audit!.payload.digest, p.digest); assert.equal(audit!.payload.kind, "pause"); assert.equal(audit!.createdAt, f.clock().toISOString()); assert.deepEqual(audit!.payload.objects, result.objects); assert.equal(audit!.payload.status, "remote_paused"); assert.equal(JSON.stringify(audit).includes("scoped-test-token"), false); assert.equal(await f.repo.getRecord("store-b", audit!.key), null); } finally { await f.close(); }
});
test("MGA-82 an arbitrary or tampered model operation cannot execute through a saved approval", async () => {
  const f = await fixture(); try { const p = await f.review(); await f.repo.mutate("store-a", [], state => { state.proposals[p.id].kind = "arbitrary-tool" as never; return { result: null }; }); await assert.rejects(f.service.execute("store-a", p.id, "owner-a"), { code: "proposal_version_changed" }); assert.equal(f.calls.includes("execute"), false); } finally { await f.close(); }
});
test("MGA-20 disconnect during a write preserves uncertainty and fences subsequent writes", async () => {
  const f = await fixture(false); try { let blocked = false; f.provider.prepare = async (access, _c, _m, progress) => { await access.assertWriteAuthorized!(); await progress([{ type: "campaign", id: "200" }]); await f.connection.disconnect("store-a"); await assert.rejects(access.assertWriteAuthorized!(), { code: "meta_connection_changed" }); blocked = true; return { status: "remote_paused", objects: [{ type: "campaign", id: "200" }] }; }; const p = await f.review(); const result = await f.service.execute("store-a", p.id, "owner-a"); assert.equal(blocked, true); assert.equal(result.status, "execution_unknown"); assert.equal(result.objects[0].id, "200"); assert.equal((await f.service.reconcile("store-a", result.id)).error, "meta_reconciliation_unavailable"); assert.equal((await f.repo.read("store-a")).connection.encryptedAccessToken, null); } finally { await f.close(); }
});
test("a newly approved pause remains possible at zero stock and foreign accounts remain forbidden", async () => {
  const f = await fixture(); try { f.product.stockQuantity = 0; const p = await f.review(); assert.equal((await f.service.execute("store-a", p.id, "owner-a")).status, "remote_paused"); const other = await f.review(); await f.repo.mutate("store-a", [], state => { state.campaigns[f.campaign.id].remoteAccountId = "999"; return { result: null }; }); await assert.rejects(f.service.execute("store-a", other.id, "owner-a"), { code: "meta_asset_forbidden" }); } finally { await f.close(); }
});
