import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorityFixture } from './__tests__/authority-fixture.js';

test('ACAP-11 automatic prepare and launch cannot create a new campaign even inside an accepted policy', async () => {
  const f = await authorityFixture(false); try {
    for (const kind of ['prepare', 'launch'] as const) {
      const p = await f.propose(kind);
      await assert.rejects(f.authority.resolve('store-a', p.id, f.automatic), { code: 'initial_approval_required' });
      assert.equal(await f.repo.getRecord('store-a', `proposal-approval:${p.id}`), null);
    }
    assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0); assert.equal(f.calls.includes('execute'), false);
  } finally { await f.close(); }
});
test('ACAP-11 prepared remote objects and mutable approvedBy cannot substitute a publication receipt', async () => {
  const f = await authorityFixture(); try {
    const p = await f.propose('publish');
    await assert.rejects(f.authority.resolve('store-a', p.id, f.automatic), { code: 'initial_approval_required' });
    const forged = await f.propose('publish');
    await f.repo.mutate('store-a', [], state => { Object.assign(state.proposals[forged.id], { approvedBy: 'owner-a', approvedAt: f.clock().toISOString(), status: 'approved' }); return { result: null }; });
    await assert.rejects(f.authority.resolve('store-a', p.id, f.automatic), { code: 'initial_approval_required' });
    const pause = await f.propose('pause'); assert.equal((await f.authority.resolve('store-a', pause.id, f.automatic)).kind, 'automatic');
  } finally { await f.close(); }
});
test('ACAP-11 a real legacy paused-preparation receipt never authorizes automatic publication', async () => {
  const f = await authorityFixture(false); try {
    const p = await f.propose('prepare'); await f.service.proposals.approve('store-a', p.id, 'owner-a', p.digest);
    await f.repo.mutate('store-a', [], state => { Object.assign(state.campaigns[f.campaignId], { remoteCampaignId: '200', remoteAccountId: '100', remoteAdSetId: '300', remoteAdIds: ['500'] }); return { result: null }; });
    const publication = await f.propose('publish');
    await assert.rejects(f.authority.resolve('store-a', publication.id, f.automatic), { code: 'initial_approval_required' }); assert.equal(f.calls.includes('execute'), false);
  } finally { await f.close(); }
});
test('ACAP-16 authentic unchanged legacy publication approval permits a policy grant without inventing another manual approval', async () => {
  const f = await authorityFixture(); try {
    const approved = await f.approveInitialPublication(), p = await f.propose('publish');
    assert.equal((await f.authority.resolve('store-a', p.id, f.automatic)).kind, 'automatic');
    assert.equal((await f.repo.read('store-a')).proposals[approved.id].approvedBy, 'owner-a');
    assert.equal((await f.repo.read('store-a')).proposals[p.id].approvedBy, null); assert.equal(await f.repo.getRecord('store-a', `proposal-approval:${p.id}`), null);
  } finally { await f.close(); }
});
test('ACAP-14 an unexecuted legacy approval cannot cover a changed budget period or remote object', async () => {
  for (const change of ['budget', 'period', 'object']) {
    const f = await authorityFixture(); try {
      await f.approveInitialPublication();
      await f.repo.mutate('store-a', [], state => { const c = state.campaigns[f.campaignId]; if (change === 'budget') c.draft.budget!.amountCents = 9000; else if (change === 'period') c.draft.budget!.endsAt = '2026-11-22T12:00:00.000Z'; else c.remoteAdIds = ['501']; return { result: null }; });
      if (change === 'budget') f.remoteAmount(9000);
      const p = await f.propose('publish'); await assert.rejects(f.authority.resolve('store-a', p.id, f.automatic), { code: 'initial_approval_required' });
    } finally { await f.close(); }
  }
});
test('ACAP-16 confirmed authentic manual publication supports bounded resume after an approved campaign change', async () => {
  const f = await authorityFixture(); try {
    const approved = await f.approveInitialPublication();
    f.provider.execute = async () => ({ status: 'active_unconfirmed', objects: [{ type: 'campaign', id: '200' }] });
    const initial = await f.service.executions.execute('store-a', approved.id, 'owner-a'); assert.equal(initial.status, 'active_unconfirmed');
    await f.repo.mutate('store-a', [], state => { state.campaigns[f.campaignId].draft.budget!.amountCents = 9000; return { result: null }; }); f.remoteAmount(9000);
    const p = await f.propose('publish'); assert.equal((await f.authority.resolve('store-a', p.id, f.automatic)).kind, 'automatic');
    await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'revoke-resume' });
    await assert.rejects(f.authority.resolve('store-a', p.id, f.automatic), { code: 'automatic_authority_unavailable' });
  } finally { await f.close(); }
});
test('ACAP-13 manual launch requires its own exact receipt and checks funding before any write', async () => {
  const f = await authorityFixture(false); try {
    const p = await f.propose('launch');
    await assert.rejects(f.authority.resolve('store-a', p.id, { kind: 'manual', actorId: 'owner-a' }), { code: 'approval_required' });
    await f.service.proposals.approve('store-a', p.id, 'owner-a', p.digest);
    const authority = await f.authority.resolve('store-a', p.id, { kind: 'manual', actorId: 'owner-a' });
    assert.equal(authority.proposalDigest, p.digest); assert.equal(authority.kind, 'manual'); assert.ok(f.fundingReads() > 0);
    f.financialBlocked(true); await assert.rejects(f.authority.assertCurrent('store-a', p.id, authority), { code: 'meta_funding_blocked' }); assert.equal(f.calls.includes('execute'), false);
  } finally { await f.close(); }
});
test('ACAP-14 launch revalidates text media identity review assets and catalogue after approval', async () => {
  for (const change of ['text', 'media-url', 'media-hash', 'review', 'page', 'catalogue']) {
    const f = await authorityFixture(false); try {
      const p = await f.propose('launch'); await f.service.proposals.approve('store-a', p.id, 'owner-a', p.digest);
      const authority = await f.authority.resolve('store-a', p.id, { kind: 'manual', actorId: 'owner-a' });
      await f.repo.mutate('store-a', [], state => { if (change === 'text') state.campaigns[f.campaignId].draft.headline = 'Outro'; if (change === 'media-url') state.media['media-a'].url = 'https://media.example.test/replaced.png'; if (change === 'media-hash') state.media['media-a'].commercialReview!.imageSha256 = 'b'.repeat(64); if (change === 'review') state.media['media-a'].commercialReview!.status = 'rejected'; if (change === 'page') state.connection.page!.id = '111'; return { result: null }; });
      if (change === 'catalogue') f.changeProduct();
      await assert.rejects(f.authority.assertCurrent('store-a', p.id, authority), { code: 'proposal_stale' }); assert.equal(f.calls.includes('execute'), false);
    } finally { await f.close(); }
  }
});
test('ACAP-14 a foreign remote campaign cannot be bound to a manual launch receipt', async () => {
  const f = await authorityFixture(false); try {
    const p = await f.propose('launch'); await f.service.proposals.approve('store-a', p.id, 'owner-a', p.digest);
    await f.repo.mutate('store-a', [], state => { Object.assign(state.campaigns[f.campaignId], { remoteCampaignId: '999', remoteAccountId: '100' }); return { result: null }; });
    await assert.rejects(f.authority.resolve('store-a', p.id, { kind: 'manual', actorId: 'owner-a' }), { code: 'campaign_already_prepared' }); assert.equal(f.calls.includes('execute'), false);
  } finally { await f.close(); }
});

test('ADAS-35 refreshed other-campaign budget prevents spending against a stale aggregate allocation', async () => {
  const f = await authorityFixture(); try {
    const original = (await f.repo.read('store-a')).campaigns[f.campaignId];
    const other = await f.service.campaigns.create('store-a', { ...original.draft, name: 'Outra campanha', mediaIds: [] }, 'other-tracked');
    await f.repo.mutate('store-a', [], state => { Object.assign(state.campaigns[other.id], { remoteCampaignId: '201', remoteAccountId: '100', remoteAdSetId: '301', remoteAdIds: ['501'], status: 'remote_paused' }); return { result: null }; });
    const review = await f.policies.review('store-a', 'owner-a', { scope: { ...f.policy.scope, campaignIds: [f.campaignId, other.id] }, limits: f.policy.limits });
    const policy = (await f.policies.accept('store-a', 'owner-a', { scope: review.scope, limits: review.limits, version: review.version, digest: review.digest, idempotencyKey: 'two-campaign-policy' })).policy!;
    f.remoteAmount(5000); await f.exposure.observe('store-a', f.reading());
    await f.exposure.observe('store-a', { ...f.reading(), campaignId: other.id, remoteCampaignId: '201' });
    f.budgetControl.read = async (_access, campaign) => ({ ...f.reading(), campaignId: campaign.id, remoteCampaignId: '201', adSetId: '301', adIds: ['501'], amountCents: 15000 });
    const proposal = await f.propose('budget', { budget: f.budget });
    await assert.rejects(f.authority.resolve('store-a', proposal.id, { kind: 'automatic', policyId: policy.id, policyVersion: policy.version, policyDigest: policy.digest }), { code: 'authorization_limit_exceeded' });
    assert.equal((await f.repo.read('store-a')).exposure!.allocations[other.id].amountCents, 15000); assert.equal(f.calls.includes('execute'), false);
  } finally { await f.close(); }
});

test('ADAS-36 a manual financial write outside the ledger fences automatic exposure while protective pause remains available', async () => {
  const f = await authorityFixture(); let release!: () => void, entered!: () => void; const hold = new Promise<void>(yes => { release = yes; }), started = new Promise<void>(yes => { entered = yes; }); let running: ReturnType<typeof f.service.executions.execute> | undefined;
  try {
    const original = (await f.repo.read('store-a')).campaigns[f.campaignId];
    const other = await f.service.campaigns.create('store-a', { ...original.draft, name: 'Preparação manual', budget: { ...f.budget, amountCents: 20000 }, mediaIds: [] }, 'manual-financial');
    await f.repo.mutate('store-a', [], state => { state.media['other-media'] = { ...state.media['media-a'], id: 'other-media', campaignId: other.id }; state.campaigns[other.id].draft.mediaIds = ['other-media']; return { result: null }; });
    const p = await f.service.proposals.create('store-a', other.id, { kind: 'prepare', after: {}, reasoning: 'Aprovação individual fora da política', idempotencyKey: 'manual-financial-prepare' });
    await f.service.proposals.approve('store-a', p.id, 'owner-a', p.digest);
    await f.approveInitialPublication();
    const publication = await f.propose('publish'), pause = await f.propose('pause');
    f.provider.prepare = async access => { await access.assertWriteAuthorized!(); entered(); await hold; return { status: 'remote_paused', objects: [{ type: 'campaign', id: '201' }, { type: 'ad_set', id: '301' }, { type: 'ad', id: '501' }] }; };
    running = f.service.executions.execute('store-a', p.id, 'owner-a'); await started;
    await assert.rejects(f.authority.resolve('store-a', publication.id, f.automatic), { code: 'automatic_budget_control_unavailable' });
    assert.equal((await f.authority.resolve('store-a', pause.id, f.automatic)).kind, 'automatic'); assert.equal(f.calls.includes('execute'), false);
  } finally { release(); await running?.catch(() => undefined); await f.close(); }
});

test('ADAS-31 manual authority requires the exact reviewed and approved proposal receipt', async () => {
  const f = await authorityFixture(); try {
    const proposal = await f.propose(); await assert.rejects(f.authority.resolve('store-a', proposal.id, { kind: 'manual', actorId: 'owner-a' }), /approval_required/);
    await f.service.proposals.approve('store-a', proposal.id, 'owner-a', proposal.digest);
    const authority = await f.authority.resolve('store-a', proposal.id, { kind: 'manual', actorId: 'owner-a' });
    assert.equal(authority.kind, 'manual'); assert.equal(authority.actorId, 'owner-a'); assert.equal(authority.proposalDigest, proposal.digest);
    assert.ok(authority.kind === 'manual'); assert.equal(authority.approvedBy, 'owner-a'); assert.equal(authority.approvedAt, f.clock().toISOString());
    assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
test('ADAS-34 policy authority identifies the service and never creates fictional manual approval', async () => {
  const f = await authorityFixture(); try {
    const proposal = await f.propose(); const authority = await f.authority.resolve('store-a', proposal.id, f.automatic);
    assert.equal(authority.kind, 'automatic'); assert.equal(authority.actorId, 'service:meta-ads-agent'); assert.ok(authority.kind === 'automatic');
    assert.equal(authority.policyId, f.policy.id); assert.equal(authority.policyVersion, f.policy.version); assert.equal(authority.policyDigest, f.policy.digest);
    const saved = (await f.repo.read('store-a')).proposals[proposal.id]; assert.equal(saved.status, 'pending_review'); assert.equal(saved.approvedBy, null); assert.equal(saved.approvedAt, null);
    assert.equal(await f.repo.getRecord('store-a', `proposal-approval:${proposal.id}`), null);
  } finally { await f.close(); }
});
test('ADAS-35 automatic budget scope rejects a higher ceiling before sending any provider mutation', async () => {
  const f = await authorityFixture(); try {
    const proposal = await f.propose('budget', { budget: { ...f.budget, amountCents: 10001 } });
    await assert.rejects(f.authority.resolve('store-a', proposal.id, f.automatic), { code: 'authorization_limit_exceeded' });
    assert.ok(!f.calls.includes('execute')); assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0);
  } finally { await f.close(); }
});
test('ADAS-37 automatic publication cannot proceed when the provider cannot prove its financial control', async () => {
  const f = await authorityFixture(); try {
    await f.approveInitialPublication(); const proposal = await f.propose('publish'); f.controlAvailable(false);
    await assert.rejects(f.authority.resolve('store-a', proposal.id, f.automatic), { code: 'automatic_budget_control_unavailable' });
    assert.ok(!f.calls.includes('execute')); assert.equal(Object.keys((await f.repo.read('store-a')).executions).length, 0);
  } finally { await f.close(); }
});
test('ADAS-07 confirmed funding block stops publication while policy-authorized pause can still protect spending', async () => {
  const f = await authorityFixture(); try {
    await f.approveInitialPublication(); f.financialBlocked(true); const publish = await f.propose('publish');
    await assert.rejects(f.authority.resolve('store-a', publish.id, f.automatic), { code: 'meta_funding_blocked' });
    const reads = f.fundingReads(); const pause = await f.propose(); const authority = await f.authority.resolve('store-a', pause.id, f.automatic);
    assert.equal(authority.kind, 'automatic'); assert.equal(f.fundingReads(), reads); assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
test('ADAS-38 revocation after resolution wins the final authority check before a write', async () => {
  const f = await authorityFixture(); try {
    const proposal = await f.propose(); const authority = await f.authority.resolve('store-a', proposal.id, f.automatic);
    await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'revoke-authority' });
    await assert.rejects(f.authority.assertCurrent('store-a', proposal.id, authority), { code: 'automatic_authority_unavailable' });
    assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
test('ADAS-39 role entitlement connection and flag loss fence an already resolved automatic authority', async () => {
  for (const change of ['role', 'entitlement', 'connection', 'flag']) {
    const f = await authorityFixture(); try {
      const proposal = await f.propose(); const authority = await f.authority.resolve('store-a', proposal.id, f.automatic);
      if (change === 'role') f.role(false);
      if (change === 'entitlement') f.setNow('2026-12-02T12:00:00Z');
      if (change === 'connection') await f.service.connection.disconnect('store-a');
      if (change === 'flag') f.enabled(false);
      await assert.rejects(f.authority.assertCurrent('store-a', proposal.id, authority));
      assert.ok(!f.calls.includes('execute'));
    } finally { await f.close(); }
  }
});
test('ADAS-39 changed product or canonical campaign cannot reuse a frozen authority', async () => {
  const f = await authorityFixture(); try {
    const proposal = await f.propose(); const authority = await f.authority.resolve('store-a', proposal.id, f.automatic);
    await f.repo.mutate('store-a', [], state => { state.campaigns[f.campaignId].draft.headline = 'Outro texto'; return { result: null }; });
    await assert.rejects(f.authority.assertCurrent('store-a', proposal.id, authority), { code: 'proposal_stale' });
    f.changeProduct(); await assert.rejects(f.authority.resolve('store-a', proposal.id, f.automatic), { code: 'proposal_stale' });
  } finally { await f.close(); }
});
test('ADAS-31 immutable proposal tampering cannot be covered by any manual or automatic authority', async () => {
  const f = await authorityFixture(); try {
    const proposal = await f.propose(); await f.service.proposals.approve('store-a', proposal.id, 'owner-a', proposal.digest);
    await f.repo.mutate('store-a', [], state => { state.proposals[proposal.id].after.status = 'ACTIVE'; return { result: null }; });
    await assert.rejects(f.authority.resolve('store-a', proposal.id, { kind: 'manual', actorId: 'owner-a' }), { code: 'proposal_version_changed' });
    await assert.rejects(f.authority.resolve('store-a', proposal.id, f.automatic), { code: 'proposal_version_changed' });
    assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
test('ADAS-48 manual actor scope and injected automatic actor claims are rejected', async () => {
  const f = await authorityFixture(); try {
    const proposal = await f.propose();
    await assert.rejects(f.authority.resolve('store-b', proposal.id, { kind: 'manual', actorId: 'owner-a' }), { code: 'meta_ads_role_forbidden' });
    await assert.rejects(f.authority.resolve('store-a', proposal.id, { ...f.automatic, actorId: 'owner-a' } as typeof f.automatic), { code: 'execution_authority_invalid' });
    assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
