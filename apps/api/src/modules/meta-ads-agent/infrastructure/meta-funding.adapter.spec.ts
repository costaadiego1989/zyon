import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MetaAccess } from '../domain/types.js';
import type { VerifiedMetaPaymentDestination } from '../domain/funding.port.js';
import { MetaFundingAdapter, validatedMetaPaymentUrl } from './meta-funding.adapter.js';

const now = () => new Date('2026-11-16T12:00:00Z');
const access = (): MetaAccess => ({ merchantId: 'store-a', accessToken: 'scoped-store-token', clientConversationId: 'AbCdEfGhIjKlMnOpQr12', connectionEpoch: 1, accountId: '100', pageId: null, datasetId: null, catalogId: null, whatsappId: null });
function fixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const requests: Array<{ url: string; method: string }> = [];
  let account: Record<string, unknown> = { ad_account_id: '100', ad_account_name: 'Loja A', currency: 'BRL', account_status: 'ACTIVE', is_queryable: true, is_ads_mcp_enabled: true, has_payment_method: true };
  const graph: Record<string, unknown> = { currency: 'BRL', is_prepay_account: true, balance: '2500', funding_source: '999', account_status: 1, disable_reason: 0 };
  const denied = new Set<string>(); let graphId = 'act_100'; let mcpDenied = false;
  let destination: VerifiedMetaPaymentDestination | null = null; let nextConversationId: string | undefined;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push({ url: String(input), method: init?.method ?? 'GET' });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer scoped-store-token');
    assert.ok(!url.search.includes('scoped-store-token')); assert.equal(init?.redirect, 'error');
    if (url.hostname === 'graph.facebook.com') {
      assert.equal(url.pathname, '/v27.0/act_100'); assert.equal(init?.method ?? 'GET', 'GET');
      const field = url.searchParams.get('fields')!.split(',').find(f => f !== 'id')!;
      if (denied.has(field)) return new Response('{"error":{"message":"raw-private-provider-detail"}}', { status: 403 });
      return new Response(JSON.stringify({ id: graphId, ...(Object.hasOwn(graph, field) ? { [field]: graph[field] } : {}) }), { status: 200 });
    }
    assert.equal(url.href, 'https://mcp.facebook.com/ads');
    if (mcpDenied) return new Response('private-provider-error', { status: 403 });
    const rpc = JSON.parse(String(init?.body)); let result: unknown;
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'test-meta', version: '1' } };
    else if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    else if (rpc.method === 'tools/list') result = { tools: [{ name: 'ads_get_ad_accounts', inputSchema: { type: 'object', properties: {}, additionalProperties: true } }] };
    else {
      calls.push({ name: rpc.params.name, args: rpc.params.arguments });
      assert.equal(rpc.params.name, 'ads_get_ad_accounts');
      assert.equal(rpc.params.arguments.client_conversation_id, 'AbCdEfGhIjKlMnOpQr12');
      result = { structuredContent: { ad_accounts: [account], ...(nextConversationId ? { client_conversation_id: nextConversationId } : {}) }, content: [] };
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { headers: { 'Content-Type': 'application/json' } });
  };
  const adapter = new MetaFundingAdapter({ graphVersion: 'v27.0', request, clock: now, paymentDestination: async () => destination });
  return { adapter, calls, requests, graph, denied, account: (value: Record<string, unknown>) => { account = { ...account, ...value }; }, graphId: (value: string) => { graphId = value; }, denyMcp: () => { mcpDenied = true; }, destination: (value: VerifiedMetaPaymentDestination) => { destination = value; }, rotateConversation: (value: string) => { nextConversationId = value; } };
}
test('ADAS-02 prepaid account keeps amount due distinct from unverified available funds', async () => {
  const f = fixture(); const result = await f.adapter.read(access());
  assert.equal(result.accountId, '100'); assert.equal(result.accountName, 'Loja A'); assert.equal(result.billingType, 'prepaid');
  assert.equal(result.amountDueCents, 2500); assert.equal(result.prepaidAvailableCents, null); assert.equal(result.currency, 'BRL');
  assert.equal(result.checkedAt, now().toISOString()); assert.equal(result.paymentMethod, 'present');
  assert.equal(result.confirmedBlock, false); assert.equal(result.paymentUrl, null);
});
test('ADAS-03 postpaid account is identified without imposing a prepaid balance requirement', async () => {
  const f = fixture(); f.graph.is_prepay_account = false; f.graph.balance = '0'; const result = await f.adapter.read(access());
  assert.equal(result.billingType, 'postpaid'); assert.equal(result.amountDueCents, 0); assert.equal(result.prepaidAvailableCents, null);
  assert.equal(result.paymentMethod, 'present'); assert.equal(result.confirmedBlock, false);
});
test('ADAS-04 insufficient field permissions degrade only those fields and never expose provider error bodies', async () => {
  const f = fixture(); f.denied.add('balance'); f.denied.add('is_prepay_account'); const result = await f.adapter.read(access());
  assert.equal(result.amountDueCents, null); assert.equal(result.billingType, 'unknown'); assert.equal(result.currency, 'BRL'); assert.equal(result.paymentMethod, 'present');
  assert.ok(!JSON.stringify(result).includes('raw-private-provider-detail')); assert.ok(!JSON.stringify(result).includes('scoped-store-token'));
});
test('ADAS-04 MCP outage can retain authorized Graph evidence without inventing missing account metadata', async () => {
  const f = fixture(); f.denyMcp(); const result = await f.adapter.read(access());
  assert.equal(result.accountId, '100'); assert.equal(result.billingType, 'prepaid'); assert.equal(result.amountDueCents, 2500);
  assert.equal(result.paymentMethod, 'present'); assert.equal(result.accountName, '100');
  assert.ok(!JSON.stringify(result).includes('private-provider-error'));
});
test('ADAS-48 mismatched MCP account and mismatched Graph identity never return another account data', async () => {
  const f = fixture(); f.account({ ad_account_id: '200' }); await assert.rejects(f.adapter.read(access()), { code: 'meta_asset_forbidden' });
  assert.ok(f.requests.every(r => !r.url.startsWith('https://graph.facebook.com')));
  const other = fixture(); other.graphId('act_200'); await assert.rejects(other.adapter.read(access()), { code: 'meta_asset_forbidden' });
  assert.ok(other.calls.every(c => c.name === 'ads_get_ad_accounts'));
});
test('ADAS-07 known unsettled account remains diagnosable without querying ads entities or writing billing', async () => {
  const f = fixture(); f.account({ is_queryable: false, account_status: 'UNSETTLED' }); f.graph.account_status = 3;
  const result = await f.adapter.read(access()); assert.equal(result.confirmedBlock, true); assert.equal(result.blockCode, 'account_unsettled');
  assert.deepEqual(f.calls.map(c => c.name), ['ads_get_ad_accounts']);
  assert.ok(f.requests.filter(r => r.url.startsWith('https://graph.facebook.com')).every(r => r.method === 'GET'));
});
test('ADAS-07 absent payment source is a confirmed block while unavailable source stays unknown', async () => {
  const f = fixture(); f.graph.funding_source = null; f.account({ has_payment_method: false }); const missing = await f.adapter.read(access());
  assert.equal(missing.paymentMethod, 'missing'); assert.equal(missing.confirmedBlock, true); assert.equal(missing.blockCode, 'payment_method_missing');
  const other = fixture(); other.denyMcp(); other.denied.add('funding_source'); const unknown = await other.adapter.read(access());
  assert.equal(unknown.paymentMethod, 'unknown'); assert.equal(unknown.confirmedBlock, false);
});
test('ADAS-05 payment navigation requires prior server verification plus exact account host route and parameters', async () => {
  const destination: VerifiedMetaPaymentDestination = { accountId: '100', url: 'https://www.facebook.com/ads/manager/account_settings/account_billing/?act=100', verifiedAt: now().toISOString() };
  assert.equal(validatedMetaPaymentUrl(destination, '100', now()), destination.url);
  for (const url of ['https://evil.example.test/billing?act=100', 'https://www.facebook.com.evil.example.test/ads/manager/account_settings/account_billing/?act=100', 'https://www.facebook.com:444/ads/manager/account_settings/account_billing/?act=100', 'https://user@www.facebook.com/ads/manager/account_settings/account_billing/?act=100', 'https://www.facebook.com/ads/manager/account_settings/account_billing/?act=200', 'https://www.facebook.com/ads/manager/account_settings/account_billing/?act=100&next=https://evil.example.test', 'https://www.facebook.com/ads/manager/account_settings/account_billing/?act=100&access_token=secret', 'https://www.facebook.com/other?act=100'])
    assert.equal(validatedMetaPaymentUrl({ ...destination, url }, '100', now()), null);
  assert.equal(validatedMetaPaymentUrl({ ...destination, accountId: '200' }, '100', now()), null);
  assert.equal(validatedMetaPaymentUrl({ ...destination, verifiedAt: '2026-11-17' }, '100', now()), null);
  assert.equal(validatedMetaPaymentUrl(null, '100', now()), null);
  const f = fixture(); f.destination(destination); assert.equal((await f.adapter.read(access())).paymentUrl, destination.url);
});
test('ADAS-08 invalid monetary values and unsupported minor units never become a fabricated balance', async () => {
  for (const value of ['-1', '1e5', '1.50', '9007199254740992', '']) {
    const f = fixture(); f.graph.balance = value; assert.equal((await f.adapter.read(access())).amountDueCents, null);
  }
  const f = fixture(); f.graph.currency = 'JPY'; const result = await f.adapter.read(access());
  assert.equal(result.currency, 'JPY'); assert.equal(result.amountDueCents, null); assert.equal(result.prepaidAvailableCents, null);
});
test('ADAS-48 malformed account and MCP-disabled account do not initiate further account operations', async () => {
  const f = fixture(); await assert.rejects(f.adapter.read({ ...access(), accountId: '../200' }), { code: 'meta_account_required' }); assert.equal(f.requests.length, 0);
  f.account({ is_ads_mcp_enabled: false }); await assert.rejects(f.adapter.read(access()), { code: 'meta_asset_forbidden' });
  assert.ok(!f.requests.some(r => r.url.startsWith('https://graph.facebook.com')));
});
test('ADAS-22 authorized financial read preserves the latest MCP conversation identity on server access only', async () => {
  const f = fixture(); const scoped = access(); f.rotateConversation('ZxCvBnMaSdFgHjKlQw12');
  const result = await f.adapter.read(scoped);
  assert.equal(scoped.clientConversationId, 'ZxCvBnMaSdFgHjKlQw12');
  assert.ok(!JSON.stringify(result).includes('ZxCvBnMaSdFgHjKlQw12')); assert.equal(result.accountId, '100');
});
