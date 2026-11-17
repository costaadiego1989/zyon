import type { MetaAdsActionKind } from '@zyon/shared-types';
import { assistantProduct, metaAssistantFixture } from './assistant-fixture.js';
import { AutomationPolicyService } from '../automation-policy.service.js';
import { ExposureReservationService } from '../exposure-reservation.service.js';
import { FundingService } from '../funding.service.js';
import { ExecutionAuthorityService } from '../execution-authority.service.js';
import type { MetaBudgetControlPort } from '../../domain/budget-control.port.js';
import { MetaAdsError } from '../../domain/types.js';

export async function authorityFixture(prepared = true) {
  const f = await metaAssistantFixture(); await f.connect(); f.setNow('2026-11-16T12:00:00Z');
  let enabled = true, role = true, financialBlocked = false, controlAvailable = true, remoteAmount = 10000, fundingReads = 0;
  const budget = { amountCents: 10000, currency: 'BRL' as const, cadence: 'lifetime' as const, startsAt: f.clock().toISOString(), endsAt: '2026-11-23T12:00:00.000Z' };
  const created = await f.service.campaigns.create('store-a', { name: 'Camisa', destination: 'store', priority: 'roas', country: 'BR', variantIds: ['variant-a'], mediaIds: [], headline: 'Camisa de algodão', primaryText: 'Conheça nossa camisa', budget }, 'authority-campaign');
  await f.repo.mutate('store-a', [], state => {
    state.media['media-a'] = { id: 'media-a', campaignId: created.id, productId: 'product-a', variantId: 'variant-a', productVersion: 'version-a', url: 'https://media.example.test/ad.png', createdAt: f.clock().toISOString(), commercialReview: { status: 'verified', productVersion: 'version-a', imageSha256: 'a'.repeat(64), reviewedAt: f.clock().toISOString() } };
    state.campaigns[created.id].draft.mediaIds = ['media-a'];
    if (prepared) Object.assign(state.campaigns[created.id], { remoteCampaignId: '200', remoteAccountId: '100', remoteAdSetId: '300', remoteAdIds: ['500'], status: 'remote_paused' });
    return { result: null };
  });
  f.provider.snapshot = async () => ({ campaignId: '200', status: 'PAUSED', effectiveStatus: 'PAUSED', budget: { lifetime_budget: String(remoteAmount), daily_budget: null, spend_cap: null }, targeting: {}, adSetId: '300', adIds: ['500'], creativeIds: ['400'] });
  const authorizeActor = async (merchantId: string, actorId: string) => { if (!role || merchantId !== 'store-a' || actorId !== 'owner-a') throw new MetaAdsError('meta_ads_role_forbidden', 403); };
  const policies = new AutomationPolicyService({ repo: f.repo, commerce: f.commerce, connection: f.service.connection, campaigns: f.service.campaigns, authorizeActor, enabled: () => enabled, clock: f.clock });
  const review = await policies.review('store-a', 'owner-a', { scope: { variantIds: ['variant-a'], campaignIds: [created.id], allowNewCampaigns: false, destination: 'store', priority: 'roas', country: 'BR', actions: ['prepare', 'publish', 'pause', 'budget', 'creative'] }, limits: { currency: 'BRL', cadence: 'lifetime', campaignCeilingCents: 10000, storeCeilingCents: 20000, startsAt: budget.startsAt, endsAt: budget.endsAt } });
  const policy = (await policies.accept('store-a', 'owner-a', { scope: review.scope, limits: review.limits, version: review.version, digest: review.digest, idempotencyKey: 'authority-policy' })).policy!;
  const exposure = new ExposureReservationService({ repo: f.repo, commerce: f.commerce, enabled: () => enabled, clock: f.clock });
  const reading = () => ({ campaignId: created.id, accountId: '100', connectionEpoch: policy.connectionEpoch, remoteCampaignId: '200', currency: 'BRL' as const, cadence: 'lifetime' as const, amountCents: remoteAmount, checkedAt: f.clock().toISOString(), kind: 'campaign_lifetime' as const, startsAt: budget.startsAt, endsAt: budget.endsAt, adSetId: '300', adIds: ['500'], fingerprint: 'b'.repeat(64) });
  const budgetControl: MetaBudgetControlPort = { read: async () => { if (!controlAvailable) throw new MetaAdsError('automatic_budget_control_unavailable', 503); return reading(); }, prove: async (_access, _campaign, target, _limits, matchAmount = true) => {
    if (!controlAvailable) throw new MetaAdsError('automatic_budget_control_unavailable', 503);
    if (matchAmount && target.amountCents !== remoteAmount) throw new MetaAdsError('authorization_limit_exceeded', 409);
    return reading();
  } };
  const funding = new FundingService(f.repo, f.service.billing, f.service.connection, { read: async () => {
    fundingReads++; return { accountId: '100', accountName: 'Conta', currency: 'BRL', billingType: 'postpaid', paymentMethod: 'present', confirmedBlock: financialBlocked, blockCode: financialBlocked ? 'account_unsettled' : null, amountDueCents: 0, prepaidAvailableCents: null, checkedAt: f.clock().toISOString(), source: 'controlled-meta', paymentUrl: null };
  } }, f.clock);
  const authority = new ExecutionAuthorityService({ repo: f.repo, commerce: f.commerce, campaigns: f.service.campaigns, connection: f.service.connection, policies, exposure, budgetControl, funding, authorizeActor, enabled: () => enabled, clock: f.clock });
  let sequence = 0;
  const propose = (kind: MetaAdsActionKind = 'pause', after: Record<string, unknown> = {}) => f.service.proposals.create('store-a', created.id, { kind, after, reasoning: 'Ação dentro do objetivo escolhido', idempotencyKey: `authority-proposal-${++sequence}` });
  const automatic = { kind: 'automatic' as const, policyId: policy.id, policyVersion: policy.version, policyDigest: policy.digest };
  const approveInitialPublication = async () => {
    const publication = await propose('publish');
    await f.service.proposals.approve('store-a', publication.id, 'owner-a', publication.digest);
    return publication;
  };
  return { ...f, campaignId: created.id, budget, policy, policies, exposure, authority, funding, budgetControl, reading, propose, automatic, approveInitialPublication,
    enabled: (value: boolean) => { enabled = value; }, role: (value: boolean) => { role = value; }, financialBlocked: (value: boolean) => { financialBlocked = value; }, controlAvailable: (value: boolean) => { controlAvailable = value; }, remoteAmount: (value: number) => { remoteAmount = value; }, fundingReads: () => fundingReads,
    changeProduct: () => { f.commerce.products = async () => [{ ...assistantProduct, stockQuantity: 0, commercialVersion: 'version-changed' }]; } };
}
