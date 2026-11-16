import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_TOOLS } from '../../ai-governance/ai-access-policy.js';
import { assistantProduct, assistantScope, metaAssistantFixture } from './__tests__/assistant-fixture.js';

const draft = { name: 'Camisa da loja', variantIds: ['variant-a'], destination: 'store', priority: 'paid_sales', country: 'BR', approvalPreference: 'manual', budget: { amountCents: 10000, currency: 'BRL', cadence: 'lifetime', startsAt: '2026-11-16T03:00:00Z', endsAt: '2026-11-23T03:00:00Z' }, headline: 'Camisa de algodão', primaryText: 'Conheça a camisa da loja' };
test('ADAS-24 catalog returns canonical store product price stock image and identity', async () => {
  const f = await metaAssistantFixture(); try {
    const result = await f.call('merchant_ads_catalog', { query: 'camisa' });
    assert.deepEqual(result.data, { products: [assistantProduct] });
    assert.deepEqual(f.catalogReads, ['store-a']);
    assert.deepEqual(f.governed, ['merchant_ads_catalog']);
  } finally { await f.close(); }
});
test('ADAS-48 actor context tool and thread must be authorized before reading protected catalog', async () => {
  const f = await metaAssistantFixture(); try {
    for (const scope of [{ ...assistantScope, actorId: 'staff-b' }, { ...assistantScope, merchantId: 'store-b' }, { ...assistantScope, context: 'buyer' }])
      await assert.rejects(f.adapter.execute({ ...f.input, scope, name: 'merchant_ads_catalog', args: {} }), /assistant_(forbidden|context_unavailable)/);
    await assert.rejects(f.adapter.execute({ ...f.input, threadId: 'foreign-thread', name: 'merchant_ads_catalog', args: {} }), /assistant_thread_not_found/);
    assert.deepEqual(f.catalogReads, []); assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});
test('ADAS-21 model cannot inject store account authority secrets unknown fields or tools', async () => {
  const f = await metaAssistantFixture(); try {
    for (const [name, args] of [['merchant_ads_catalog', { merchantId: 'store-b' }], ['merchant_ads_save_draft', { ...draft, approvedBy: 'owner-a' }], ['merchant_ads_generate', { imageCount: 1, accountId: '200' }], ['merchant_ads_approve', {}], ['merchant_ads_accept_policy', {}], ['merchant_ads_topup', {}]] as const)
      await assert.rejects(f.call(name, args), /assistant_(tool_unavailable|tool_arguments_invalid)/);
    assert.deepEqual(f.catalogReads, []); assert.deepEqual(f.calls, []);
    assert.equal((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, null);
    for (const tool of f.adapter.tools()) assert.ok((AI_TOOLS as readonly string[]).includes(tool.name));
  } finally { await f.close(); }
});
test('ADAS-24 conversational draft resolves products and creates one canonical campaign on replay', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', { priority: 'paid_sales', variantIds: ['variant-a'] });
    const partial = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    assert.equal(partial.campaignId, null); assert.ok(partial.awaitingFields.includes('budget')); assert.ok(partial.awaitingFields.includes('destination'));
    const first = await f.call('merchant_ads_save_draft', draft); const second = await f.call('merchant_ads_save_draft', draft);
    const state = await f.repo.read('store-a'); const campaigns = Object.values(state.campaigns);
    assert.equal(campaigns.length, 1); assert.deepEqual(campaigns[0].products, [assistantProduct]);
    assert.deepEqual(first.artifacts, second.artifacts); assert.equal(campaigns[0].draft.budget?.amountCents, 10000);
    assert.deepEqual((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress?.awaitingFields, []);
  } finally { await f.close(); }
});
test('ADAS-27 help and corrections preserve campaign identity and prior fields', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft); const before = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    await f.call('merchant_ads_overview');
    await f.call('merchant_ads_save_draft', { headline: 'Nova camisa', approvalPreference: 'automatic' });
    const after = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    assert.equal(after.campaignId, before.campaignId); assert.equal(after.draft.headline, 'Nova camisa');
    assert.deepEqual(after.draft.budget, before.draft.budget); assert.equal(after.approvalPreference, 'automatic');
    assert.equal(Object.values((await f.repo.read('store-a')).campaigns).length, 1);
    assert.equal((await f.repo.listRecords('store-a', 'proposal')).length, 0);
  } finally { await f.close(); }
});
test('ADAS-25 ambiguous budgets unknown product fields and unavailable selection never become authority', async () => {
  const f = await metaAssistantFixture(); try {
    for (const input of [{ ...draft, priceCents: 1 }, { ...draft, budget: { amountCents: 10000 } }, { ...draft, budget: { ...draft.budget, cadence: 'total' } }, { ...draft, variantIds: ['foreign-variant'] }])
      await assert.rejects(f.call('merchant_ads_save_draft', input), /assistant_tool_arguments_invalid|campaign_budget_invalid|campaign_products_unavailable/);
    assert.deepEqual((await f.repo.read('store-a')).campaigns, {});
    assert.equal((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, null);
  } finally { await f.close(); }
});
test('ADAS-28 image requests use actual quota reservation and replay without buying extras or generating twice', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft);
    const first = await f.call('merchant_ads_generate', { imageCount: 2 }); const repeat = await f.call('merchant_ads_generate', { imageCount: 2 });
    assert.deepEqual(first, repeat); assert.equal(first.artifacts[0].type, 'generation');
    const state = await f.repo.read('store-a');
    assert.equal(Object.keys(state.generations).length, 1); assert.equal(Object.keys(state.credits.reservations).length, 2);
    assert.equal(state.credits.monthlyAvailable, 28); assert.equal(f.physicalImages(), 0);
    await assert.rejects(f.call('merchant_ads_generate', { imageCount: 31 }), /assistant_tool_arguments_invalid/);
  } finally { await f.close(); }
});
test('ADAS-29 preparation remains a reviewed proposal and executing unapproved cannot write Meta', async () => {
  const f = await metaAssistantFixture(); try {
    await f.connect(); await f.call('merchant_ads_save_draft', draft);
    const campaignId = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId!;
    await f.repo.mutate('store-a', [], state => {
      state.media['media-a'] = { id: 'media-a', campaignId, productId: 'product-a', variantId: 'variant-a', productVersion: 'version-a', kind: 'image', url: 'https://media.example.test/ad.png', generationId: 'gen-a', createdAt: f.clock().toISOString(), commercialReview: { status: 'verified', productVersion: 'version-a', imageSha256: 'a'.repeat(64), reviewedAt: f.clock().toISOString(), reason: null } };
      return { result: null };
    });
    await f.call('merchant_ads_save_draft', { mediaIds: ['media-a'] });
    const result = await f.call('merchant_ads_propose', { kind: 'prepare', reasoning: 'Preparar pausada para revisão' });
    const p = result.artifacts.find(a => a.type === 'proposal'); assert.ok(p?.type === 'proposal');
    assert.equal(p.proposal.status, 'pending_review'); assert.equal(p.proposal.approvedBy, null); assert.equal(p.execution, null);
    await assert.rejects(f.call('merchant_ads_execute', { proposalId: p.proposal.id }), /approval_required/);
    assert.ok(!f.calls.includes('prepare')); assert.ok(!f.calls.includes('execute'));
    assert.ok(!JSON.stringify(result).includes('remoteBefore')); assert.ok(!JSON.stringify(result).includes('scoped-test-token'));
  } finally { await f.close(); }
});
test('ADAS-22 campaign status is a scoped timestamped configuration read with child state, not proof of delivery', async () => {
  const f = await metaAssistantFixture(); try {
    await f.connect(); await f.call('merchant_ads_save_draft', draft);
    const campaignId = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId!;
    await f.repo.mutate('store-a', [], state => { Object.assign(state.campaigns[campaignId], { remoteAccountId: '100', remoteCampaignId: '200' }); return { result: null }; });
    f.provider.snapshot = async access => { assert.equal(access.accountId, '100'); return { campaignId: '200', status: 'ACTIVE', effectiveStatus: 'ACTIVE', budget: {}, targeting: {}, adSetId: '300', adIds: ['500'], creativeIds: ['400'], objectStates: [{ type: 'ad', id: '500', status: 'PAUSED', effectiveStatus: 'PAUSED' }] }; };
    const result = await f.call('merchant_ads_status'); const status = result.artifacts[0];
    assert.ok(status.type === 'campaign_status'); assert.equal(status.snapshot.accountId, '100'); assert.equal(status.snapshot.checkedAt, f.clock().toISOString());
    assert.equal(status.snapshot.source, 'meta_configuration'); assert.equal(status.snapshot.configuredStatus, 'ACTIVE');
    assert.deepEqual(status.snapshot.objectStates, [{ type: 'ad', id: '500', status: 'PAUSED', effectiveStatus: 'PAUSED' }]);
    assert.equal(status.snapshot.deliveryConfirmed, false);
  } finally { await f.close(); }
});
test('ADAS-48 expired lease and inactive subscription cannot perform tools but retained help stays readable', async () => {
  const f = await metaAssistantFixture(); try {
    f.setNow('2026-11-14T12:02:00Z'); await assert.rejects(f.call('merchant_ads_catalog'), /assistant_lease_lost/);
    f.setNow('2026-12-02T12:00:00Z'); await assert.rejects(f.adapter.authorizeInvocation(assistantScope), /addon_not_entitled/);
    await f.adapter.authorize(assistantScope); assert.deepEqual(f.catalogReads, []);
  } finally { await f.close(); }
});
test('ADAS-21 existing campaigns can be analyzed but not selected for management or execution', async () => {
  const f = await metaAssistantFixture(); try {
    await f.connect(); f.provider.existingCampaigns = async () => [{ id: '888', name: 'Existente', status: 'PAUSED' }];
    const result = await f.call('merchant_ads_analyze_existing', { remoteId: '888', since: '2026-11-01', until: '2026-11-13' });
    assert.equal((result.data as { source: string }).source, 'meta_reported');
    await assert.rejects(f.call('merchant_ads_select_campaign', { campaignId: '888' }), /campaign_read_only/);
    assert.deepEqual((await f.repo.read('store-a')).campaigns, {}); assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
test('ADAS-21 nested draft budget cannot carry hidden authority or arbitrary fields', async () => {
  const f = await metaAssistantFixture(); try {
    await assert.rejects(f.call('merchant_ads_save_draft', { ...draft, budget: { ...draft.budget, accountId: '200' } }), /assistant_tool_arguments_invalid/);
    assert.deepEqual((await f.repo.read('store-a')).campaigns, {});
  } finally { await f.close(); }
});
test('ADAS-27 incomplete correction cannot submit the older canonical campaign instead', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft);
    await f.call('merchant_ads_save_draft', { budget: null });
    await assert.rejects(f.call('merchant_ads_propose', { kind: 'prepare', reasoning: 'Rever orçamento' }), /assistant_campaign_incomplete/);
    assert.deepEqual((await f.repo.read('store-a')).proposals, {});
  } finally { await f.close(); }
});
test('ADAS-27 explicit new campaign resets only conversation progress and preserves prior campaign', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft);
    const first = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId;
    await f.call('merchant_ads_new_campaign');
    assert.equal((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, null);
    await f.call('merchant_ads_save_draft', { ...draft, name: 'Outra campanha' });
    const second = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId;
    assert.notEqual(first, second); assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length, 2);
  } finally { await f.close(); }
});
