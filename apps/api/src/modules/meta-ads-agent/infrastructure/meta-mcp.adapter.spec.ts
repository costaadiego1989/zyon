import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsCampaign, MetaAdsExecution, MetaAdsMedia, MetaAdsProposal } from "@zyon/shared-types";
import type { MetaAccess } from "../domain/types.js";
import { MetaMcpAdapter } from "./meta-mcp.adapter.js";

const access = (): MetaAccess => ({ merchantId: "store-a", accessToken: "scoped-token", clientConversationId: "AbCdEfGhIjKlMnOpQr12", connectionEpoch: 1, accountId: "100", pageId: "110", catalogId: null, datasetId: "120", whatsappId: null });

test('ADC-02 read-only recovery retains known active configuration while Meta processes or reviews the ad',async()=>{for(const state of ['IN_PROCESS','PENDING_REVIEW']){const f=fixture(call=>call.name==='ads_get_ad_entities'?{ad_entities:JSON.stringify([{id:call.args.level==='campaign'?'200':call.args.level==='adset'?'300':'500',status:'ACTIVE',effective_status:call.args.level==='ad'?state:'ACTIVE',campaign_id:'200',adset_id:'300',creative_id:'400',daily_budget:'2000',impressions:{value:0},targeting:{geo_locations:{countries:['BR']}}}])}:undefined);const e={id:'e1',proposalId:'p1',campaignId:'local-a',status:'active_unconfirmed',objects:[{type:'campaign',id:'200'},{type:'ad_set',id:'300'},{type:'ad',id:'500'}],error:null,updatedAt:'2026-11-23T22:00:00Z'} as MetaAdsExecution;const result=await f.adapter.reconcile(access(),campaign(),e);assert.equal(result.status,'active_unconfirmed',state);assert.equal(result.error,undefined);assert.equal(f.calls.some(c=>/create|activate|update/.test(c.name)),false);}});
test('ADC-02 actual Meta impressions confirm delivery while zero or missing impressions cannot',async()=>{for(const value of [0,7,undefined]){const f=fixture(call=>call.name==='ads_get_ad_entities'?{ad_entities:JSON.stringify([{id:call.args.level==='campaign'?'200':call.args.level==='adset'?'300':'500',status:'ACTIVE',effective_status:'ACTIVE',campaign_id:'200',adset_id:'300',creative_id:'400',daily_budget:'2000',impressions:value===undefined?undefined:{value},targeting:{}}])}:undefined);const result=await f.adapter.reconcile(access(),campaign(),{id:'e1',proposalId:'p1',campaignId:'local-a',status:'active_unconfirmed',objects:[],error:null,updatedAt:'2026-11-23T22:00:00Z'});assert.equal(result.status,value===7?'delivered':'active_unconfirmed');assert.equal(f.calls.some(c=>/create|activate|update/.test(c.name)),false);}});

function metricFixture(setting:unknown,available=true){return fixture(call=>{if(call.name==='ads_get_field_context')return{fields:(call.args.field_names as string[]).filter(n=>available||n!=='attribution_setting').map(name=>({name,levels:['campaign','ad_account']})),unknown_fields:[]};if(call.name==='ads_get_ad_entities')return{ad_entities:JSON.stringify([{id:call.args.level==='account'?'100':'200',timezone_name:'America/Sao_Paulo',amount_spent:{value:'10.00',unit:'BRL'},offsite_conversion_fb_pixel_purchase:{value:2},offsite_conversion_fb_pixel_purchase_values:{value:'40.00',unit:'BRL'},attribution_setting:setting}])};return undefined;});}
test('ACW-44 provider metrics preserve requested dates and actual effective attribution setting',async()=>{const f=metricFixture('1d_view_7d_click'),m=await f.adapter.metrics(access(),campaign(),'2026-11-16','2026-11-22');assert.equal(m.since,'2026-11-16');assert.equal(m.until,'2026-11-22');assert.equal(m.timezone,'America/Sao_Paulo');assert.equal(m.requestedAttributionWindow,'7d_click+1d_view');assert.equal(m.effectiveAttributionWindow,'1d_view_7d_click');const call=f.calls.find(c=>c.name==='ads_get_ad_entities'&&c.args.level==='campaign')!;assert.ok((call.args.fields as string[]).includes('attribution_setting'));assert.deepEqual(call.args.action_attribution_windows,['7d_click','1d_view']);assert.equal(f.calls.some(c=>/create|update|activate/.test(c.name)),false);});
test('provider missing attribution field remains unavailable despite the requested window',async()=>{const f=metricFixture('7d_click',false),m=await f.adapter.metrics(access(),campaign(),'2026-11-16','2026-11-22');assert.equal(m.effectiveAttributionWindow,null);assert.equal(m.requestedAttributionWindow,'7d_click+1d_view');assert.equal((f.calls.find(c=>c.name==='ads_get_ad_entities'&&c.args.level==='campaign')!.args.fields as string[]).includes('attribution_setting'),false);});
test('provider mixed attribution is preserved rather than falsely selecting one window',async()=>{const f=metricFixture('multiple'),m=await f.adapter.metrics(access(),campaign(),'2026-11-16','2026-11-22');assert.equal(m.effectiveAttributionWindow,'multiple');});
test('provider unknown malformed or absent effective attribution is never fabricated',async()=>{for(const raw of [undefined,null,{},'invented-window']){const f=metricFixture(raw),m=await f.adapter.metrics(access(),campaign(),'2026-11-16','2026-11-22');assert.equal(m.effectiveAttributionWindow,null);assert.equal(m.attributionWindow,'7d_click+1d_view');}});
test('provider metrics keep effective attribution with canonical amounts and reject a foreign account',async()=>{const f=metricFixture('7d_click'),m=await f.adapter.metrics(access(),campaign(),'2026-11-16','2026-11-22');assert.equal(m.effectiveAttributionWindow,'7d_click');assert.equal(m.spendCents,1000);assert.equal(m.attributedRevenueCents,4000);assert.equal(m.attributedPurchases,2);await assert.rejects(f.adapter.metrics({...access(),accountId:'999'},campaign(),'2026-11-16','2026-11-22'),{code:'meta_asset_forbidden'});});

test('ACJ-07 budget guidance reads only the authorized account floor and does not invent missing minimums',async()=>{
 for(const raw of [570,undefined,0,'unknown']){
  const f=fixture(call=>call.name==='ads_get_ad_accounts'?{ad_accounts:[{ad_account_id:'100',ad_account_name:'Conta',currency:'BRL',is_queryable:true,is_ads_mcp_enabled:true,min_daily_budget_cents:raw}]}:undefined);
  assert.deepEqual(await f.adapter.accountBudgetConstraints(access()),{accountId:'100',currency:'BRL',minimumDailyBudgetCents:raw===570?570:null});
  await assert.rejects(f.adapter.accountBudgetConstraints({...access(),accountId:'999'}),{code:'meta_asset_forbidden'});assert.equal(f.calls.some(call=>/create|activate|update/.test(call.name)),false);
 }
});
const campaign = (): MetaAdsCampaign => ({ id: "local-a", createdByAgent: true, managed: true, remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], status: "remote_paused", createdAt: "2026-11-14T12:00:00Z", updatedAt: "2026-11-14T12:00:00Z", products: [{ productId: "product-a", variantId: "variant-a", name: "Produto", description: "Produto real", sku: "SKU-A", imageUrl: "https://media.example.test/original.png", priceCents: 10000, currency: "BRL", stockQuantity: 5, active: true, storefrontUrl: "https://store.example.test/product-a", commercialVersion: "v1" }], draft: { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: { amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null }, mediaIds: ["media-a"], headline: "Produto", primaryText: "Conheca o produto", country: "BR" } });
const media: MetaAdsMedia[] = [{ id: "media-a", campaignId: "local-a", variantId: "variant-a", productId: "product-a", url: "https://media.example.test/generated.png", productVersion: "v1", createdAt: "2026-11-14T12:00:00Z" }];
const proposal = (kind: MetaAdsProposal["kind"]): MetaAdsProposal => ({ id: "proposal-a", campaignId: "local-a", kind, status: "approved", before: {}, after: {}, digest: "approved-digest", connectionEpoch: 1, reasoning: "Revisado", createdAt: "2026-11-14T12:00:00Z", approvedAt: "2026-11-14T12:01:00Z", approvedBy: "owner-a", executionId: null });

function launchFixture(override?: (call: Call) => unknown | Promise<unknown>, omitted: string[] = []) {
  const c = campaign(); Object.assign(c, { remoteCampaignId: null, remoteAdSetId: null, remoteAdIds: [], remoteAccountId: null });
  c.draft.budget = { amountCents: 10000, currency: 'BRL', cadence: 'lifetime', startsAt: '2026-11-17T12:00:00.000Z', endsAt: '2026-11-24T12:00:00.000Z' };
  const selected = structuredClone(media); selected[0].commercialReview = { status: 'verified', productVersion: 'v1', imageSha256: 'a'.repeat(64) };
  const p = { ...proposal('launch'), after: structuredClone({ objects: ['campaign', 'ad_set', 'creative', 'ad'], draft: c.draft, products: c.products, media: selected, accountId: '100', pageId: '110', datasetId: '120', whatsappId: null, status: 'ACTIVE' }) };
  const f = fixture(async call => {
    const result = await override?.(call); if (result !== undefined) return result;
    if (call.name === 'ads_activate_entity') return { result: { status: 'ACTIVE' } };
    if (call.name === 'ads_get_ad_entities') {
      const shared = { account_id: '100', campaign_id: '200', status: 'PAUSED', effective_status: 'PAUSED' };
      const row = call.args.level === 'campaign' ? { ...shared, id: '200', lifetime_budget: '10000', daily_budget: '0' }
        : call.args.level === 'adset' ? { ...shared, id: '300', start_time: c.draft.budget!.startsAt, end_time: c.draft.budget!.endsAt }
        : { ...shared, id: '500', adset_id: '300', creative_id: '400' };
      return { ad_entities: JSON.stringify([row]) };
    }
    return undefined;
  }, omitted);
  let checks = 0;
  const scoped = { ...access(), assertWriteAuthorized: async () => { checks++; } };
  return { ...f, c, p, selected, scoped, checks: () => checks };
}
test('ACAP-13 native launch creates paused objects and publishes the same reviewed version with one approval', async () => {
  const f = launchFixture(), before = structuredClone(f.p), progress: MetaAdsExecution['objects'][] = [];
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async refs => { progress.push(structuredClone(refs)); });
  assert.equal(result.status, 'active_unconfirmed'); assert.deepEqual(result.objects, [{ type: 'campaign', id: '200' }, { type: 'ad_set', id: '300' }, { type: 'creative', id: '400' }, { type: 'ad', id: '500' }]);
  assert.deepEqual(f.p, before); assert.equal(f.checks(), 7); assert.equal(progress.length, 7); assert.deepEqual(progress[3], result.objects);
  assert.equal(f.calls.find(call => call.name === 'ads_create_campaign')!.args.campaign_lifetime_budget, 10000);
  assert.equal(f.calls.find(call => call.name === 'ads_create_ad_set')!.args.end_time, '2026-11-24T12:00:00.000Z');
  assert.deepEqual(f.calls.filter(call => call.name === 'ads_activate_entity').map(call => [call.args.entity_type, call.args.entity_id]), [['campaign', '200'], ['ad_set', '300'], ['ad', '500']]);
});
test('ACAP-13 native launch preserves reviewed carousel order and copy', async () => {
  const f = launchFixture(), second = { ...f.selected[0], id: 'media-b', url: 'https://media.example.test/second.png' };
  f.c.draft.mediaIds = ['media-b', 'media-a']; f.p.after.draft = structuredClone(f.c.draft); f.p.after.media = [second, f.selected[0]];
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {}); assert.equal(result.status, 'active_unconfirmed');
  const creative = f.calls.find(call => call.name === 'ads_create_creative')!.args;
  assert.deepEqual((creative.cards as Array<{ image_url: string }>).map(card => card.image_url), ['https://media.example.test/second.png', 'https://media.example.test/generated.png']);
  assert.equal(creative.message, f.c.draft.primaryText); assert.equal(creative.headline, f.c.draft.headline);
});
test('ACAP-14 native launch rejects changed reviewed draft media and selected assets before creation', async () => {
  for (const change of ['copy', 'order', 'asset', 'review']) {
    const f = launchFixture();
    if (change === 'copy') f.c.draft.primaryText = 'Texto alterado'; if (change === 'order') f.c.draft.mediaIds = ['media-b']; if (change === 'asset') f.scoped.pageId = '111'; if (change === 'review') (f.p.after.media as MetaAdsMedia[])[0].commercialReview!.status = 'rejected';
    const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
    assert.equal(result.status, 'failed'); assert.equal(result.error, 'proposal_stale'); assert.deepEqual(result.objects, []); assert.equal(f.calls.some(call => call.name.startsWith('ads_create_')), false);
  }
});
test('ACAP-14 native launch rechecks authority between paused preparation and activation', async () => {
  const f = launchFixture(); let checks = 0;
  f.scoped.assertWriteAuthorized = async () => { if (++checks > 4) throw new Error('revoked'); };
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.objects.length, 4); assert.notEqual(result.status, 'active_unconfirmed'); assert.equal(checks, 5); assert.equal(f.calls.filter(call => call.name === 'ads_activate_entity').length, 0);
});
test('ACAP-14 native launch verifies exact remote budget dates account and parent bindings before activation', async () => {
  for (const [level, changed] of [['campaign', { lifetime_budget: '9999' }], ['campaign', { daily_budget: '100' }], ['campaign', { account_id: '999' }], ['adset', { start_time: '2026-11-18T12:00:00Z' }], ['adset', { end_time: '2026-11-23T12:00:00Z' }], ['adset', { campaign_id: '999' }], ['ad', { adset_id: '999' }], ['ad', { creative_id: '999' }]] as const) {
    const f = launchFixture(call => call.name === 'ads_get_ad_entities' && call.args.level === level ? { ad_entities: JSON.stringify([{ id: level === 'campaign' ? '200' : level === 'adset' ? '300' : '500', account_id: '100', campaign_id: '200', adset_id: '300', creative_id: '400', status: 'PAUSED', effective_status: 'PAUSED', lifetime_budget: '10000', daily_budget: '0', start_time: '2026-11-17T12:00:00.000Z', end_time: '2026-11-24T12:00:00.000Z', ...changed }]) } : undefined);
    const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
    assert.equal(result.status, 'failed'); assert.equal(result.objects.length, 4); assert.equal(f.calls.filter(call => call.name === 'ads_activate_entity').length, 0);
  }
});
test('ACAP-15 a lost native creation response keeps partial IDs without creating or publishing again', async () => {
  const f = launchFixture(call => { if (call.name === 'ads_create_ad_set') throw new Error('lost response'); });
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.status, 'execution_unknown'); assert.deepEqual(result.objects, [{ type: 'campaign', id: '200' }]);
  assert.equal(f.calls.filter(call => call.name === 'ads_create_campaign').length, 1); assert.equal(f.calls.filter(call => call.name === 'ads_create_ad_set').length, 1); assert.equal(f.calls.filter(call => call.name === 'ads_activate_entity').length, 0);
});
test('ACAP-15 an uncertain activation preserves all objects and never retries the submitted activation', async () => {
  const f = launchFixture(call => { if (call.name === 'ads_activate_entity') throw new Error('lost activation'); });
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.status, 'execution_unknown'); assert.equal(result.objects.length, 4); assert.equal(f.calls.filter(call => call.name === 'ads_activate_entity').length, 1); assert.equal(f.calls.filter(call => call.name === 'ads_create_campaign').length, 1);
});
test('ACAP-15 native PUBLISHING remains pending without claiming delivery or repeating the activation', async () => {
  const f = launchFixture(call => call.name === 'ads_activate_entity' ? { result: { status: 'PUBLISHING' } } : undefined);
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.status, 'publishing'); assert.equal(result.objects.length, 4); assert.equal(f.calls.filter(call => call.name === 'ads_activate_entity').length, 1);
});
test('ACAP-14 native launch refuses existing remote objects instead of activating another campaign', async () => {
  const f = launchFixture(); f.c.remoteCampaignId = '999';
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'campaign_already_prepared'); assert.deepEqual(result.objects, []); assert.equal(f.calls.length, 0);
});

// The live Meta MCP represents new objects as EDITING drafts with values.<field>.new.
// Relationship numbers can exceed JS precision; the top-level string parents are exact.
function draftLaunchFixture(change?: (level: string, rows: Record<string, unknown>[]) => void, activationStatus = 'PUBLISHING') {
  const ids = {campaign: '120250883217370637', adset: '120250883217830637', ad: '120250883218280637'};
  return launchFixture(call => {
    if (call.name === 'ads_create_campaign') return {campaign_id: ids.campaign, status: 'DRAFT', valid_optimization_goals: '["OFFSITE_CONVERSIONS"]'};
    if (call.name === 'ads_create_ad_set') return {ad_set_id: ids.adset, status: 'DRAFT'};
    if (call.name === 'ads_create_ad') return {ad_id: ids.ad, status: 'DRAFT'};
    if (call.name === 'ads_activate_entity') return {result: {status: activationStatus}};
    if (call.name !== 'ads_get_ad_entities') return undefined;
    if (call.args.object_state !== 'draft') return {ad_entities: '[]'};
    const level = String(call.args.level), name = campaign().draft.name;
    const values = level === 'campaign' ? {name, status: 'ACTIVE', lifetime_budget: 10000, objective: 'OUTCOME_SALES'}
      : level === 'adset' ? {name, status: 'ACTIVE', campaign_id: Number(ids.campaign), start_time: '2026-11-17T12:00:00.000Z', end_time: '2026-11-24T12:00:00.000Z', destination_type: 'WEBSITE', optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: {pixel_id: 120, custom_event_type: 'PURCHASE'}, targeting: {geo_locations: {countries: ['BR']}, age_min: 18, age_range: [18,65], targeting_automation: {advantage_audience: 1}}}
      : {name, status: 'ACTIVE', campaign_id: Number(ids.campaign), adset_id: ids.adset, creative: {creative_id: '400'}};
    const rows: Record<string, unknown>[] = [{ad_object_id: ids[level as keyof typeof ids], ad_object_type: level, parent_ad_object_id: level === 'campaign' ? null : level === 'adset' ? ids.campaign : ids.adset, action: 'add', status: 'EDITING', source: 'mcp_campaign_creation', validation_status: 'VALIDATED', values: Object.fromEntries(Object.entries(values).map(([key,value]) => [key,{new:value}])), active_errors: [], publish_error: null}];
    change?.(level, rows);
    return {ad_drafts: JSON.stringify(rows)};
  });
}

test('ACAP-13 DRAFT publication verifies the actual staged values and exact large string parents', async () => {
  const f = draftLaunchFixture(), result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.status, 'publishing');
  assert.deepEqual(result.objects.map(ref => ref.id), ['120250883217370637','120250883217830637','400','120250883218280637']);
  const activation = f.calls.filter(c => c.name === 'ads_activate_entity');
  assert.equal(activation.length, 1);
  assert.deepEqual(activation[0].args.object_ids, ['120250883217370637','120250883217830637','120250883218280637']);
  assert.equal(activation[0].args.publish_as_active, true);
  assert.equal(activation[0].args.allow_partial_publish, false);
  assert.ok(f.calls.filter(c => c.name === 'ads_get_ad_entities').every(c => c.args.ad_account_id === '100'));
  assert.equal(f.calls.filter(c => c.name === 'ads_create_campaign').length, 1);
});

test('ACAP-13 DRAFT synchronous ACTIVE publishes the complete reviewed object list only once', async () => {
  const f = draftLaunchFixture(undefined, 'ACTIVE');
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.status, 'active_unconfirmed');
  assert.equal(result.objects.length, 4);
  const calls = f.calls.filter(call => call.name === 'ads_activate_entity');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.object_ids, ['120250883217370637','120250883217830637','120250883218280637']);
});

test('ACAP-14 DRAFT rejects unreviewed audience restrictions and optimization goals', async () => {
  for (const mode of ['gender','maximum-age','extra-location','automation','goal']) {
    const f = draftLaunchFixture((level,rows) => {
      if(level !== 'adset')return;
      const values = rows[0].values as Record<string,{new:unknown}>;
      const targeting = values.targeting.new as Record<string,unknown>;
      if(mode === 'gender')targeting.genders=[1];
      if(mode === 'maximum-age')targeting.age_range=[18,30];
      if(mode === 'extra-location')(targeting.geo_locations as Record<string,unknown>).cities=[{key:'123'}];
      if(mode === 'automation')targeting.targeting_automation={advantage_audience:1,individual_settings:{}};
      if(mode === 'goal')values.optimization_goal={new:'LINK_CLICKS'};
    });
    const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
    assert.equal(result.status, 'failed', mode);
    assert.equal(result.error, 'proposal_stale', mode);
    assert.equal(result.objects.length, 4);
    assert.equal(f.calls.filter(call => call.name === 'ads_activate_entity').length, 0, mode);
  }
});

test('ACAP-13 DRAFT accepts only the unchanged Meta audience expansion defaults', async () => {
  const f = draftLaunchFixture((level,rows) => {
    if(level === 'adset')(((rows[0].values as Record<string,{new:unknown}>).targeting.new) as Record<string,unknown>).targeting_optimization='expansion_all';
  });
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
  assert.equal(result.status, 'publishing');
  assert.equal(f.calls.filter(call => call.name === 'ads_activate_entity').length, 1);
});

test('ACAP-14 DRAFT publication blocks altered budget dates hierarchy creative and assets before activation', async () => {
  for (const [level, field, value] of [
    ['campaign','lifetime_budget',9999],['campaign','daily_budget',100],['campaign','account_id','999'],
    ['adset','start_time','2026-11-18T12:00:00Z'],['adset','end_time','2026-11-23T12:00:00Z'],
    ['adset','campaign_id','999'],['adset','promoted_object',{pixel_id:'999',custom_event_type:'PURCHASE'}],
    ['adset','destination_type','WHATSAPP'],['adset','targeting',{geo_locations:{countries:['US']},age_min:18,targeting_automation:{advantage_audience:1}}],
    ['ad','adset_id','999'],['ad','creative',{creative_id:'999'}],['ad','status','DELETED'],
  ] as const) {
    const f = draftLaunchFixture((current,rows) => {if(current === level)(rows[0].values as Record<string,unknown>)[field] = {new:value};});
    const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
    assert.equal(result.status, 'failed', `${level}.${field}`);
    assert.equal(f.calls.filter(c => c.name === 'ads_activate_entity').length, 0, `${level}.${field}`);
    assert.equal(result.objects.length, 4);
  }
});

test('ACAP-14 DRAFT publication refuses missing duplicate wrong-type foreign-parent and invalid drafts', async () => {
  for (const mode of ['missing','duplicate','wrong-type','parent','errors','validation','publish-error','unwrapped']) {
    const f = draftLaunchFixture((level,rows) => {
      if(level !== 'adset')return;
      if(mode === 'missing')rows.length=0;
      else if(mode === 'duplicate')rows.push(structuredClone(rows[0]));
      else if(mode === 'wrong-type')rows[0].ad_object_type='ad';
      else if(mode === 'parent')rows[0].parent_ad_object_id='120250883217370638';
      else if(mode === 'errors')rows[0].active_errors=[{code:1}];
      else if(mode === 'validation')rows[0].validation_status='INVALID';
      else if(mode === 'publish-error')rows[0].publish_error={status:'FAILED'};
      else (rows[0].values as Record<string,unknown>).start_time='2026-11-17T12:00:00.000Z';
    });
    const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {});
    assert.equal(result.status, 'failed',mode);
    assert.equal(f.calls.filter(c => c.name === 'ads_activate_entity').length, 0,mode);
  }
});
test('ACAP-11 native launch requires a human receipt and publication capability before any creation', async () => {
  const f = launchFixture(undefined, ['ads_activate_entity']);
  const result = await f.adapter.execute(f.scoped, f.c, f.p, async () => {}); assert.equal(result.status, 'failed'); assert.equal(result.error, 'meta_capability_unavailable'); assert.equal(f.calls.some(call => call.name.startsWith('ads_create_')), false);
  const other = launchFixture(); other.p.approvedBy = null;
  await assert.rejects(other.adapter.execute(other.scoped, other.c, other.p, async () => {}), { code: 'proposal_not_approved' }); assert.equal(other.calls.length, 0);
});

test('ADAS-29 native MCP budget currency wrappers normalize major BRL units to exact cents', async () => {
  const f = fixture(call => call.name === 'ads_get_ad_entities' && call.args.level === 'campaign' ? { ad_entities: JSON.stringify({ data: [{ id: '200', status: 'PAUSED', effective_status: 'PAUSED', daily_budget: { value: 0, unit: 'BRL' }, lifetime_budget: { value: '100.05', unit: 'BRL' }, spend_cap: { value: 0, unit: 'BRL' } }] }) } : undefined);
  const snapshot = await f.adapter.snapshot(access(), campaign());
  assert.deepEqual(snapshot.budget, { daily_budget: 0, lifetime_budget: 10005, spend_cap: 0 });
});

test('ADAS-44 native metric fields use canonical names and exact currency or integer values', async () => {
  const f = fixture(call => {
    if (call.name === 'ads_get_ad_entities' && call.args.level === 'account') return { ad_entities: JSON.stringify([{ id: '100', timezone_name: 'America/Sao_Paulo' }]) };
    if (call.name === 'ads_get_field_context') return { unknown_fields: [], fields: (call.args.field_names as string[]).map(name => ({ name, levels: name === 'timezone_name' ? ['ad_account'] : ['campaign', 'ad_account'], type: ['amount_spent', 'offsite_conversion_fb_pixel_purchase_values'].includes(name) ? 'CURRENCY' : name.includes('conversion') ? 'INTEGER' : 'STRING' })) };
    if (call.name === 'ads_get_ad_entities' && call.args.level === 'campaign') return { ad_entities: JSON.stringify([{ id: '200', amount_spent: { value: '10.05', unit: 'BRL' }, offsite_conversion_fb_pixel_purchase_values: { value: 99, unit: 'BRL' }, offsite_conversion_fb_pixel_purchase: { value: 2 }, 'actions:onsite_conversion.messaging_conversation_started_7d': { value: 3 } }]) };
    return undefined;
  });
  const result = await f.adapter.metrics(access(), campaign(), '2026-11-15', '2026-11-15');
  assert.equal(result.spendCents, 1005); assert.equal(result.attributedRevenueCents, 9900); assert.equal(result.attributedPurchases, 2); assert.equal(result.conversations, 3); assert.equal(result.timezone, 'America/Sao_Paulo');
  const fields = f.calls.find(c => c.name === 'ads_get_ad_entities' && c.args.level === 'campaign')!.args.fields as string[];
  assert.ok(fields.includes('amount_spent')); assert.ok(fields.includes('actions:onsite_conversion.messaging_conversation_started_7d')); assert.equal(fields.includes('spend'), false);
});

test('ADAS-43 missing or incompatible native metric values remain unknown rather than confirmed zeros', async () => {
  const f = fixture(call => {
    if (call.name === 'ads_get_ad_entities' && call.args.level === 'account') return { ad_entities: JSON.stringify([{ id: '100', timezone_name: 'America/Sao_Paulo' }]) };
    if (call.name === 'ads_get_ad_entities' && call.args.level === 'campaign') return { ad_entities: JSON.stringify([{ id: '200', amount_spent: { value: '10', unit: 'USD' } }]) };
    return undefined;
  });
  const result = await f.adapter.metrics(access(), campaign(), '2026-11-15', '2026-11-15');
  assert.equal(result.spendCents, null); assert.equal(result.attributedRevenueCents, null); assert.equal(result.attributedPurchases, null); assert.equal(result.conversations, null);
});
test('AGW-07 native list metrics use verified campaign fields and preserve zero versus unknown',async()=>{
 const f=fixture(call=>{
  if(call.name==='ads_get_field_context')return {unknown_fields:[],fields:(call.args.field_names as string[]).filter(name=>name!=='reach').map(name=>({name,levels:['campaign','ad_account']}))};
  if(call.name==='ads_get_ad_entities'&&call.args.level==='campaign')return {ad_entities:JSON.stringify([{id:'200',impressions:{value:1200},link_click:{value:0},reach:999}])};return undefined;
 });
 const result=await f.adapter.metrics(access(),campaign(),'2026-11-17','2026-11-17');
 assert.equal(result.impressions,1200);assert.equal(result.linkClicks,0);assert.equal(result.reach,null);
 const fields=f.calls.find(call=>call.name==='ads_get_ad_entities'&&call.args.level==='campaign')!.args.fields as string[];
 assert.ok(fields.includes('impressions'));assert.ok(fields.includes('link_click'));assert.equal(fields.includes('reach'),false);assert.equal(fields.includes('inline_link_clicks'),false);
});

test('ADAS-34 native MCP accepts an automatic pending proposal only with the exact server authority and live write lease', async () => {
  const f = fixture(), p = { ...proposal('pause'), status: 'pending_review' as const, approvedBy: null, approvedAt: null }; let checks = 0;
  const scoped = { ...access(), executionAuthority: { kind: 'automatic', proposalId: p.id, proposalDigest: p.digest, connectionEpoch: p.connectionEpoch, policyId: 'policy-a', policyVersion: 1 }, assertWriteAuthorized: async () => { checks++; } };
  const result = await f.adapter.execute(scoped as never, campaign(), p, async () => {});
  assert.equal(result.status, 'remote_paused'); assert.equal(checks, 1); assert.equal(p.approvedBy, null); assert.equal(p.status, 'pending_review');
});

test('ADAS-31 native MCP refuses a forged or unfenced automatic authorization without weakening manual approval', async () => {
  const f = fixture(), p = { ...proposal('pause'), status: 'pending_review' as const, approvedBy: null, approvedAt: null };
  const authority = { kind: 'automatic', proposalId: p.id, proposalDigest: p.digest, connectionEpoch: p.connectionEpoch, policyId: 'policy-a', policyVersion: 1 };
  for (const scoped of [{ ...access(), executionAuthority: authority }, { ...access(), executionAuthority: { ...authority, proposalDigest: 'changed' }, assertWriteAuthorized: async () => {} }]) await assert.rejects(f.adapter.execute(scoped as never, campaign(), p, async () => {}), { code: 'proposal_not_approved' });
  assert.equal(f.calls.some(call => call.name === 'ads_update_entity'), false);
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
  const activation=f.calls.find(c => c.name === 'ads_activate_entity')!.args;
  assert.equal(activation.entity_id,'200');assert.equal(activation.entity_type,'campaign');
  assert.equal(Object.hasOwn(activation,'object_ids'),false);assert.equal(Object.hasOwn(activation,'publish_as_active'),false);
});

test('ARP-01 published paused entities activate individually without draft-only parameters or unrelated edits',async()=>{
  const f=fixture(call=>{
    if(call.name!=='ads_activate_entity')return undefined;
    if(['object_ids','publish_as_active','allow_partial_publish','ignore_validation_errors'].some(key=>Object.hasOwn(call.args,key)))return{error_category:'VALIDATION',error:'draft_parameters_on_live_entity'};
    return{result:{status:'ACTIVE'}};
  });
  const result=await f.adapter.execute(access(),campaign(),proposal('publish'),async()=>{});
  assert.equal(result.status,'active_unconfirmed');assert.equal(result.error,undefined);
  const writes=f.calls.filter(c=>/create|activate|update/.test(c.name));assert.equal(writes.length,3);
  assert.deepEqual(writes.map(c=>[c.name,c.args.ad_account_id,c.args.entity_type,c.args.entity_id]),[['ads_activate_entity','100','campaign','200'],['ads_activate_entity','100','ad_set','300'],['ads_activate_entity','100','ad','500']]);
  for(const call of writes)for(const key of ['object_ids','publish_as_active','allow_partial_publish','ignore_validation_errors'])assert.equal(Object.hasOwn(call.args,key),false,key);
});
test('ARP-01 partial live activation with a lost child response stops before any later object or retry',async()=>{
  const f=fixture(call=>call.name==='ads_activate_entity'?call.args.entity_type==='ad_set'?Promise.reject(new Error('lost response')):{result:{status:'ACTIVE'}}:undefined);
  const result=await f.adapter.execute(access(),campaign(),proposal('publish'),async()=>{});
  assert.equal(result.status,'execution_unknown');assert.deepEqual(result.objects,[{type:'campaign',id:'200'},{type:'ad_set',id:'300'},{type:'ad',id:'500'}]);
  assert.deepEqual(f.calls.filter(c=>c.name==='ads_activate_entity').map(c=>c.args.entity_id),['200','300']);
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

test('ACJ-03 WhatsApp Business linkage is accepted only for the authorized Page while absent or denied links stay distinct',async()=>{
 for(const state of ['business','absent','denied','foreign']){
  const f=fixture(),request:typeof fetch=async(url,init)=>String(url).startsWith('https://graph.facebook.com/')?new Response(JSON.stringify(state==='denied'?{error:{code:200}}:{id:state==='foreign'?'999':'110',whatsapp_number:'+55 11 99999-9999',has_whatsapp_number:false,has_whatsapp_business_number:state!=='absent'}),{status:state==='denied'?403:200}):f.request(url,init);
  const adapter=new MetaMcpAdapter({META_ADS_AGENT_REMOTE_WRITES_ENABLED:'true',META_ADS_GRAPH_API_VERSION:'v26.0'},request),result=await adapter.discover(access());
  assert.equal(result.whatsappNumbers.length,state==='business'?1:0);assert.equal(result.capabilities.whatsapp,state==='business');assert.equal(result.errors.includes('whatsapp_unavailable'),['denied','foreign'].includes(state));assert.equal(f.calls.some(call=>/create|update|activate/.test(call.name)),false);
 }
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
