import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MetaAdsFundingSnapshot } from '@zyon/shared-types';
import { metaAssistantFixture } from './__tests__/assistant-fixture.js';
import { FundingService } from './funding.service.js';

async function fixture() {
  const f = await metaAssistantFixture(); await f.connect(); let calls = 0;
  let snapshot: MetaAdsFundingSnapshot = { accountId: '100', accountName: 'Conta da loja', currency: 'BRL', billingType: 'prepaid', paymentMethod: 'present', confirmedBlock: false, blockCode: null, amountDueCents: 2500, prepaidAvailableCents: null, checkedAt: f.clock().toISOString(), source: 'meta_mcp+graph', paymentUrl: null };
  let read = async () => structuredClone(snapshot);
  const funding = new FundingService(f.repo, f.service.billing, f.service.connection, { read: async access => {
    assert.equal(access.merchantId, 'store-a'); assert.equal(access.accountId, '100'); calls++; return read();
  } }, f.clock);
  return { ...f, providerCalls: f.calls, funding, snapshot: (patch: Partial<MetaAdsFundingSnapshot>) => { snapshot = { ...snapshot, ...patch }; }, calls: () => calls, read: (fn: typeof read) => { read = fn; } };
}
test('ADAS-02 prepaid diagnosis explains funds paid to Meta and does not reinterpret bill due as available funds', async () => {
  const f = await fixture(); try {
    const diagnosis = await f.funding.describe('store-a'); assert.equal(diagnosis.status, 'unknown');
    assert.match(diagnosis.message, /pré-paga/); assert.match(diagnosis.message, /fundos/);
    assert.equal(diagnosis.snapshot?.amountDueCents, 2500); assert.equal(diagnosis.snapshot?.prepaidAvailableCents, null);
    assert.ok(diagnosis.nextSteps.some(step => /assinatura/.test(step) && /Meta/.test(step)));
    assert.ok(diagnosis.nextSteps.some(step => step.includes('100'))); assert.equal(diagnosis.snapshot?.paymentUrl, null);
  } finally { await f.close(); }
});
test('ADAS-03 postpaid positive amount due is not a requirement to add prepaid money', async () => {
  const f = await fixture(); try {
    f.snapshot({ billingType: 'postpaid' }); const diagnosis = await f.funding.describe('store-a');
    assert.equal(diagnosis.status, 'ready'); assert.match(diagnosis.message, /pós-paga/);
    assert.ok(!diagnosis.nextSteps.some(step => /adicione fundos/i.test(step))); assert.equal(diagnosis.snapshot?.amountDueCents, 2500);
    assert.equal((await f.funding.assertPublishable('store-a')).status, 'ready');
  } finally { await f.close(); }
});
test('ADAS-04 unavailable payment mode or provider evidence is shown as unknown with a useful Meta verification path', async () => {
  const f = await fixture(); try {
    f.snapshot({ billingType: 'unknown', paymentMethod: 'unknown', amountDueCents: null });
    const unknown = await f.funding.describe('store-a'); assert.equal(unknown.status, 'unknown'); assert.match(unknown.message, /não.*confirmar/i);
    f.read(async () => { throw Error('raw-private-token-provider-error'); });
    const unavailable = await f.funding.describe('store-a'); assert.equal(unavailable.status, 'unknown'); assert.equal(unavailable.snapshot, null);
    assert.equal(unavailable.error, 'meta_funding_unavailable'); assert.ok(!JSON.stringify(unavailable).includes('raw-private-token'));
    assert.ok(unavailable.nextSteps.length >= 1);
  } finally { await f.close(); }
});
test('ADAS-06 repeated verification reads current evidence without recording a payment or changing commercial credits', async () => {
  const f = await fixture(); try {
    const before = await f.repo.read('store-a'); const first = await f.funding.describe('store-a');
    f.snapshot({ prepaidAvailableCents: 10000 }); const second = await f.funding.describe('store-a');
    assert.equal(first.status, 'unknown'); assert.equal(second.status, 'ready'); assert.equal(f.calls(), 2);
    const after = await f.repo.read('store-a'); assert.deepEqual(after.credits, before.credits); assert.deepEqual(after.subscription, before.subscription);
    assert.deepEqual(await f.repo.listRecords('store-a', 'billing_event'), []); assert.deepEqual(await f.repo.listRecords('store-a', 'billing_period'), []);
    assert.deepEqual(after.campaigns, before.campaigns);
  } finally { await f.close(); }
});
test('ADAS-07 confirmed financial blockers and verified empty funds prevent publishing without a Meta write', async () => {
  const f = await fixture(); try {
    for (const patch of [{ confirmedBlock: true, blockCode: 'account_unsettled' }, { confirmedBlock: false, blockCode: null, paymentMethod: 'missing' as const }, { confirmedBlock: false, blockCode: null, paymentMethod: 'present' as const, prepaidAvailableCents: 0 }]) {
      f.snapshot(patch); const diagnosis = await f.funding.describe('store-a'); assert.equal(diagnosis.status, 'blocked');
      await assert.rejects(f.funding.assertPublishable('store-a'), { code: 'meta_funding_blocked' });
    }
    assert.ok(!f.providerCalls.includes('execute')); assert.ok(!f.providerCalls.includes('prepare'));
  } finally { await f.close(); }
});
test('ADAS-08 budget media credit and Meta amounts stay separate in a grounded funding response', async () => {
  const f = await fixture(); try {
    const before = await f.repo.read('store-a'); const diagnosis = await f.funding.describe('store-a');
    assert.equal(before.credits.monthlyAvailable, 30); assert.equal(diagnosis.snapshot?.amountDueCents, 2500);
    assert.equal(diagnosis.snapshot?.prepaidAvailableCents, null);
    assert.ok(diagnosis.nextSteps.some(step => /créditos de imagens/.test(step)));
    assert.ok(!Object.hasOwn(diagnosis, 'mediaBudgetCents')); assert.ok(!JSON.stringify(diagnosis).includes('14900'));
  } finally { await f.close(); }
});
test('ADAS-48 funding requires active entitlement before querying protected payment data', async () => {
  const f = await fixture(); try {
    f.setNow('2026-12-02T12:00:00Z'); await assert.rejects(f.funding.describe('store-a'), { code: 'addon_not_entitled' }); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
test('ADAS-22 concurrent account change cannot return old evidence or replace new connection metadata', async () => {
  const f = await fixture(); try {
    f.read(async () => {
      await f.repo.mutate('store-a', [], state => { state.connection.epoch++; state.connection.account = { id: '200', name: 'Outra conta' }; return { result: null }; });
      return { accountId: '100', accountName: 'Anterior', currency: 'BRL', billingType: 'postpaid', paymentMethod: 'present', confirmedBlock: false, blockCode: null, amountDueCents: 0, prepaidAvailableCents: null, checkedAt: f.clock().toISOString(), source: 'meta', paymentUrl: null };
    });
    await assert.rejects(f.funding.describe('store-a'), { code: 'meta_connection_changed' });
    assert.equal((await f.repo.read('store-a')).connection.account?.id, '200');
  } finally { await f.close(); }
});
test('ADAS-04 invalid or stale provider evidence never becomes a ready financial diagnosis', async () => {
  const f = await fixture(); try {
    for (const patch of [{ prepaidAvailableCents: -1 }, { amountDueCents: -500 }, { checkedAt: 'not-a-date' }, { checkedAt: '2026-11-14T11:00:00Z' }]) {
      f.snapshot(patch); const result = await f.funding.describe('store-a');
      assert.equal(result.status, 'unknown'); assert.equal(result.snapshot, null); assert.equal(result.error, 'meta_funding_unavailable');
    }
  } finally { await f.close(); }
});
test('ADAS-22 otherwise valid stale or future financial evidence is not presented as a current account reading', async () => {
  const f = await fixture(); try {
    f.snapshot({ billingType: 'postpaid', checkedAt: '2026-11-14T11:00:00Z' });
    assert.equal((await f.funding.describe('store-a')).snapshot, null);
    f.snapshot({ checkedAt: '2026-11-14T12:01:00Z' });
    const future = await f.funding.describe('store-a'); assert.equal(future.status, 'unknown'); assert.equal(future.snapshot, null);
  } finally { await f.close(); }
});
