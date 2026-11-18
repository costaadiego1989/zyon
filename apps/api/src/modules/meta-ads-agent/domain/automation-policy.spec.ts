import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MetaAdsAutomationPolicy, MetaAdsAutomationPolicyInput } from '@zyon/shared-types';
import { normalizeAutomationPolicy, automationReviewDigest, isAutomationPolicyCurrent } from './automation-policy.js';

const now = new Date('2026-11-16T12:00:00Z');
const input = (): MetaAdsAutomationPolicyInput => ({ scope: { variantIds: ['variant-b', 'variant-a'], campaignIds: ['campaign-a'], allowNewCampaigns: true, destination: 'store', priority: 'roas', country: 'BR', actions: ['publish', 'prepare', 'pause', 'budget', 'creative'] }, limits: { currency: 'BRL', cadence: 'lifetime', campaignCeilingCents: 10000, storeCeilingCents: 30000, startsAt: '2026-11-16T09:00:00-03:00', endsAt: '2026-11-23T09:00:00-03:00' } });
const binding = { merchantId: 'store-a', accountId: '100', connectionEpoch: 3, version: 1 };
test('ADAS-33 policy normalization preserves choices and canonicalizes sets and explicit timestamps', () => {
  const raw = input(); const policy = normalizeAutomationPolicy(raw, now);
  assert.deepEqual(policy.scope.variantIds, ['variant-a', 'variant-b']); assert.equal(policy.scope.priority, 'roas'); assert.equal(policy.scope.destination, 'store');
  assert.equal(policy.limits.cadence, 'lifetime'); assert.equal(policy.limits.campaignCeilingCents, 10000); assert.equal(policy.limits.storeCeilingCents, 30000);
  assert.equal(policy.limits.startsAt, '2026-11-16T12:00:00.000Z'); assert.equal(policy.limits.endsAt, '2026-11-23T12:00:00.000Z');
  assert.deepEqual(raw.scope.variantIds, ['variant-b', 'variant-a']);
});
test('ADAS-30 legacy absent expired revoked or different-connection policy never grants automatic mode', () => {
  const policy: MetaAdsAutomationPolicy = { ...normalizeAutomationPolicy(input(), now), id: 'policy-a', version: 1, accountId: '100', connectionEpoch: 3, digest: 'a'.repeat(64), acceptedBy: 'owner-a', acceptedAt: now.toISOString(), revokedAt: null };
  assert.equal(isAutomationPolicyCurrent(null, '100', 3, now), false);
  assert.equal(isAutomationPolicyCurrent(policy, '100', 3, now), true);
  assert.equal(isAutomationPolicyCurrent({ ...policy, revokedAt: now.toISOString() }, '100', 3, now), false);
  assert.equal(isAutomationPolicyCurrent(policy, '200', 3, now), false); assert.equal(isAutomationPolicyCurrent(policy, '100', 4, now), false);
  assert.equal(isAutomationPolicyCurrent(policy, '100', 3, new Date('2026-11-23T12:00:00Z')), false);
  assert.equal(isAutomationPolicyCurrent(policy, '100', 3, new Date('2026-11-16T11:59:59Z')), false);
});
test('ADAS-35 currency positive integer ceilings and campaign versus store limit are mandatory without cadence conversion', () => {
  for (const patch of [{ currency: 'USD' }, { campaignCeilingCents: 0 }, { storeCeilingCents: -1 }, { campaignCeilingCents: 1.5 }, { storeCeilingCents: Number.MAX_SAFE_INTEGER + 1 }, { campaignCeilingCents: 30001 }, { cadence: 'total' }])
    assert.throws(() => normalizeAutomationPolicy({ ...input(), limits: { ...input().limits, ...patch } } as MetaAdsAutomationPolicyInput, now), /automation_policy_invalid/);
  const daily = normalizeAutomationPolicy({ ...input(), limits: { ...input().limits, cadence: 'daily', campaignCeilingCents: 2500 } }, now);
  assert.equal(daily.limits.cadence, 'daily'); assert.equal(daily.limits.campaignCeilingCents, 2500); assert.equal(daily.limits.endsAt, '2026-11-23T12:00:00.000Z');
});
test('ADAS-40 policy input cannot carry checkout flags actor approval account digest or other hidden authority', () => {
  for (const extra of [{ acceptedBy: 'owner-a' }, { merchantId: 'store-b' }, { accountId: '200' }, { automaticCheckoutEnabled: true }, { digest: 'approved' }, { version: 10 }])
    assert.throws(() => normalizeAutomationPolicy({ ...input(), ...extra }, now), /automation_policy_invalid/);
  assert.throws(() => normalizeAutomationPolicy({ ...input(), scope: { ...input().scope, approved: true } }, now), /automation_policy_invalid/);
  assert.throws(() => normalizeAutomationPolicy({ ...input(), limits: { ...input().limits, spend_cap: 10000 } }, now), /automation_policy_invalid/);
});
test('ADAS-32 policy scope requires explicit products destinations goals region and a nonempty bounded action set', () => {
  for (const patch of [{ variantIds: [] }, { variantIds: ['variant-a', 'variant-a'] }, { variantIds: ['bad\n'] }, { actions: ['audience'] }, { actions: ['publish', 'publish'] }, { actions: [] }, { country: 'br' }, { priority: 'sell_more' }, { destination: 'instagram' }, { allowNewCampaigns: false, campaignIds: [] }])
    assert.throws(() => normalizeAutomationPolicy({ ...input(), scope: { ...input().scope, ...patch } } as MetaAdsAutomationPolicyInput, now), /automation_policy_invalid/);
});
test('ADAS-35 date windows require real dates with timezone and future finite expiry', () => {
  for (const patch of [{ startsAt: '2026-11-16' }, { startsAt: '2026-11-16T12:00:00' }, { startsAt: '2026-02-30T12:00:00Z' }, { endsAt: '' }, { endsAt: '2026-11-16T12:00:00Z' }, { endsAt: '2026-11-16T11:00:00Z' }, { startsAt: '2026-11-16T25:00:00Z' }, { endsAt: null }])
    assert.throws(() => normalizeAutomationPolicy({ ...input(), limits: { ...input().limits, ...patch } } as MetaAdsAutomationPolicyInput, now), /automation_policy_invalid/);
});
test('ADAS-33 review digest binds normalized terms to exact merchant account epoch and version', () => {
  const terms = normalizeAutomationPolicy(input(), now); const digest = automationReviewDigest(binding, terms);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const reversed = input(); reversed.scope.variantIds.reverse(); reversed.scope.actions.reverse();
  assert.equal(automationReviewDigest(binding, normalizeAutomationPolicy(reversed, now)), digest);
  for (const changed of [{ merchantId: 'store-b' }, { accountId: '200' }, { connectionEpoch: 4 }, { version: 2 }])
    assert.notEqual(automationReviewDigest({ ...binding, ...changed }, terms), digest);
  assert.notEqual(automationReviewDigest(binding, { ...terms, limits: { ...terms.limits, storeCeilingCents: 40000 } }), digest);
});
