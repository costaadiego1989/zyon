import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorityFixture } from '../application/__tests__/authority-fixture.js';
import { ExecutionService } from '../application/execution.service.js';
import { GenerationService } from '../application/generation.service.js';
import { AutomaticCampaignWorker } from './automatic-campaign.worker.js';
import { recommendationEvidence } from './recommendation.adapter.js';
import { buildMetrics } from '../domain/analytics.js';

async function fixture(prepared = true) {
  const f = await authorityFixture(prepared);
  const executor = new ExecutionService(f.repo, f.commerce, f.service.campaigns, f.service.connection, f.provider, f.clock, undefined, { authority: f.authority, exposure: f.exposure, budgetControl: f.budgetControl });
  const generations = new GenerationService(f.repo, f.commerce, { configured: () => true, generate: async () => ({ status: 'succeeded', url: 'https://media.example.test/controlled.png', error: null,
    usage: { provider: 'openai', model: 'gpt-image-1', providerRequestId: 'controlled-image', inputTextTokens: 10, inputImageTokens: 10, outputImageTokens: 10, costMicros: '100', currency: 'USD', costStatus: 'estimated' },
    commercialReview: { status: 'verified', productVersion: 'version-a', imageSha256: 'a'.repeat(64), reviewedAt: f.clock().toISOString() } }) }, f.clock);
  const worker = new AutomaticCampaignWorker({ repo: f.repo, policies: f.policies, campaigns: f.service.campaigns, generations, proposals: f.service.proposals, executions: executor, enabled: () => true, clock: f.clock });
  const measured = async (orders: boolean) => {
    const metrics = buildMetrics({ campaignId: f.campaignId, remote: await f.provider.metrics({} as never, (await f.repo.read('store-a')).campaigns[f.campaignId], '2026-11-01', '2026-11-15'), orders: orders ? [{ orderId: 'order-a', paid: true, paidCents: 10000, refundedCents: 0, currency: 'BRL', costCents: 3000, costCoverage: 'complete' }] as never : [], updatedAt: f.clock().toISOString() });
    const recommendation = { id: 'recommendation-a', campaignId: f.campaignId, priority: 'roas' as const, hypothesis: 'Pausar com base no custo observado', evidence: recommendationEvidence(metrics), proposedAction: 'pause' as const, proposedFields: {}, status: 'pending_review' as const, createdAt: f.clock().toISOString() };
    await f.repo.mutate('store-a', [], state => { state.metrics[f.campaignId] = metrics; state.recommendations[recommendation.id] = recommendation; return { result: null }; }); return recommendation;
  };
  return { ...f, worker, measured, generations };
}

test('ADAS-34 worker sends pending proposal only under current accepted automatic policy', async () => {
  const f = await fixture(); try { const p = await f.propose(); const outcome = await f.worker.processProposal('store-a', p.id); assert.equal(outcome.status, 'remote_paused'); assert.ok(outcome.executionId); const state = await f.repo.read('store-a'); assert.equal(state.proposals[p.id].approvedBy, null); assert.equal(Object.keys(state.executions).length, 1); } finally { await f.close(); }
});
test('ADAS-47 manual mode retains a reviewable proposal without provider execution', async () => {
  const f = await fixture(); try { await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'manual' }); const r = await f.measured(true); const result = await f.worker.recommendation('store-a', r.id); assert.equal(result.status, 'pending_review'); assert.equal(result.executionId, null); const p = (await f.repo.read('store-a')).proposals[result.proposalId]; assert.equal(p.kind, 'pause'); assert.equal(p.approvedBy, null); assert.equal(f.calls.includes('execute'), false); } finally { await f.close(); }
});
test('ADAS-45 insufficient evidence never becomes an optimization proposal or write', async () => {
  const f = await fixture(); try { const r = await f.measured(false); await assert.rejects(f.worker.recommendation('store-a', r.id), { code: 'recommendation_data_insufficient' }); const state = await f.repo.read('store-a'); assert.equal(Object.keys(state.proposals).length, 0); assert.equal(Object.keys(state.executions).length, 0); } finally { await f.close(); }
});
test('ADAS-47 one recommendation is idempotent across repeated worker admission', async () => {
  const f = await fixture(); try { const r = await f.measured(true); const first = await f.worker.recommendation('store-a', r.id), again = await f.worker.recommendation('store-a', r.id); assert.equal(first.proposalId, again.proposalId); assert.equal(first.executionId, again.executionId); const state = await f.repo.read('store-a'); assert.equal(Object.keys(state.proposals).length, 1); assert.equal(Object.keys(state.executions).length, 1); assert.equal(state.proposals[first.proposalId].approvedBy, null); } finally { await f.close(); }
});
test('ADAS-35 out of policy budget is denied by automatic executor without escalating the accepted ceiling', async () => {
  const f = await fixture(); try { const p = await f.propose('budget', { budget: { ...f.budget, amountCents: 11000 } }); await assert.rejects(f.worker.processProposal('store-a', p.id), { code: 'authorization_limit_exceeded' }); assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0); assert.equal((await f.policies.view('store-a')).policy!.limits.campaignCeilingCents, 10000); } finally { await f.close(); }
});
test('ADAS-38 revocation leaves a queued proposal pending with no fabricated approval', async () => {
  const f = await fixture(); try { const p = await f.propose(); await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'revoke-pending' }); const result = await f.worker.processProposal('store-a', p.id); assert.equal(result.status, 'pending_review'); assert.equal(result.executionId, null); assert.equal((await f.repo.read('store-a')).proposals[p.id].approvedBy, null); assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0); } finally { await f.close(); }
});
test('ADAS-34 new campaign intent is forbidden unless new campaigns were explicitly included', async () => {
  const f = await fixture(); try { const draft = (await f.repo.read('store-a')).campaigns[f.campaignId].draft; await assert.rejects(f.worker.createCampaign('store-a', { draft, imageCount: 1, idempotencyKey: 'new-campaign' }), { code: 'authorization_limit_exceeded' }); assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length, 1); } finally { await f.close(); }
});
test('ADAS-28 new campaign receives canonical origin policy binding and quota-backed generation without buying extras', async () => {
  const f = await fixture(); try {
    const current = await f.policies.view('store-a'); const review = await f.policies.review('store-a', 'owner-a', { scope: { ...current.policy!.scope, allowNewCampaigns: true }, limits: current.policy!.limits });
    const policy = (await f.policies.accept('store-a', 'owner-a', { scope: review.scope, limits: review.limits, version: review.version, digest: review.digest, idempotencyKey: 'allow-new' })).policy!;
    const draft = { ...(await f.repo.read('store-a')).campaigns[f.campaignId].draft, mediaIds: [] };
    const first = await f.worker.createCampaign('store-a', { draft, imageCount: 2, idempotencyKey: 'new-campaign' }), again = await f.worker.createCampaign('store-a', { draft, imageCount: 2, idempotencyKey: 'new-campaign' });
    assert.equal(first.id, again.id); const state = await f.repo.read('store-a');
    assert.equal(state.campaigns[first.id].createdByAgent, true); assert.equal((await f.repo.getRecord('store-a', `campaign-origin:${first.id}`))!.payload.source, 'agent');
    assert.deepEqual((await f.repo.getRecord('store-a', `automatic-policy-campaign:${policy.id}:${first.id}`))!.payload, { policyId: policy.id, policyVersion: policy.version, campaignId: first.id });
    assert.equal(Object.values(state.generations).length, 1); assert.equal(Object.values(state.generations)[0].requestedImages, 2); assert.equal(state.credits.monthlyAvailable, 28); assert.equal(f.calls.some(call => call.includes('checkout')), false);
  } finally { await f.close(); }
});

test('ADAS-34 accepted new campaign intent generates prepares and publishes once through the guarded executor', async () => {
  const f = await fixture(false); try {
    const review = await f.policies.review('store-a', 'owner-a', { scope: { ...f.policy.scope, allowNewCampaigns: true }, limits: f.policy.limits });
    await f.policies.accept('store-a', 'owner-a', { scope: review.scope, limits: review.limits, version: review.version, digest: review.digest, idempotencyKey: 'new-flow' });
    const source = (await f.repo.read('store-a')).campaigns[f.campaignId];
    const campaign = await f.worker.createCampaign('store-a', { draft: { ...source.draft, mediaIds: [] }, imageCount: 1, idempotencyKey: 'complete-new-flow' });
    const job = Object.values((await f.repo.read('store-a')).generations)[0]; await f.generations.run('store-a', job.id);
    f.budgetControl.prove = async (_access, item) => ({ ...f.reading(), campaignId: item.id });
    let creates = 0, publishes = 0;
    f.provider.prepare = async (access, _campaign, _media, progress) => { await access.assertWriteAuthorized!(); creates++; const objects = [{ type: 'campaign' as const, id: '200' }, { type: 'ad_set' as const, id: '300' }, { type: 'ad' as const, id: '500' }]; await progress(objects); return { status: 'remote_paused', objects }; };
    f.provider.execute = async (access, _campaign, proposal) => { await access.assertWriteAuthorized!(); assert.equal(proposal.kind, 'publish'); publishes++; return { status: 'active_unconfirmed', objects: [{ type: 'campaign', id: '200' }] }; };
    await f.worker.drain(); await f.worker.drain();
    const state = await f.repo.read('store-a'); assert.equal(creates, 1); assert.equal(publishes, 1); assert.equal(state.campaigns[campaign.id].status, 'active_unconfirmed');
    assert.equal(Object.values(state.proposals).filter(p => p.campaignId === campaign.id).length, 2); assert.equal(Object.values(state.proposals).some(p => p.approvedBy !== null), false);
    assert.equal(state.exposure!.allocations[campaign.id].amountCents, 10000); assert.deepEqual(state.exposure!.pending, {});
  } finally { await f.close(); }
});

test('ADAS-47 automatic creative recommendation waits for one new verified image before replacement', async () => {
  const f = await fixture(); try {
    const r = await f.measured(true);
    await f.repo.mutate('store-a', [], state => { state.recommendations[r.id].proposedAction = 'creative'; return { result: null }; });
    const queued = await f.worker.recommendation('store-a', r.id); assert.equal(queued.status, 'generation_pending'); assert.equal(queued.proposalId, ''); assert.equal(f.calls.includes('execute'), false);
    await f.worker.recommendation('store-a', r.id); let state = await f.repo.read('store-a'); assert.equal(Object.values(state.generations).length, 1); assert.equal(state.credits.monthlyAvailable, 29);
    await f.generations.run('store-a', Object.values(state.generations)[0].id);
    let replacement: string | undefined; f.provider.execute = async (access, _campaign, proposal) => { await access.assertWriteAuthorized!(); replacement = (proposal.after.media as Array<{ id: string }>)[0].id; return { status: 'remote_paused', objects: [{ type: 'campaign', id: '200' }] }; };
    const result = await f.worker.recommendation('store-a', r.id); assert.equal(result.status, 'remote_paused'); assert.ok(replacement); assert.notEqual(replacement, 'media-a');
    state = await f.repo.read('store-a'); assert.equal(state.media[replacement!].commercialReview!.status, 'verified'); assert.equal(Object.keys(state.executions).length, 1); assert.equal(state.credits.monthlyAvailable, 29);
  } finally { await f.close(); }
});

test('ADAS-28 manual creative review never spends an image credit or proposes replacement using old media', async () => {
  const f = await fixture(); try {
    const r = await f.measured(true); await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'manual-creative' });
    await f.repo.mutate('store-a', [], state => { state.recommendations[r.id].proposedAction = 'creative'; return { result: null }; });
    const result = await f.worker.recommendation('store-a', r.id), state = await f.repo.read('store-a');
    assert.equal(result.status, 'creative_review_required'); assert.equal(result.proposalId, ''); assert.equal(Object.keys(state.generations).length, 0); assert.equal(Object.keys(state.proposals).length, 0); assert.equal(state.credits.monthlyAvailable, 30);
  } finally { await f.close(); }
});
