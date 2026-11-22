import type {MetaAdsCampaign, MetaAdsCampaignLifecycleInput} from '@zyon/shared-types';
import {MetaAdsError, type CampaignLifecycleRepository, type Clock, type CommerceContextPort, type MetaAdsProviderPort, type MetaAdsStoreState} from '../domain/types.js';
import {requireEntitlement, requireIdentifier, stableDigest} from '../domain/offer.js';
import type {ConnectionService} from './connection.service.js';

interface Dependencies {
  repo: CampaignLifecycleRepository;
  commerce: Pick<CommerceContextPort, 'getPlan'>;
  authorizeActor(merchantId: string, actorId: string): Promise<void>;
  connection: Pick<ConnectionService, 'access'>;
  provider: Pick<MetaAdsProviderPort, 'snapshot'>;
  clock?: Clock;
}
interface Receipt {digest: string; campaignId: string; version: number}

/** Retains financial history; never deletes or changes a provider object. */
export class CampaignLifecycleService {
  private readonly clock: Clock;
  constructor(private readonly deps: Dependencies) {this.clock = deps.clock ?? (() => new Date());}
  deleteDraft(merchantId: string, actorId: string, campaignId: string, input: MetaAdsCampaignLifecycleInput) {
    return this.change('deleted_draft', merchantId, actorId, campaignId, input);
  }
  archive(merchantId: string, actorId: string, campaignId: string, input: MetaAdsCampaignLifecycleInput) {
    return this.change('archived', merchantId, actorId, campaignId, input);
  }
  private owned(state: MetaAdsStoreState, id: string, origin: unknown): MetaAdsCampaign {
    const campaign = Object.hasOwn(state.campaigns, id) ? state.campaigns[id] : null;
    const proof = origin as {source?: string; campaignId?: string} | undefined;
    if (!campaign?.createdByAgent || !campaign.managed || proof?.source !== 'agent' || proof.campaignId !== id) throw new MetaAdsError('campaign_read_only', 403);
    return campaign;
  }
  private async change(action: 'deleted_draft' | 'archived', merchantId: string, actorId: string, campaignId: string, input: MetaAdsCampaignLifecycleInput): Promise<MetaAdsCampaign> {
    for (const value of [merchantId, actorId, campaignId]) requireIdentifier(value);
    await this.deps.authorizeActor(merchantId, actorId);
    if (!input || Object.keys(input).some(key => !['expectedVersion','idempotencyKey'].includes(key)) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new MetaAdsError('campaign_lifecycle_invalid');
    requireIdentifier(input.idempotencyKey);
    const digest = stableDigest({action, campaignId, actorId, expectedVersion: input.expectedVersion});
    const key = `campaign-lifecycle:${input.idempotencyKey}`;
    const receipt = await this.deps.repo.getRecord<Receipt>(merchantId, key);
    if (receipt) {
      if (receipt.payload.digest !== digest) throw new MetaAdsError('campaign_request_conflict', 409);
      return (await this.deps.repo.read(merchantId)).campaigns[campaignId];
    }
    const plan = await this.deps.commerce.getPlan(merchantId);
    const before = this.owned(await this.deps.repo.read(merchantId), campaignId, (await this.deps.repo.getRecord(merchantId, `campaign-origin:${campaignId}`))?.payload);
    const remoteIdentity = stableDigest({account: before.remoteAccountId, campaign: before.remoteCampaignId, adSet: before.remoteAdSetId, ads: before.remoteAdIds});
    if (action === 'archived') {
      if (!before.remoteCampaignId) throw new MetaAdsError('campaign_has_no_remote_objects', 409);
      const access = await this.deps.connection.access(merchantId);
      if (access.merchantId !== merchantId || access.accountId !== before.remoteAccountId) throw new MetaAdsError('meta_asset_forbidden', 403);
      const remote = await this.deps.provider.snapshot(access, before);
      if (remote.campaignId !== before.remoteCampaignId) throw new MetaAdsError('campaign_remote_state_unavailable', 409);
      const end = remote.schedule?.endsAt ? Date.parse(remote.schedule.endsAt) : NaN;
      const ended = Number.isFinite(end) && end <= this.clock().getTime();
      if (!ended && !['PAUSED','CAMPAIGN_PAUSED'].includes(remote.effectiveStatus)) {
        throw new MetaAdsError(remote.effectiveStatus === 'ACTIVE' ? 'campaign_pause_required' : 'campaign_remote_state_unavailable', 409);
      }
    }
    return this.deps.repo.mutateCampaignLifecycle(merchantId, campaignId, [key, `campaign-origin:${campaignId}`], (state, records, preparations) => {
      const existing = records.get(key)?.payload as Receipt | undefined;
      if (existing) {
        if (existing.digest !== digest) throw new MetaAdsError('campaign_request_conflict', 409);
        return {result: state.campaigns[campaignId]};
      }
      requireEntitlement(plan, state, this.clock());
      const campaign = this.owned(state, campaignId, records.get(`campaign-origin:${campaignId}`)?.payload);
      const version = campaign.lifecycle?.version ?? 0;
      if (version !== input.expectedVersion) throw new MetaAdsError('campaign_version_conflict', 409);
      if (preparations.some(job => ['preparing','creative_pending','unknown'].includes(job.status)) ||
        Object.values(state.generations).some(job => job.campaignId === campaignId && ['reserved','running','unknown'].includes(job.status)) ||
        Object.values(state.executions).some(job => job.campaignId === campaignId && (['reserved','sending','publishing','execution_unknown'].includes(job.status)||job.status==='active_unconfirmed'&&(action==='deleted_draft'||!!job.error))) ||
        Object.values(state.proposals).some(proposal => proposal.campaignId === campaignId && proposal.status === 'approved')) throw new MetaAdsError('campaign_operation_pending', 409);
      if (action === 'deleted_draft' && (campaign.remoteCampaignId || campaign.remoteAdSetId || campaign.remoteAdIds.length || Object.values(state.executions).some(execution => execution.campaignId === campaignId && execution.objects.length))) throw new MetaAdsError('campaign_has_remote_objects', 409);
      if (action === 'archived' && remoteIdentity !== stableDigest({account: campaign.remoteAccountId, campaign: campaign.remoteCampaignId, adSet: campaign.remoteAdSetId, ads: campaign.remoteAdIds})) throw new MetaAdsError('campaign_version_conflict', 409);
      const now = this.clock().toISOString();
      campaign.lifecycle = {state: action, version: version + 1, changedAt: now};
      campaign.managed = false; campaign.updatedAt = now;
      for (const proposal of Object.values(state.proposals)) if (proposal.campaignId === campaignId && proposal.status === 'pending_review') proposal.status = 'stale';
      for (const admission of Object.values(state.preparationAdmissions ?? {})) if (admission.campaignId === campaignId) {admission.state = 'closed'; admission.updatedAt = now;}
      return {result: campaign, invalidatePreparations: true, records: [{key, kind: 'audit', payload: {digest, action, actorId, campaignId, version: version + 1}, createdAt: now}]};
    });
  }
}
