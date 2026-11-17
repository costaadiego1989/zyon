import assert from 'node:assert/strict';
import { test } from 'node:test';
import {authorityFixture} from './__tests__/authority-fixture.js';
import {ExecutionService} from './execution.service.js';
import { metaAssistantFixture } from './__tests__/assistant-fixture.js';
import { AutomationPolicyService } from './automation-policy.service.js';
import { ExposureReservationService } from './exposure-reservation.service.js';

async function fixture() {
  const f = await metaAssistantFixture(); await f.connect(); f.setNow('2026-11-16T12:00:00Z');
  const budget = { amountCents: 5000, currency: 'BRL' as const, cadence: 'lifetime' as const, startsAt: f.clock().toISOString(), endsAt: '2026-11-23T12:00:00.000Z' };
  const campaigns = await Promise.all([0, 1].map(i => f.service.campaigns.create('store-a', { name: `Campanha ${i}`, destination: 'store', priority: 'roas', variantIds: ['variant-a'], mediaIds: [], headline: '', primaryText: '', country: 'BR', budget }, `exposure-campaign-${i}`)));
  const policies = new AutomationPolicyService({ repo: f.repo, commerce: f.commerce, connection: f.service.connection, campaigns: f.service.campaigns, authorizeActor: async () => {}, enabled: () => true, clock: f.clock });
  const review = await policies.review('store-a', 'owner-a', { scope: { variantIds: ['variant-a'], campaignIds: campaigns.map(c => c.id), allowNewCampaigns: false, destination: 'store', priority: 'roas', country: 'BR', actions: ['prepare', 'publish', 'pause', 'budget'] }, limits: { currency: 'BRL', cadence: 'lifetime', campaignCeilingCents: 10000, storeCeilingCents: 15000, startsAt: budget.startsAt, endsAt: budget.endsAt } });
  const accepted = await policies.accept('store-a', 'owner-a', { scope: review.scope, limits: review.limits, version: review.version, digest: review.digest, idempotencyKey: 'exposure-policy' });
  const policy = accepted.policy!;
  const exposure = new ExposureReservationService({ repo: f.repo, commerce: f.commerce, enabled: () => true, clock: f.clock });
  const input = (index: number, amountCents: number, operationId: string, action: 'prepare' | 'publish' | 'budget' = 'prepare') => ({ policyId: policy.id, policyVersion: policy.version, policyDigest: policy.digest, campaignId: campaigns[index].id, operationId, action, targetBudget: { ...budget, amountCents } });
  const remote = async (index: number) => f.repo.mutate('store-a', [], state => { Object.assign(state.campaigns[campaigns[index].id], { remoteCampaignId: String(200 + index), remoteAccountId: '100' }); return { result: null }; });
  const proof = (index: number, amountCents: number) => ({ campaignId: campaigns[index].id, accountId: '100', connectionEpoch: policy.connectionEpoch, remoteCampaignId: String(200 + index), currency: 'BRL' as const, cadence: 'lifetime' as const, amountCents, checkedAt: f.clock().toISOString() });
  return { ...f, policies, policy, exposure, campaigns, input, remote, proof };
}
test('ADAS-36 concurrent campaigns cannot reserve the same remaining store ceiling', async () => {
  const f = await fixture(); try {
    const results = await Promise.allSettled([f.exposure.reserve('store-a', f.input(0, 10000, 'op-a')), f.exposure.reserve('store-a', f.input(1, 10000, 'op-b'))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'authorization_limit_exceeded');
    const view = await f.policies.view('store-a'); assert.equal(view.committedCents, 10000); assert.equal(view.availableCents, 5000);
  } finally { await f.close(); }
});
test('ADAS-36 identical reservation repeats once and changed terms cannot reuse its operation id', async () => {
  const f = await fixture(); try {
    const a = await f.exposure.reserve('store-a', f.input(0, 10000, 'op-a'));
    const b = await f.exposure.reserve('store-a', f.input(0, 10000, 'op-a')); assert.deepEqual(a, b);
    await assert.rejects(f.exposure.reserve('store-a', f.input(0, 9000, 'op-a')), { code: 'exposure_request_conflict' });
    await assert.rejects(f.exposure.reserve('store-a', f.input(0, 9000, 'op-b')), { code: 'exposure_operation_pending' });
    assert.equal((await f.policies.view('store-a')).committedCents, 10000);
  } finally { await f.close(); }
});
test('ADAS-50 unknown dispatched allocation retains exposure across revocation and clock changes', async () => {
  const f = await fixture(); try {
    await f.exposure.reserve('store-a', f.input(0, 10000, 'op-a')); await f.exposure.dispatched('store-a', 'op-a'); await f.exposure.unknown('store-a', 'op-a');
    await assert.rejects(f.exposure.cancel('store-a', 'op-a'), { code: 'exposure_reconciliation_required' });
    await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'revoke-exposure' });
    f.setNow('2026-12-01T12:00:00Z'); const view = await f.policies.view('store-a');
    assert.equal(view.mode, 'manual'); assert.equal(view.committedCents, 10000);
    assert.equal((await f.exposure.read('store-a', 'op-a')).status, 'unknown');
  } finally { await f.close(); }
});
test('ADAS-35 a reduction releases store capacity only after remote target is confirmed', async () => {
  const f = await fixture(); try {
    await f.exposure.reserve('store-a', f.input(0, 10000, 'prepare-a')); await f.exposure.dispatched('store-a', 'prepare-a'); await f.remote(0);
    await f.exposure.confirm('store-a', 'prepare-a', f.proof(0, 10000));
    await f.exposure.reserve('store-a', f.input(0, 5000, 'reduce-a', 'budget')); await f.exposure.dispatched('store-a', 'reduce-a');
    await assert.rejects(f.exposure.reserve('store-a', f.input(1, 10000, 'prepare-b')), { code: 'authorization_limit_exceeded' });
    await assert.rejects(f.exposure.confirm('store-a', 'reduce-a', f.proof(0, 10000)), { code: 'exposure_confirmation_mismatch' });
    assert.equal((await f.policies.view('store-a')).committedCents, 10000);
    await f.exposure.confirm('store-a', 'reduce-a', f.proof(0, 5000));
    assert.equal((await f.policies.view('store-a')).availableCents, 10000);
    await f.exposure.reserve('store-a', f.input(1, 10000, 'prepare-b')); assert.equal((await f.policies.view('store-a')).committedCents, 15000);
  } finally { await f.close(); }
});
test('ADAS-35 policy budget ceiling cadence and window cannot be widened by reservation arguments', async () => {
  const f = await fixture(); try {
    for (const patch of [{ amountCents: 10001 }, { cadence: 'daily' }, { startsAt: '2026-11-15T12:00:00Z' }, { endsAt: '2026-11-24T12:00:00Z' }]) {
      const value = f.input(0, 5000, 'limit-a');
      await assert.rejects(f.exposure.reserve('store-a', { ...value, targetBudget: { ...value.targetBudget, ...patch } } as typeof value), { code: 'authorization_limit_exceeded' });
    }
    assert.equal((await f.policies.view('store-a')).committedCents, 0);
  } finally { await f.close(); }
});
test('ADAS-38 revoking policy before dispatch prevents a queued reservation from being sent', async () => {
  const f = await fixture(); try {
    await f.exposure.reserve('store-a', f.input(0, 10000, 'op-a'));
    await f.policies.revoke('store-a', 'owner-a', { policyId: f.policy.id, version: f.policy.version, idempotencyKey: 'revoke-before-send' });
    await assert.rejects(f.exposure.dispatched('store-a', 'op-a'), { code: 'automatic_authority_unavailable' });
    await f.exposure.cancel('store-a', 'op-a'); assert.equal((await f.policies.view('store-a')).committedCents, 0);
  } finally { await f.close(); }
});
test('ADAS-35 remote campaign requires an observed baseline and newly observed excess is counted without granting more spend', async () => {
  const f = await fixture(); try {
    await f.remote(0); await assert.rejects(f.exposure.reserve('store-a', f.input(0, 5000, 'without-proof', 'budget')), { code: 'automatic_budget_control_unavailable' });
    await f.exposure.observe('store-a', f.proof(0, 18000));
    assert.equal((await f.policies.view('store-a')).committedCents, 18000); assert.equal((await f.policies.view('store-a')).availableCents, 0);
    await assert.rejects(f.exposure.reserve('store-a', f.input(1, 5000, 'new-spend')), { code: 'authorization_limit_exceeded' });
    await f.exposure.reserve('store-a', f.input(0, 5000, 'reduce-excess', 'budget')); assert.equal((await f.policies.view('store-a')).committedCents, 18000);
    await f.exposure.dispatched('store-a', 'reduce-excess'); await f.exposure.confirm('store-a', 'reduce-excess', f.proof(0, 5000));
    assert.equal((await f.policies.view('store-a')).committedCents, 5000);
  } finally { await f.close(); }
});
test('ADAS-50 canceled unsent reservation and confirmed result replay never create new commitments', async () => {
  const f = await fixture(); try {
    await f.exposure.reserve('store-a', f.input(0, 10000, 'unsent')); await f.exposure.cancel('store-a', 'unsent');
    assert.equal((await f.policies.view('store-a')).committedCents, 0);
    assert.equal((await f.exposure.reserve('store-a', f.input(0, 10000, 'unsent'))).status, 'cancelled');
    await f.exposure.reserve('store-a', f.input(0, 5000, 'confirmed')); await f.exposure.dispatched('store-a', 'confirmed'); await f.remote(0);
    await f.exposure.confirm('store-a', 'confirmed', f.proof(0, 5000));
    assert.equal((await f.exposure.reserve('store-a', f.input(0, 5000, 'confirmed'))).status, 'confirmed');
    assert.equal((await f.policies.view('store-a')).committedCents, 5000);
  } finally { await f.close(); }
});
test('ADAS-35 newly observed exposure beyond the ceiling blocks an already queued dispatch', async () => {
  const f = await fixture(); try {
    await f.exposure.reserve('store-a', f.input(0, 5000, 'queued'));
    await f.remote(1); await f.exposure.observe('store-a', f.proof(1, 11000));
    await assert.rejects(f.exposure.dispatched('store-a', 'queued'), { code: 'authorization_limit_exceeded' });
    assert.equal((await f.exposure.read('store-a', 'queued')).status, 'reserved');
  } finally { await f.close(); }
});
test('ADAS-50 stopping new management does not prevent recording a confirmed result from the already sent operation', async () => {
  const f = await fixture(); try {
    await f.exposure.reserve('store-a', f.input(0, 5000, 'sent')); await f.exposure.dispatched('store-a', 'sent'); await f.remote(0);
    await f.service.campaigns.stopManaging('store-a', f.campaigns[0].id);
    const result = await f.exposure.confirm('store-a', 'sent', f.proof(0, 5000));
    assert.equal(result.status, 'confirmed'); assert.equal((await f.policies.view('store-a')).committedCents, 5000);
    await assert.rejects(f.exposure.reserve('store-a', f.input(0, 5000, 'new')), { code: 'campaign_read_only' });
  } finally { await f.close(); }
});

test('ADAS-36 ACAP-16 a held manual launch fences automatic financial writes while protective pause remains available', async () => {
  const f = await authorityFixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(yes => { release = yes; });
  const started = new Promise<void>(yes => { entered = yes; });
  let running: ReturnType<ExecutionService['execute']> | undefined;
  let automaticWrites = 0;
  try {
    const original = (await f.repo.read('store-a')).campaigns[f.campaignId];
    const other = await f.service.campaigns.create('store-a', { ...original.draft, name: 'Lançamento concorrente de R$173', budget: { ...f.budget, amountCents: 17300 }, mediaIds: [] }, 'independent-concurrent-launch');
    await f.repo.mutate('store-a', [], state => {
      state.media['independent-media'] = { ...state.media['media-a'], id: 'independent-media', campaignId: other.id };
      state.campaigns[other.id].draft.mediaIds = ['independent-media'];
      return { result: null };
    });
    const launch = await f.service.proposals.create('store-a', other.id, { kind: 'launch', after: {}, reasoning: 'Lançamento administrativo independente', idempotencyKey: 'independent-launch-review' });
    await f.service.proposals.approve('store-a', launch.id, 'owner-a', launch.digest);
    const executor = new ExecutionService(f.repo, f.commerce, f.service.campaigns, f.service.connection, f.provider, f.clock, undefined, { authority: f.authority, exposure: f.exposure, budgetControl: f.budgetControl });
    f.provider.execute = async (access, _campaign, proposal) => {
      await access.assertWriteAuthorized!();
      if (proposal.kind === 'launch') { entered(); await held; return { status: 'execution_unknown', objects: [] }; }
      automaticWrites++;
      return { status: 'remote_paused', objects: [{ type: 'campaign', id: '200' }] };
    };
    running = executor.execute('store-a', launch.id, 'owner-a');
    await Promise.race([started, running.then(() => { throw Error('launch finished before hold'); })]);
    const proposal = await f.propose('budget', { budget: f.budget });
    const outcome = await executor.executeAutomatic('store-a', proposal.id, f.automatic).then(value => ({ status: value.status, error: value.error }), error => ({ status: 'rejected', error: error.code }));
    const current = await f.repo.read('store-a');
    assert.equal(automaticWrites, 0, 'Known in-flight launch must fence automatic exposure before a physical provider write');
    assert.equal(outcome.error, 'automatic_budget_control_unavailable');
    assert.equal(Object.values(current.executions).filter(e=>current.proposals[e.proposalId].kind==='launch')[0].status,'sending');
    const protective=await f.propose('pause');assert.equal((await executor.executeAutomatic('store-a',protective.id,f.automatic)).status,'remote_paused');assert.equal(automaticWrites,1);
    release();await running;const again=await f.propose('budget',{budget:f.budget});await assert.rejects(executor.executeAutomatic('store-a',again.id,f.automatic),{code:'automatic_budget_control_unavailable'});assert.equal(automaticWrites,1);
  } finally { release(); await running?.catch(() => undefined); await f.close(); }
});

test('ADAS-51 action audit persists correlation policy version digest and outcome without access credentials',async()=>{const f=await authorityFixture();try{const p=await f.propose('pause');const executor=new ExecutionService(f.repo,f.commerce,f.service.campaigns,f.service.connection,f.provider,f.clock,undefined,{authority:f.authority,exposure:f.exposure,budgetControl:f.budgetControl});const execution=await executor.executeAutomatic('store-a',p.id,f.automatic);assert.equal(execution.status,'remote_paused');const receipt=(await f.repo.getRecord<any>('store-a',`execution-result:${execution.id}:1`))!.payload;assert.equal(receipt.executionId,execution.id);assert.equal(receipt.proposalId,p.id);assert.equal(receipt.campaignId,f.campaignId);assert.equal(receipt.status,'remote_paused');assert.equal(receipt.kind,'pause');assert.equal(receipt.digest,p.digest);assert.equal(receipt.authority.kind,'automatic');assert.equal(receipt.authority.policyId,f.policy.id);assert.equal(receipt.authority.policyVersion,f.policy.version);assert.equal(receipt.authority.policyDigest,f.policy.digest);assert.equal(receipt.authority.connectionEpoch,p.connectionEpoch);assert.doesNotMatch(JSON.stringify(receipt),/scoped-test-token|Bearer|accessToken|4111111111111111/);}finally{await f.close();}});
