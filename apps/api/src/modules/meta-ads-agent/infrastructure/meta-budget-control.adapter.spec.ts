import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MetaAdsCampaign, MetaAdsAutomationLimits } from '@zyon/shared-types';
import type { MetaAccess } from '../domain/types.js';
import { MetaBudgetControlAdapter } from './meta-budget-control.adapter.js';

const access = (): MetaAccess => ({ merchantId: 'store-a', accessToken: 'scoped-token', clientConversationId: 'AbCdEfGhIjKlMnOpQr12', connectionEpoch: 3, accountId: '100', pageId: '110', catalogId: null, datasetId: '120', whatsappId: null });
const budget = { amountCents: 10000, currency: 'BRL' as const, cadence: 'lifetime' as const, startsAt: '2026-11-16T12:00:00.000Z', endsAt: '2026-11-23T12:00:00.000Z' };
const limits: MetaAdsAutomationLimits = { currency: 'BRL', cadence: 'lifetime', campaignCeilingCents: 10000, storeCeilingCents: 20000, startsAt: budget.startsAt, endsAt: budget.endsAt };
const campaign = (): MetaAdsCampaign => ({ id: 'local-a', createdByAgent: true, managed: true, remoteCampaignId: '200', remoteAccountId: '100', remoteAdSetId: '300', remoteAdIds: ['500'], products: [], status: 'remote_paused', createdAt: budget.startsAt, updatedAt: budget.startsAt, draft: { name: 'Campanha', variantIds: ['variant-a'], destination: 'store', priority: 'roas', country: 'BR', mediaIds: [], headline: '', primaryText: '', budget } });
function fixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []; const verified = new Set<string>();
  const unknown = new Set<string>(); let currency = 'BRL';
  const rows: Record<string, Record<string, unknown>[]> = {
    campaign: [{ id: '200', account_id: '100', lifetime_budget: { value: 100, unit: 'BRL' }, daily_budget: { value: 0, unit: 'BRL' }, spend_cap: { value: 0, unit: 'BRL' }, start_time: budget.startsAt, stop_time: budget.endsAt, status: 'PAUSED' }],
    adset: [{ id: '300', account_id: '100', campaign_id: '200', start_time: budget.startsAt, end_time: budget.endsAt, status: 'PAUSED' }],
    ad: [{ id: '500', account_id: '100', campaign_id: '200', adset_id: '300', status: 'PAUSED' }],
  };
  const levels = (field: string) => field === 'campaign_id' ? ['adset', 'ad'] : field === 'adset_id' ? ['ad'] : field === 'end_time' ? ['adset'] : ['lifetime_budget', 'daily_budget', 'spend_cap', 'stop_time'].includes(field) ? ['campaign'] : ['campaign', 'adset', 'ad'];
  const request: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://mcp.facebook.com/ads'); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer scoped-token');
    const rpc = JSON.parse(String(init?.body)); let result: unknown;
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'controlled-meta', version: '1' } };
    else if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    else if (rpc.method === 'tools/list') result = { tools: ['ads_get_ad_accounts', 'ads_get_field_context', 'ads_get_ad_entities'].map(name => ({ name, inputSchema: { type: 'object', properties: {}, additionalProperties: true } })) };
    else {
      const name = rpc.params.name; const args = rpc.params.arguments; calls.push({ name, args }); let body: unknown;
      if (name === 'ads_get_ad_accounts') body = { ad_accounts: [{ ad_account_id: '100', ad_account_name: 'Loja', currency, is_ads_mcp_enabled: true, is_queryable: true, has_payment_method: true }] };
      else if (name === 'ads_get_field_context') {
        for (const field of args.field_names) if (!unknown.has(field)) verified.add(field);
        body = { fields: args.field_names.filter((f: string) => !unknown.has(f)).map((field: string) => ({ name: field, levels: levels(field), type: /budget|cap/.test(field) ? 'CURRENCY' : 'STRING', filterable: ['id', 'campaign_id'].includes(field), supported_filter_operators: ['id', 'campaign_id'].includes(field) ? ['IN', 'EQUAL'] : [] })), unknown_fields: [...unknown] };
      } else {
        assert.equal(name, 'ads_get_ad_entities'); assert.equal(args.ad_account_id, '100');
        for (const field of args.fields) assert.ok(verified.has(field));
        if (args.level !== 'campaign') assert.deepEqual(args.filtering, [{ field: 'campaign_id', operator: 'IN', value: ['200'] }]);
        body = { ad_entities: JSON.stringify({ data: rows[args.level] }) };
      }
      result = { structuredContent: body, content: [] };
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { headers: { 'Content-Type': 'application/json' } });
  };
  return { adapter: new MetaBudgetControlAdapter({ request, clock: () => new Date('2026-11-16T12:01:00Z') }), calls, rows, unknown, currency: (value: string) => { currency = value; } };
}
test('ADAS-37 explicit BRL lifetime budget and finite remote child schedule prove a scoped hard limit without writes', async () => {
  const f = fixture(); const proof = await f.adapter.prove(access(), campaign(), budget, limits);
  assert.equal(proof.kind, 'campaign_lifetime'); assert.equal(proof.amountCents, 10000); assert.equal(proof.currency, 'BRL');
  assert.equal(proof.accountId, '100'); assert.equal(proof.campaignId, 'local-a'); assert.equal(proof.remoteCampaignId, '200'); assert.equal(proof.connectionEpoch, 3);
  assert.equal(proof.startsAt, budget.startsAt); assert.equal(proof.endsAt, budget.endsAt); assert.equal(proof.checkedAt, '2026-11-16T12:01:00.000Z');
  assert.deepEqual(proof.adIds, ['500']); assert.equal(proof.adSetId, '300'); assert.match(proof.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(f.calls.every(c => ['ads_get_ad_accounts', 'ads_get_field_context', 'ads_get_ad_entities'].includes(c.name)));
  assert.ok(!JSON.stringify(proof).includes('scoped-token'));
});
test('ADAS-37 daily budget and spend cap with unproven eligibility cannot grant an automatic hard ceiling', async () => {
  const f = fixture(); f.rows.campaign[0].daily_budget = { value: 100, unit: 'BRL' }; f.rows.campaign[0].lifetime_budget = { value: 0, unit: 'BRL' }; f.rows.campaign[0].spend_cap = { value: 100, unit: 'BRL' };
  await assert.rejects(f.adapter.prove(access(), campaign(), { ...budget, cadence: 'daily' }, { ...limits, cadence: 'daily' }), { code: 'automatic_budget_control_unavailable' });
  assert.ok(!f.calls.some(c => c.name.includes('update') || c.name.includes('activate')));
});
test('ADAS-35 publication requires exact budget and date match inside the accepted ceiling', async () => {
  const f = fixture(); f.rows.campaign[0].lifetime_budget = { value: 150, unit: 'BRL' };
  await assert.rejects(f.adapter.prove(access(), campaign(), budget, limits), { code: 'authorization_limit_exceeded' });
  const observed = await f.adapter.read(access(), campaign()); assert.equal(observed.amountCents, 15000);
  const reducing = await f.adapter.prove(access(), campaign(), { ...budget, amountCents: 5000 }, limits, false); assert.equal(reducing.amountCents, 15000);
  f.rows.adset[0].end_time = '2026-11-24T12:00:00Z';
  await assert.rejects(f.adapter.prove(access(), campaign(), budget, limits), { code: 'authorization_limit_exceeded' });
});
test('ADAS-37 unsupported metadata missing dates and ambiguous or foreign currency never become proven cents', async () => {
  for (const amount of [10000, '10000', { value: 100, unit: 'USD' }, { value: '100.001', unit: 'BRL' }, { value: -1, unit: 'BRL' }]) {
    const f = fixture(); f.rows.campaign[0].lifetime_budget = amount;
    await assert.rejects(f.adapter.read(access(), campaign()), { code: 'automatic_budget_control_unavailable' });
  }
  const f = fixture(); f.unknown.add('end_time'); await assert.rejects(f.adapter.read(access(), campaign()), { code: 'automatic_budget_control_unavailable' });
  const missing = fixture(); delete missing.rows.adset[0].end_time; await assert.rejects(missing.adapter.read(access(), campaign()), { code: 'automatic_budget_control_unavailable' });
  const usd = fixture(); usd.currency('USD'); await assert.rejects(usd.adapter.read(access(), campaign()), { code: 'automatic_budget_control_unavailable' });
});
test('ADAS-37 unmanaged children or foreign object bindings cannot be activated through the parent campaign', async () => {
  const f = fixture(); f.rows.adset.push({ ...f.rows.adset[0], id: '301' });
  await assert.rejects(f.adapter.read(access(), campaign()), { code: 'automatic_budget_control_unavailable' });
  const foreign = fixture(); foreign.rows.campaign[0].account_id = '200'; await assert.rejects(foreign.adapter.read(access(), campaign()), { code: 'meta_asset_forbidden' });
  const extra = fixture(); extra.rows.ad.push({ ...extra.rows.ad[0], id: '501' }); await assert.rejects(extra.adapter.read(access(), campaign()), { code: 'automatic_budget_control_unavailable' });
});
test('ADAS-48 wrong account local origin flag or remote campaign identity is rejected before data can grant control', async () => {
  const f = fixture(); await assert.rejects(f.adapter.read(access(), { ...campaign(), remoteAccountId: '200' }), { code: 'meta_asset_forbidden' }); assert.equal(f.calls.length, 0);
  await assert.rejects(f.adapter.read(access(), { ...campaign(), createdByAgent: false }), { code: 'campaign_read_only' });
  const wrong = fixture(); wrong.rows.campaign[0].id = '201'; await assert.rejects(wrong.adapter.read(access(), campaign()), { code: 'meta_asset_forbidden' });
});
