import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metaAssistantFixture } from '../application/__tests__/assistant-fixture.js';
import { latestClosedObservationDay } from '../domain/daily-observation-calendar.js';
import { shiftObservationDate } from '../domain/daily-observation-calendar.js';
import { PrismaDailyObservationRepository } from './prisma-daily-observation.repository.js';

async function fixture() { const f = await metaAssistantFixture(); f.setNow('2026-11-16T03:00:00Z'); const repo = new PrismaDailyObservationRepository(f.prisma, f.clock); const identity = { merchantId: 'store-a', accountId: '100', ...latestClosedObservationDay(f.clock(), 'America/Sao_Paulo') }; return { ...f, daily: repo, identity }; }

test('ADAS-42 concurrent admission and claim create one logical daily run with one lease owner', async () => {
  const f = await fixture(); try {
    const runs = await Promise.all([f.daily.admit(f.identity), f.daily.admit(f.identity)]); assert.equal(runs[0].id, runs[1].id);
    const claims = await Promise.all([f.daily.claim('store-a', runs[0].id), f.daily.claim('store-a', runs[0].id)]);
    assert.equal(claims.filter(Boolean).length, 1); assert.equal(claims.find(Boolean)!.fence, 1); assert.equal(await f.prisma.metaAdsDailyRun.count(), 1);
    assert.equal((await f.daily.read('store-a', runs[0].id)).status, 'running');
  } finally { await f.close(); }
});
test('ADAS-42 many concurrent schedulers cannot race the primary and logical daily uniqueness constraints', async () => {
  const f = await fixture(); try {
    const ids = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const identity = { ...f.identity, localDay: shiftObservationDate(f.identity.localDay, -i) };
      const rows = await Promise.all(Array.from({ length: 8 }, () => f.daily.admit(identity)));
      assert.equal(new Set(rows.map(row => row.id)).size, 1); assert.equal(rows.every(row => row.merchantId === identity.merchantId && row.accountId === identity.accountId && row.localDay === identity.localDay && row.timezone === identity.timezone), true); ids.add(rows[0].id);
    }
    assert.equal(ids.size, 8); assert.equal(await f.prisma.metaAdsDailyRun.count(), 8);
  } finally { await f.close(); }
});
test('ADAS-43 lease takeover preserves checkpoint and rejects the expired token and fence', async () => {
  const f = await fixture(); try {
    const run = await f.daily.admit(f.identity), first = (await f.daily.claim('store-a', run.id))!;
    await f.daily.checkpoint(first, { progress: { completed: ['campaign-a'] } }); f.setNow('2026-11-16T03:03:00Z');
    const second = (await f.daily.claim('store-a', run.id))!; assert.equal(second.fence, 2); assert.notEqual(second.leaseToken, first.leaseToken);
    assert.deepEqual(second.progress, { completed: ['campaign-a'] });
    await assert.rejects(f.daily.checkpoint(first, { progress: { completed: [] } }), { code: 'daily_lease_lost' });
    await assert.rejects(f.daily.heartbeat(first), { code: 'daily_lease_lost' });
    assert.deepEqual((await f.daily.read('store-a', run.id)).progress, { completed: ['campaign-a'] });
  } finally { await f.close(); }
});
test('ADAS-43 partial retry retains completed campaigns and report and becomes eligible at its exact retry time', async () => {
  const f = await fixture(); try {
    const run = await f.daily.admit(f.identity), lease = (await f.daily.claim('store-a', run.id))!;
    await f.daily.checkpoint(lease, { progress: { completed: ['a'], missing: ['b'] }, report: { id: run.id, status: 'partial' } as never });
    await f.daily.finish(lease, 'partial', new Date('2026-11-16T03:01:00Z'));
    assert.equal((await f.daily.pending()).length, 0); assert.equal(await f.daily.claim('store-a', run.id), null);
    f.setNow('2026-11-16T03:01:00Z'); assert.equal((await f.daily.pending())[0].id, run.id);
    const recovered = (await f.daily.claim('store-a', run.id))!; assert.deepEqual(recovered.progress, { completed: ['a'], missing: ['b'] }); assert.equal(recovered.report!.status, 'partial');
    await f.daily.finish(recovered, 'completed'); assert.equal(await f.daily.claim('store-a', run.id), null); assert.deepEqual(await f.daily.pending(), []);
  } finally { await f.close(); }
});
test('ADAS-48 daily read list latest and claim cannot cross merchant or account boundaries', async () => {
  const f = await fixture(); try {
    const run = await f.daily.admit(f.identity); await f.daily.admit({ ...f.identity, merchantId: 'store-b' }); await f.daily.admit({ ...f.identity, accountId: '200' });
    await assert.rejects(f.daily.read('store-b', run.id), { code: 'daily_report_not_found' }); await assert.rejects(f.daily.claim('store-b', run.id), { code: 'daily_report_not_found' });
    assert.equal((await f.daily.list('store-a', '100')).length, 1); assert.equal((await f.daily.list('store-b', '100')).length, 1);
    assert.equal(await f.daily.latestDay('store-a', '100', 'America/Sao_Paulo'), '2026-11-15'); assert.equal(await f.daily.latestDay('store-a', '100', 'UTC'), null);
  } finally { await f.close(); }
});
test('ADAS-42 account or timezone changes preserve prior daily identity and recovery context', async () => {
  const f = await fixture(); try {
    const original = await f.daily.admit(f.identity), changed = await f.daily.admit({ ...f.identity, timezone: 'UTC' }), account = await f.daily.admit({ ...f.identity, accountId: '200' });
    assert.equal(new Set([original.id, changed.id, account.id]).size, 3); assert.equal((await f.daily.read('store-a', original.id)).timezone, 'America/Sao_Paulo');
  } finally { await f.close(); }
});
test('ADAS-50 analysis and action checkpoints survive recovery without being overwritten by another lease', async () => {
  const f = await fixture(); try {
    const run = await f.daily.admit(f.identity), lease = (await f.daily.claim('store-a', run.id))!;
    await f.daily.checkpoint(lease, { analysisStatus: 'unknown', progress: { analysis: { turnId: 'turn-a', state: 'unknown' }, actions: { a: { executionId: 'execution-a', status: 'execution_unknown' } } } });
    await f.daily.finish(lease, 'partial', f.clock()); const next = (await f.daily.claim('store-a', run.id))!;
    assert.equal(next.analysisStatus, 'unknown'); assert.deepEqual(next.progress.actions, { a: { executionId: 'execution-a', status: 'execution_unknown' } });
    await assert.rejects(f.daily.checkpoint(lease, { analysisStatus: 'pending' }), { code: 'daily_lease_lost' });
  } finally { await f.close(); }
});
test('ADAS-52 deleting a merchant cascades daily reports and prevents subsequent retrieval', async () => {
  const f = await fixture(); try { const run = await f.daily.admit(f.identity); await f.sql.query("DELETE FROM merchants WHERE id='store-a'"); assert.equal(await f.prisma.metaAdsDailyRun.count(), 0); await assert.rejects(f.daily.read('store-a', run.id), { code: 'daily_report_not_found' }); assert.deepEqual(await f.daily.list('store-a', '100'), []); } finally { await f.close(); }
});
