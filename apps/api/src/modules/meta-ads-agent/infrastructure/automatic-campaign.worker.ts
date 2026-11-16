import type { MetaAdsAutomationPolicy, MetaAdsCampaign, MetaAdsCampaignDraft } from '@zyon/shared-types';
import { MetaAdsError, type MetaAdsRepository, type Clock } from '../domain/types.js';
import { requireIdentifier, stableDigest } from '../domain/offer.js';
import { assessData } from '../domain/analytics.js';
import { normalizeCampaignDraft, type CampaignService } from '../application/campaign.service.js';
import type { AutomationPolicyService } from '../application/automation-policy.service.js';
import type { GenerationService } from '../application/generation.service.js';
import type { ProposalService } from '../application/proposal.service.js';
import type { ExecutionService } from '../application/execution.service.js';
import { recommendationEvidence, validSuggestion } from './recommendation.adapter.js';

interface Dependencies {
  repo: MetaAdsRepository; policies: Pick<AutomationPolicyService, 'view'>;
  campaigns: Pick<CampaignService, 'create' | 'save' | 'owned'>; generations: Pick<GenerationService, 'request'>;
  proposals: Pick<ProposalService, 'create'>; executions: Pick<ExecutionService, 'executeAutomatic'>;
  enabled: () => boolean; clock?: Clock;
  authorizeActor?: (merchantId: string, actorId: string) => Promise<void>;
}
export interface AutomaticOutcome { proposalId: string; executionId: string | null; status: string; reason: string; error: string | null; }
const grant = (policy: MetaAdsAutomationPolicy) => ({ kind: 'automatic' as const, policyId: policy.id, policyVersion: policy.version, policyDigest: policy.digest });
export class AutomaticCampaignWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private stopping = false;
  private readonly clock: Clock;
  constructor(private readonly deps: Dependencies) { this.clock = deps.clock ?? (() => new Date()); }
  onModuleInit(): void { if (this.deps.enabled()) { this.timer = setInterval(() => { void this.drain(); }, 3000); this.timer.unref(); void this.drain(); } }
  async onModuleDestroy(): Promise<void> { this.stopping = true; clearInterval(this.timer); await this.active; }
  drain(): Promise<void> { if (this.stopping || !this.deps.enabled()) return Promise.resolve(); return this.active ??= this.run().catch(() => undefined).finally(() => { this.active = undefined; }); }
  private async current(merchantId: string): Promise<MetaAdsAutomationPolicy | null> {
    if (!this.deps.enabled()) return null; const view = await this.deps.policies.view(merchantId);
    if (view.mode !== 'automatic' || !view.policy) return null;
    await this.deps.authorizeActor?.(merchantId, view.policy.acceptedBy); return view.policy;
  }
  private draft(policy: MetaAdsAutomationPolicy, value: MetaAdsCampaignDraft): MetaAdsCampaignDraft {
    const draft = normalizeCampaignDraft(value), budget = draft.budget;
    if (!policy.scope.allowNewCampaigns || !policy.scope.actions.includes('prepare') || draft.destination !== policy.scope.destination || draft.priority !== policy.scope.priority || draft.country !== policy.scope.country || draft.variantIds.some(id => !policy.scope.variantIds.includes(id)) ||
      !budget || budget.cadence !== policy.limits.cadence || budget.currency !== policy.limits.currency || budget.amountCents > policy.limits.campaignCeilingCents || !budget.endsAt || Date.parse(budget.startsAt) < Date.parse(policy.limits.startsAt) || Date.parse(budget.endsAt) > Date.parse(policy.limits.endsAt)) throw new MetaAdsError('authorization_limit_exceeded', 409);
    return draft;
  }
  async createCampaign(merchantId: string, input: { draft: MetaAdsCampaignDraft; imageCount: number; idempotencyKey: string }): Promise<MetaAdsCampaign> {
    requireIdentifier(input.idempotencyKey);
    if (!Number.isSafeInteger(input.imageCount) || input.imageCount < 1 || input.imageCount > 10) throw new MetaAdsError('image_count_invalid');
    const policy = await this.current(merchantId); if (!policy) throw new MetaAdsError('automatic_authority_unavailable', 409);
    const draft = this.draft(policy, input.draft), key = stableDigest({ merchantId, key: input.idempotencyKey });
    const campaign = await this.deps.campaigns.create(merchantId, draft, `auto-new-${key}`);
    await this.bindCampaign(merchantId, campaign.id, policy.id);
    const latest = await this.current(merchantId); if (latest?.id !== policy.id || latest.version !== policy.version) throw new MetaAdsError('automatic_authority_unavailable', 409);
    if (!campaign.draft.mediaIds.length) await this.deps.generations.request(merchantId, campaign.id, { imageCount: input.imageCount, idempotencyKey: `auto-image-${key}` });
    return campaign;
  }
  async bindCampaign(merchantId: string, campaignId: string, expectedPolicyId?: string): Promise<void> {
    const policy = await this.current(merchantId); if (!policy || expectedPolicyId && expectedPolicyId !== policy.id) throw new MetaAdsError('automatic_authority_unavailable', 409);
    const campaign = await this.deps.campaigns.owned(merchantId, campaignId); this.draft(policy, campaign.draft);
    await this.deps.repo.mutate(merchantId, [`automatic-policy-campaign:${policy.id}:${campaign.id}`, `campaign-origin:${campaign.id}`], (state, records) => {
      if (state.automation?.activePolicyId !== policy.id || state.automation.version !== policy.version || state.connection.epoch !== policy.connectionEpoch || Date.parse(policy.limits.endsAt) <= this.clock().getTime()) throw new MetaAdsError('automatic_authority_unavailable', 409);
      const origin = records.get(`campaign-origin:${campaign.id}`)?.payload as { source?: string; campaignId?: string } | undefined;
      if (origin?.source !== 'agent' || origin.campaignId !== campaign.id) throw new MetaAdsError('campaign_read_only', 403);
      const receipt = { key: `automatic-policy-campaign:${policy.id}:${campaign.id}`, kind: 'audit' as const, payload: { policyId: policy.id, policyVersion: policy.version, campaignId: campaign.id }, createdAt: this.clock().toISOString() };
      return { result: null, records: records.has(receipt.key) ? [] : [receipt] };
    });
  }
  async processProposal(merchantId: string, proposalId: string): Promise<AutomaticOutcome> {
    requireIdentifier(proposalId); const state = await this.deps.repo.read(merchantId), proposal = state.proposals[proposalId];
    if (!proposal) throw new MetaAdsError('proposal_not_found', 404);
    const policy = await this.current(merchantId);
    if (!policy || proposal.approvedBy || !['pending_review', 'executed'].includes(proposal.status)) return { proposalId, executionId: proposal.executionId, status: proposal.status, reason: proposal.reasoning, error: null };
    const execution = await this.deps.executions.executeAutomatic(merchantId, proposalId, grant(policy));
    return { proposalId, executionId: execution.id, status: execution.status, reason: proposal.reasoning, error: execution.error };
  }
  async recommendation(merchantId: string, recommendationId: string): Promise<AutomaticOutcome> {
    requireIdentifier(recommendationId); const state = await this.deps.repo.read(merchantId), recommendation = state.recommendations[recommendationId];
    const campaign = recommendation && state.campaigns[recommendation.campaignId], metrics = campaign && state.metrics[campaign.id];
    if (!campaign || !recommendation || !metrics || !recommendation.proposedAction || assessData(campaign.draft.priority, metrics).status !== 'available' || !validSuggestion(recommendation, campaign) || stableDigest(recommendation.evidence) !== stableDigest(recommendationEvidence(metrics)) || this.clock().getTime() - Date.parse(metrics.updatedAt) > 86400000) throw new MetaAdsError('recommendation_data_insufficient', 409);
    if (recommendation.proposedAction === 'creative') {
      const policy = await this.current(merchantId);
      const outcome = (status: string, error: string | null = null): AutomaticOutcome => ({ proposalId: '', executionId: null, status, reason: recommendation.hypothesis, error });
      if (!policy || !policy.scope.actions.includes('creative')) return outcome('creative_review_required');
      const binding = (await this.deps.repo.getRecord<{ policyVersion: number }>(merchantId, `automatic-policy-campaign:${policy.id}:${campaign.id}`))?.payload;
      if (!policy.scope.campaignIds.includes(campaign.id) && !(policy.scope.allowNewCampaigns && binding?.policyVersion === policy.version) || campaign.draft.destination !== policy.scope.destination || campaign.draft.priority !== policy.scope.priority || campaign.draft.country !== policy.scope.country || campaign.draft.variantIds.some(id => !policy.scope.variantIds.includes(id))) throw new MetaAdsError('authorization_limit_exceeded', 409);
      const budget = campaign.draft.budget;
      if (!budget || budget.cadence !== policy.limits.cadence || budget.amountCents > policy.limits.campaignCeilingCents || !budget.endsAt || Date.parse(budget.startsAt) < Date.parse(policy.limits.startsAt) || Date.parse(budget.endsAt) > Date.parse(policy.limits.endsAt)) throw new MetaAdsError('authorization_limit_exceeded', 409);
      const job = await this.deps.generations.request(merchantId, campaign.id, { imageCount: 1, idempotencyKey: `auto-creative-${stableDigest(recommendationId)}` });
      if (['reserved', 'running'].includes(job.status)) return outcome('generation_pending');
      if (job.status === 'unknown') return outcome('execution_unknown', 'image_provider_outcome_unknown');
      if (job.status !== 'succeeded') return outcome('blocked', job.error ?? 'image_generation_incomplete');
      const latest = await this.current(merchantId); if (latest?.id !== policy.id || latest.version !== policy.version) throw new MetaAdsError('automatic_authority_unavailable', 409);
      if (stableDigest(campaign.draft.mediaIds) !== stableDigest(job.mediaIds)) await this.deps.campaigns.save(merchantId, campaign.id, { ...campaign.draft, mediaIds: job.mediaIds });
    }
    const proposal = await this.deps.proposals.create(merchantId, campaign.id, { kind: recommendation.proposedAction, after: recommendation.proposedFields, reasoning: recommendation.hypothesis, idempotencyKey: `auto-rec-${stableDigest(recommendationId)}` });
    return this.processProposal(merchantId, proposal.id);
  }
  private async run(): Promise<void> {
    let after: string | undefined;
    while (!this.stopping && this.deps.enabled()) {
      const stores = await this.deps.repo.listStoreIds(100, after); if (!stores.length) return;
      for (const merchantId of stores) {
        try {
          const policy = await this.current(merchantId); if (!policy) continue;
          const state = await this.deps.repo.read(merchantId);
          for (const campaign of Object.values(state.campaigns)) {
            const binding = (await this.deps.repo.getRecord<{ policyVersion: number }>(merchantId, `automatic-policy-campaign:${policy.id}:${campaign.id}`))?.payload;
            if (!binding || binding.policyVersion !== policy.version || !campaign.managed) continue;
            const flowKey = stableDigest({ policyId: policy.id, campaignId: campaign.id });
            if (campaign.remoteCampaignId && !await this.deps.repo.getRecord(merchantId, `proposal-request:auto-prepare-${flowKey}`)) continue;
            const generation = Object.values(state.generations).find(g => g.campaignId === campaign.id && g.status === 'succeeded');
            if (!campaign.draft.mediaIds.length && !generation && !Object.values(state.generations).some(g => g.campaignId === campaign.id)) {
              await this.deps.generations.request(merchantId, campaign.id, { imageCount: 1, idempotencyKey: `auto-initial-${flowKey}` }); continue;
            }
            if (!campaign.draft.mediaIds.length && generation) await this.deps.campaigns.save(merchantId, campaign.id, { ...campaign.draft, mediaIds: generation.mediaIds });
            const ready = await this.deps.campaigns.owned(merchantId, campaign.id); if (!ready.draft.mediaIds.length) continue;
            const p = await this.deps.proposals.create(merchantId, campaign.id, { kind: 'prepare', after: {}, reasoning: 'Preparação da campanha dentro da política aceita', idempotencyKey: `auto-prepare-${flowKey}` });
            const outcome = await this.processProposal(merchantId, p.id);
            if (outcome.status === 'remote_paused' && !outcome.error && policy.scope.actions.includes('publish')) {
              const current = await this.current(merchantId); if (current?.id !== policy.id || current.version !== policy.version) continue;
              const publication = await this.deps.proposals.create(merchantId, campaign.id, { kind: 'publish', after: {}, reasoning: 'Publicação inicial dentro da política aceita', idempotencyKey: `auto-publish-${flowKey}` });
              await this.processProposal(merchantId, publication.id);
            }
          }
          for (const proposal of Object.values((await this.deps.repo.read(merchantId)).proposals)) if (proposal.status === 'pending_review' && !proposal.executionId) {
            try { await this.processProposal(merchantId, proposal.id); } catch { /* Invalid intent remains reviewable; no policy escalation. */ }
          }
        } catch { /* A tenant failure cannot authorize another tenant or replay a write. */ }
      }
      if (stores.length < 100) return; after = stores.at(-1);
    }
  }
}
