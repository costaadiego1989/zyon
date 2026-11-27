import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MetaAdsAutomationPolicyInput, MetaAdsAutomationReview } from '@zyon/shared-types';
import { metaAssistantFixture } from './__tests__/assistant-fixture.js';
import { AutomationPolicyService } from './automation-policy.service.js';
import { MetaAdsError } from '../domain/types.js';

const terms = (): MetaAdsAutomationPolicyInput => ({ scope: { variantIds: ['variant-a'], campaignIds: [], allowNewCampaigns: true, destination: 'store', priority: 'roas', country: 'BR', actions: ['prepare', 'publish', 'pause', 'budget', 'creative'] }, limits: { currency: 'BRL', cadence: 'lifetime', campaignCeilingCents: 10000, storeCeilingCents: 20000, startsAt: '2026-11-16T12:00:00Z', endsAt: '2026-11-23T12:00:00Z' } });
async function fixture() {
  const f = await metaAssistantFixture(); await f.connect(); f.setNow('2026-11-16T12:00:00Z'); let enabled = true;
  await f.sql.query(`ALTER TABLE merchants ADD COLUMN store_settings JSONB DEFAULT '{"checkout_auto_enabled":true}'`);
  const policies = new AutomationPolicyService({ repo: f.repo, commerce: f.commerce, connection: f.service.connection, campaigns: f.service.campaigns, enabled: () => enabled, clock: f.clock,
    authorizeActor: async (merchantId, actorId) => { if (merchantId !== 'store-a' || actorId !== 'owner-a') throw new MetaAdsError('meta_ads_role_forbidden', 403); } });
  const review = () => policies.review('store-a', 'owner-a', terms());
  const accept = (value: MetaAdsAutomationReview, key = 'accept-a') => policies.accept('store-a', 'owner-a', { scope: value.scope, limits: value.limits, version: value.version, digest: value.digest, idempotencyKey: key });
  return { ...f, policies, review, accept, enabled: (value: boolean) => { enabled = value; } };
}
test('ADAS-30 legacy store defaults manual and a review never grants financial authority', async () => {
  const f = await fixture(); try {
    assert.deepEqual(await f.policies.view('store-a'), { mode: 'manual', policy: null, committedCents: 0, availableCents: null });
    const review = await f.review(); assert.equal(review.accountId, '100'); assert.equal(review.version, 1); assert.equal(review.connectionEpoch, (await f.repo.read('store-a')).connection.epoch);
    assert.equal((await f.policies.view('store-a')).mode, 'manual'); assert.deepEqual((await f.repo.read('store-a')).proposals, {});
    assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
test('ADAS-33 exact explicit acceptance creates one immutable actor-bound policy and safely replays', async () => {
  const f = await fixture(); try {
    const review = await f.review(); const first = await f.accept(review); const repeat = await f.accept(review);
    assert.equal(first.mode, 'automatic'); assert.equal(first.policy?.id, repeat.policy?.id); assert.equal(first.policy?.acceptedBy, 'owner-a');
    assert.equal(first.policy?.acceptedAt, f.clock().toISOString()); assert.equal(first.policy?.accountId, '100'); assert.equal(first.policy?.digest, review.digest);
    assert.deepEqual(first.policy?.scope, review.scope); assert.deepEqual(first.policy?.limits, review.limits);
    const receipt = await f.repo.getRecord<{ policy: unknown }>('store-a', `automatic-policy:${first.policy!.id}`);
    assert.deepEqual(receipt?.payload.policy, first.policy); assert.deepEqual((await f.repo.read('store-a')).proposals, {});
    assert.equal(first.availableCents, 20000);
  } finally { await f.close(); }
});
test('ADAS-33 changed terms digest revision or connection cannot reuse another reviewed authorization', async () => {
  const f = await fixture(); try {
    const review = await f.review();
    await assert.rejects(f.accept({ ...review, digest: '0'.repeat(64) }), /automation_policy_review_changed/);
    await assert.rejects(f.accept({ ...review, limits: { ...review.limits, storeCeilingCents: 30000 } }), /automation_policy_review_changed/);
    await f.repo.mutate('store-a', [], state => { state.connection.epoch++; return { result: null }; });
    await assert.rejects(f.accept(review), /automation_policy_review_changed/); assert.equal((await f.policies.view('store-a')).mode, 'manual');
  } finally { await f.close(); }
});
test('ADAS-33 simultaneous distinct accept requests use one version while changed idempotent payload is rejected', async () => {
  const f = await fixture(); try {
    const review = await f.review(); const results = await Promise.allSettled([f.accept(review, 'accept-a'), f.accept(review, 'accept-b')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'automation_policy_version_changed');
    const recordKeys = (await f.repo.listRecords('store-a', 'audit')).filter(r => r.key.startsWith('automatic-policy:'));
    assert.equal(recordKeys.length, 1);
    const succeededKey = results[0].status === 'fulfilled' ? 'accept-a' : 'accept-b';
    await assert.rejects(f.accept({ ...review, limits: { ...review.limits, storeCeilingCents: 30000 } }, succeededKey), /automation_policy_request_conflict/);
  } finally { await f.close(); }
});
test('ADAS-38 revoking policy returns manual without changing old receipt or reactivating on accept replay', async () => {
  const f = await fixture(); try {
    const review = await f.review(); const accepted = await f.accept(review); const policy = accepted.policy!;
    const before = await f.repo.getRecord('store-a', `automatic-policy:${policy.id}`);
    const revoked = await f.policies.revoke('store-a', 'owner-a', { policyId: policy.id, version: policy.version, idempotencyKey: 'revoke-a' });
    assert.equal(revoked.mode, 'manual'); assert.equal(revoked.policy?.revokedAt, f.clock().toISOString());
    assert.deepEqual(await f.repo.getRecord('store-a', `automatic-policy:${policy.id}`), before);
    assert.equal((await f.accept(review)).mode, 'manual');
    assert.equal((await f.policies.revoke('store-a', 'owner-a', { policyId: policy.id, version: policy.version, idempotencyKey: 'revoke-a' })).mode, 'manual');
    assert.ok(!f.calls.includes('execute')); assert.ok(!f.calls.includes('prepare'));
  } finally { await f.close(); }
});
test('ADAS-39 losing entitlement flag validity or connection disables automatic mode but retains reviewed history', async () => {
  const f = await fixture(); try {
    const state = await f.accept(await f.review()); const id = state.policy!.id;
    f.enabled(false); assert.equal((await f.policies.view('store-a')).mode, 'manual');
    f.enabled(true); assert.equal((await f.policies.view('store-a')).mode, 'automatic');
    f.setNow('2026-11-24T12:00:00Z'); assert.equal((await f.policies.view('store-a')).mode, 'manual');
    f.setNow('2026-12-02T12:00:00Z'); const expired = await f.policies.view('store-a'); assert.equal(expired.mode, 'manual'); assert.equal(expired.policy?.id, id);
    await f.policies.revoke('store-a', 'owner-a', { policyId: id, version: state.policy!.version, idempotencyKey: 'expired-revoke' });
    assert.ok((await f.policies.view('store-a')).policy?.revokedAt);
  } finally { await f.close(); }
});
test('ADAS-40 changing ads mode does not alter existing checkout automation settings', async () => {
  const f = await fixture(); try {
    const before = (await f.sql.query('SELECT store_settings FROM merchants WHERE id=$1', ['store-a'])).rows[0].store_settings;
    const state = await f.accept(await f.review()); await f.policies.revoke('store-a', 'owner-a', { policyId: state.policy!.id, version: state.policy!.version, idempotencyKey: 'checkout-independent' });
    const after = (await f.sql.query('SELECT store_settings FROM merchants WHERE id=$1', ['store-a'])).rows[0].store_settings;
    assert.deepEqual(after, before); assert.equal(after.checkout_auto_enabled, true);
  } finally { await f.close(); }
});
test('ADAS-48 unauthorized actor or disabled automatic capability cannot prepare or accept policy', async () => {
  const f = await fixture(); try {
    await assert.rejects(f.policies.review('store-a', 'staff-a', terms()), /meta_ads_role_forbidden/); assert.deepEqual(f.catalogReads, []);
    f.enabled(false); await assert.rejects(f.review(), /automatic_mode_unavailable/); assert.deepEqual(f.catalogReads, []);
    assert.equal((await f.policies.view('store-a')).policy, null);
  } finally { await f.close(); }
});
test('ADAS-39 disconnecting or changing the account epoch after acceptance disables the retained policy', async () => {
  const f = await fixture(); try {
    const accepted = await f.accept(await f.review());
    await f.repo.mutate('store-a', [], state => { state.connection.epoch++; return { result: null }; });
    const changed = await f.policies.view('store-a'); assert.equal(changed.mode, 'manual'); assert.equal(changed.policy?.id, accepted.policy?.id);
    assert.equal(changed.availableCents, null);
  } finally { await f.close(); }
});
test('ADAS-39 policy expiring while selection is checked is rejected before its receipt or pointer is committed', async () => {
  const f = await fixture(); try {
    const review = await f.review(); const original = f.commerce.products;
    f.commerce.products = async (...args) => { f.setNow('2026-11-23T12:00:01Z'); return original(...args); };
    await assert.rejects(f.accept(review), /automation_policy_invalid/);
    assert.equal((await f.policies.view('store-a')).policy, null);
    assert.equal((await f.repo.listRecords('store-a', 'audit')).filter(r => r.key.startsWith('automatic-policy:')).length, 0);
  } finally { await f.close(); }
});
