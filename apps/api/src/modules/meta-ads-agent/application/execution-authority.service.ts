import type { MetaAdsAutomationPolicy, MetaAdsBudget, MetaAdsCampaign } from '@zyon/shared-types';
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type Clock, type StoredProposal } from '../domain/types.js';
import type { ExecutionAuthorityPort, ExecutionAuthorityRequest, ResolvedExecutionAuthority } from '../domain/execution-authority.port.js';
import type { MetaBudgetControlPort } from '../domain/budget-control.port.js';
import { requireIdentifier, requireEntitlement, stableDigest } from '../domain/offer.js';
import { hasUnreservedFinancialExecution, totalMetaExposure } from '../domain/exposure.js';
import { approvalProductVersion, assertReviewedProposal } from './proposal.service.js';
import { normalizeCampaignDraft, type CampaignService } from './campaign.service.js';
import type { ConnectionService } from './connection.service.js';
import type { AutomationPolicyService } from './automation-policy.service.js';
import type { ExposureReservationService } from './exposure-reservation.service.js';
import type { FundingService } from './funding.service.js';

interface Dependencies {
  repo: MetaAdsRepository; commerce: Pick<CommerceContextPort, 'getPlan' | 'products'>;
  campaigns: Pick<CampaignService, 'owned'>; connection: Pick<ConnectionService, 'access'>;
  policies: Pick<AutomationPolicyService, 'view'>; exposure: Pick<ExposureReservationService, 'observe'>;
  budgetControl: MetaBudgetControlPort; funding: Pick<FundingService, 'assertPublishable'>;
  authorizeActor: (merchantId: string, actorId: string) => Promise<void>; enabled: () => boolean; clock?: Clock;
}
function fields(request: ExecutionAuthorityRequest): void {
  const allowed = request?.kind === 'manual' ? ['kind', 'actorId'] : request?.kind === 'automatic' ? ['kind', 'policyId', 'policyVersion', 'policyDigest'] : [];
  if (!allowed.length || Object.keys(request).length !== allowed.length || Object.keys(request).some(key => !allowed.includes(key))) throw new MetaAdsError('execution_authority_invalid');
}
export class ExecutionAuthorityService implements ExecutionAuthorityPort {
  private readonly clock: Clock;
  constructor(private readonly deps: Dependencies) { this.clock = deps.clock ?? (() => new Date()); }
  private target(campaign: MetaAdsCampaign, proposal: StoredProposal, policy: MetaAdsAutomationPolicy): MetaAdsBudget | null {
    if (!policy.scope.actions.includes(proposal.kind as never) || campaign.draft.destination !== policy.scope.destination || campaign.draft.priority !== policy.scope.priority || campaign.draft.country !== policy.scope.country || campaign.draft.variantIds.some(id => !policy.scope.variantIds.includes(id))) throw new MetaAdsError('authorization_limit_exceeded', 409);
    if (proposal.kind === 'pause') return null;
    const target = normalizeCampaignDraft({ ...campaign.draft, budget: proposal.kind === 'budget' ? proposal.after.budget as MetaAdsBudget : campaign.draft.budget }).budget;
    if (!target || target.cadence !== policy.limits.cadence || target.amountCents > policy.limits.campaignCeilingCents || !target.endsAt || Date.parse(target.startsAt) < Date.parse(policy.limits.startsAt) || Date.parse(target.endsAt) > Date.parse(policy.limits.endsAt)) throw new MetaAdsError('authorization_limit_exceeded', 409);
    return target;
  }
  private async products(merchantId: string, campaign: MetaAdsCampaign, proposal: StoredProposal): Promise<void> {
    const products = await this.deps.commerce.products(merchantId, { variantIds: campaign.draft.variantIds });
    const versions = Object.fromEntries(products.map(product => [product.variantId, approvalProductVersion(product)]));
    if (stableDigest(versions) !== stableDigest(proposal.productVersions) || proposal.kind !== 'pause' && (products.length !== campaign.draft.variantIds.length || products.some(p => !p.active || p.stockQuantity === 0))) throw new MetaAdsError('proposal_stale', 409);
  }
  async resolve(merchantId: string, proposalId: string, request: ExecutionAuthorityRequest): Promise<ResolvedExecutionAuthority> {
    requireIdentifier(merchantId); requireIdentifier(proposalId); fields(request);
    if (request.kind === 'manual') { requireIdentifier(request.actorId); await this.deps.authorizeActor(merchantId, request.actorId); }
    else if (!this.deps.enabled()) throw new MetaAdsError('automatic_authority_unavailable', 409);
    const state = await this.deps.repo.read(merchantId); requireEntitlement(await this.deps.commerce.getPlan(merchantId), state, this.clock());
    const proposal = Object.hasOwn(state.proposals, proposalId) ? state.proposals[proposalId] : null;
    if (!proposal) throw new MetaAdsError('approval_required', 403);
    assertReviewedProposal(merchantId, proposal, await this.deps.repo.getRecord(merchantId, `proposal-version:${proposalId}`));
    if (proposal.connectionEpoch !== state.connection.epoch || ['stale', 'rejected'].includes(proposal.status)) throw new MetaAdsError('proposal_stale', 409);
    let policy: MetaAdsAutomationPolicy | null = null;
    if (request.kind === 'manual') {
      const approval = (await this.deps.repo.getRecord<Record<string, unknown>>(merchantId, `proposal-approval:${proposalId}`))?.payload;
      if (!approval || !proposal.approvedBy || !proposal.approvedAt || !['approved', 'executed'].includes(proposal.status) || approval.actorId !== proposal.approvedBy || approval.digest !== proposal.digest || approval.campaignId !== proposal.campaignId || approval.kind !== proposal.kind || approval.connectionEpoch !== proposal.connectionEpoch || approval.approvedAt !== proposal.approvedAt) throw new MetaAdsError('approval_required', 403);
      if (proposal.approvedBy !== request.actorId) await this.deps.authorizeActor(merchantId, proposal.approvedBy);
    } else {
      const view = await this.deps.policies.view(merchantId); policy = view.policy;
      if (view.mode !== 'automatic' || !policy || policy.id !== request.policyId || policy.version !== request.policyVersion || policy.digest !== request.policyDigest) throw new MetaAdsError('automatic_authority_unavailable', 409);
      await this.deps.authorizeActor(merchantId, policy.acceptedBy);
      if (proposal.status !== 'pending_review' || proposal.approvedBy !== null || proposal.approvedAt !== null) throw new MetaAdsError('proposal_stale', 409);
    }
    const campaign = await this.deps.campaigns.owned(merchantId, proposal.campaignId);
    if (proposal.kind === 'prepare' && stableDigest(proposal.after.draft) !== stableDigest(campaign.draft)) throw new MetaAdsError('proposal_stale', 409);
    if (proposal.kind === 'prepare' && campaign.remoteCampaignId && !proposal.executionId) throw new MetaAdsError('campaign_already_prepared', 409);
    await this.products(merchantId, campaign, proposal);
    const operation = proposal.kind === 'prepare' ? 'prepare' : proposal.kind === 'publish' ? 'publish' : 'optimize';
    const access = await this.deps.connection.access(merchantId, { destination: campaign.draft.destination, operation });
    if (campaign.remoteCampaignId && campaign.remoteAccountId !== access.accountId) throw new MetaAdsError('meta_asset_forbidden', 403);
    if (proposal.kind === 'publish') await this.deps.funding.assertPublishable(merchantId);
    if (policy) {
      const binding = (await this.deps.repo.getRecord<{ policyId: string; policyVersion: number; campaignId: string }>(merchantId, `automatic-policy-campaign:${policy.id}:${campaign.id}`))?.payload;
      if (!policy.scope.campaignIds.includes(campaign.id) && !(policy.scope.allowNewCampaigns && binding?.policyId === policy.id && binding.policyVersion === policy.version && binding.campaignId === campaign.id)) throw new MetaAdsError('authorization_limit_exceeded', 409);
      const target = this.target(campaign, proposal, policy);
      if (target) {
        if (proposal.kind !== 'prepare') {
          const proof = await this.deps.budgetControl.prove(access, campaign, target, policy.limits, proposal.kind !== 'budget');
          await this.deps.exposure.observe(merchantId, proof);
        }
        const snapshot = await this.deps.repo.read(merchantId);
        if (hasUnreservedFinancialExecution(snapshot, campaign.id)) throw new MetaAdsError('automatic_budget_control_unavailable', 409);
        for (const other of Object.values(snapshot.campaigns)) if (other.id !== campaign.id && other.createdByAgent && other.managed && other.remoteCampaignId) {
          await this.deps.exposure.observe(merchantId, await this.deps.budgetControl.read(access, other));
        }
        const current = await this.deps.repo.read(merchantId);
        if (hasUnreservedFinancialExecution(current, campaign.id)) throw new MetaAdsError('automatic_budget_control_unavailable', 409);
        const allocations = Object.fromEntries(Object.entries(current.exposure?.allocations ?? {}).filter(([, a]) => a.campaignId === campaign.id));
        const pending = Object.fromEntries(Object.entries(current.exposure?.pending ?? {}).filter(([, op]) => op.campaignId === campaign.id));
        const own = totalMetaExposure({ allocations, pending }), total = totalMetaExposure(current.exposure);
        if (BigInt(total) + BigInt(Math.max(0, target.amountCents - own)) > BigInt(policy.limits.storeCeilingCents) && !(proposal.kind === 'budget' && target.amountCents < own)) throw new MetaAdsError('authorization_limit_exceeded', 409);
      }
    }
    const base = { proposalId, proposalDigest: proposal.digest, campaignId: campaign.id, campaignDigest: stableDigest({ draft: campaign.draft, products: campaign.products }), connectionEpoch: access.connectionEpoch };
    return request.kind === 'manual' ? { ...base, kind: 'manual', actorId: request.actorId, approvedBy: proposal.approvedBy!, approvedAt: proposal.approvedAt! }
      : { ...base, kind: 'automatic', actorId: 'service:meta-ads-agent', policyId: policy!.id, policyVersion: policy!.version, policyDigest: policy!.digest };
  }
  async assertCurrent(merchantId: string, proposalId: string, authority: ResolvedExecutionAuthority): Promise<void> {
    const request: ExecutionAuthorityRequest = authority.kind === 'manual' ? { kind: 'manual', actorId: authority.actorId } : { kind: 'automatic', policyId: authority.policyId, policyVersion: authority.policyVersion, policyDigest: authority.policyDigest };
    const current = await this.resolve(merchantId, proposalId, request);
    if (stableDigest(current) !== stableDigest(authority)) throw new MetaAdsError('proposal_stale', 409);
  }
}
