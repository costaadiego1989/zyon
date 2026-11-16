import type { MetaAdsAutomationPolicy, MetaAdsBudget } from '@zyon/shared-types';
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaAdsStoreState, type MetaAdsRecord, type Clock } from '../domain/types.js';
import { hasUnreservedFinancialExecution, totalMetaExposure, type ExposureReservation, type MetaBudgetEvidence } from '../domain/exposure.js';
import { automationReviewDigest, isAutomationPolicyCurrent } from '../domain/automation-policy.js';
import { requireEntitlement, requireIdentifier, stableDigest } from '../domain/offer.js';
import { normalizeCampaignDraft } from './campaign.service.js';

interface Dependencies { repo: MetaAdsRepository; commerce: Pick<CommerceContextPort, 'getPlan'>; enabled: () => boolean; clock?: Clock; }
export interface ExposureReservationInput {
  operationId: string; campaignId: string; policyId: string; policyVersion: number; policyDigest: string;
  action: ExposureReservation['action']; targetBudget: MetaAdsBudget;
}
interface RequestReceipt { hash: string; reservation: ExposureReservation; }
const own = <T>(values: Record<string, T>, key: string): T | undefined => Object.hasOwn(values, key) ? values[key] : undefined;
const ledger = (state: MetaAdsStoreState) => state.exposure ??= { allocations: {}, pending: {} };
const requestKey = (id: string) => `exposure-reservation:${id}`;
const resultKey = (id: string) => `exposure-result:${id}`;
const keys = (value: Pick<ExposureReservation, 'policyId' | 'campaignId'>) => [`automatic-policy:${value.policyId}`, `automatic-policy-revoked:${value.policyId}`, `campaign-origin:${value.campaignId}`, `automatic-policy-campaign:${value.policyId}:${value.campaignId}`];
export class ExposureReservationService {
  private readonly clock: Clock;
  constructor(private readonly deps: Dependencies) { this.clock = deps.clock ?? (() => new Date()); }
  private policy(state: MetaAdsStoreState, value: Pick<ExposureReservation, 'policyId' | 'policyVersion' | 'policyDigest'>, records: ReadonlyMap<string, MetaAdsRecord>): MetaAdsAutomationPolicy {
    const receipt = records.get(`automatic-policy:${value.policyId}`)?.payload as { merchantId: string; policy: MetaAdsAutomationPolicy } | undefined;
    const policy = receipt?.policy;
    if (!this.deps.enabled() || !policy || receipt?.merchantId !== state.merchantId || state.automation?.activePolicyId !== value.policyId || state.automation?.version !== value.policyVersion || policy.version !== value.policyVersion || policy.digest !== value.policyDigest || records.has(`automatic-policy-revoked:${value.policyId}`) ||
      !state.connection.encryptedAccessToken || !['connected', 'limited'].includes(state.connection.status) || state.connection.expiresAt && Date.parse(state.connection.expiresAt) <= this.clock().getTime() || !isAutomationPolicyCurrent(policy, state.connection.account?.id ?? '', state.connection.epoch, this.clock())) throw new MetaAdsError('automatic_authority_unavailable', 409);
    if (policy.digest !== automationReviewDigest({ merchantId: state.merchantId, accountId: policy.accountId, connectionEpoch: policy.connectionEpoch, version: policy.version }, { scope: policy.scope, limits: policy.limits })) throw new MetaAdsError('automatic_authority_unavailable', 409);
    return policy;
  }
  private campaign(state: MetaAdsStoreState, id: string, records: ReadonlyMap<string, MetaAdsRecord>, allowStopped = false) {
    const campaign = own(state.campaigns, id); const origin = records.get(`campaign-origin:${id}`)?.payload as { source?: string; campaignId?: string } | undefined;
    if (!campaign || !campaign.managed && !allowStopped || !campaign.createdByAgent || origin?.source !== 'agent' || origin.campaignId !== id) throw new MetaAdsError('campaign_read_only', 403);
    return campaign;
  }
  private proof(state: MetaAdsStoreState, proof: MetaBudgetEvidence, records: ReadonlyMap<string, MetaAdsRecord>): void {
    const campaign = this.campaign(state, proof.campaignId, records, true); const at = Date.parse(proof.checkedAt);
    if (proof.accountId !== state.connection.account?.id || proof.connectionEpoch !== state.connection.epoch || campaign.remoteAccountId !== proof.accountId || campaign.remoteCampaignId !== proof.remoteCampaignId || proof.currency !== 'BRL' || !['daily', 'lifetime'].includes(proof.cadence) || !Number.isSafeInteger(proof.amountCents) || proof.amountCents < 0 || !Number.isFinite(at) || at > this.clock().getTime() + 30000 || this.clock().getTime() - at > 300000) throw new MetaAdsError('exposure_confirmation_mismatch', 409);
  }
  async reserve(merchantId: string, input: ExposureReservationInput): Promise<ExposureReservation> {
    for (const id of [input.operationId, input.campaignId, input.policyId]) requireIdentifier(id);
    const hash = stableDigest(input), plan = await this.deps.commerce.getPlan(merchantId);
    return this.deps.repo.mutate(merchantId, [requestKey(input.operationId), resultKey(input.operationId), ...keys(input)], (state, records) => {
      const existing = records.get(requestKey(input.operationId))?.payload as RequestReceipt | undefined;
      if (existing) {
        if (existing.hash !== hash) throw new MetaAdsError('exposure_request_conflict', 409);
        const result = records.get(resultKey(input.operationId))?.payload as ExposureReservation | undefined;
        const pending = own(ledger(state).pending, input.operationId);
        if (!result && !pending) throw new MetaAdsError('exposure_reconciliation_required', 409);
        return { result: result ?? pending! };
      }
      requireEntitlement(plan, state, this.clock()); const policy = this.policy(state, input, records); const campaign = this.campaign(state, input.campaignId, records);
      if (hasUnreservedFinancialExecution(state, campaign.id)) throw new MetaAdsError('automatic_budget_control_unavailable', 409);
      const binding = records.get(`automatic-policy-campaign:${policy.id}:${campaign.id}`)?.payload as { policyId?: string; policyVersion?: number; campaignId?: string } | undefined;
      if (!policy.scope.campaignIds.includes(campaign.id) && !(policy.scope.allowNewCampaigns && binding?.policyId === policy.id && binding.policyVersion === policy.version && binding.campaignId === campaign.id) || !policy.scope.actions.includes(input.action) || campaign.draft.destination !== policy.scope.destination || campaign.draft.priority !== policy.scope.priority || campaign.draft.country !== policy.scope.country || campaign.draft.variantIds.some(id => !policy.scope.variantIds.includes(id))) throw new MetaAdsError('authorization_limit_exceeded', 409);
      const budget = normalizeCampaignDraft({ ...campaign.draft, budget: input.targetBudget }).budget;
      if (!budget || budget.currency !== 'BRL' || budget.cadence !== policy.limits.cadence || budget.amountCents > policy.limits.campaignCeilingCents || Date.parse(budget.startsAt) < Date.parse(policy.limits.startsAt) || !budget.endsAt || Date.parse(budget.endsAt) > Date.parse(policy.limits.endsAt)) throw new MetaAdsError('authorization_limit_exceeded', 409);
      const exposure = ledger(state); const pending = Object.values(exposure.pending);
      if (pending.some(op => op.campaignId === campaign.id)) throw new MetaAdsError('exposure_operation_pending', 409);
      const allocation = own(exposure.allocations, campaign.id);
      if (campaign.remoteCampaignId && !allocation) throw new MetaAdsError('automatic_budget_control_unavailable', 409);
      if (Object.values(state.campaigns).some(c => c.managed && c.createdByAgent && c.remoteCampaignId && !own(exposure.allocations, c.id) && !pending.some(op => op.campaignId === c.id)) || Object.values(exposure.allocations).some(a => a.cadence !== budget.cadence) || pending.some(op => op.targetBudget.cadence !== budget.cadence)) throw new MetaAdsError('automatic_budget_control_unavailable', 409);
      const at = this.clock().toISOString(); const reservation: ExposureReservation = { ...structuredClone(input), targetBudget: budget, beforeCents: allocation?.amountCents ?? 0, status: 'reserved', createdAt: at, updatedAt: at };
      exposure.pending[input.operationId] = reservation;
      if (totalMetaExposure(exposure) > policy.limits.storeCeilingCents && !(input.action === 'budget' && budget.amountCents < reservation.beforeCents)) throw new MetaAdsError('authorization_limit_exceeded', 409);
      return { result: reservation, records: [{ key: requestKey(input.operationId), kind: 'audit', payload: { hash, reservation }, createdAt: at }] };
    });
  }
  async read(merchantId: string, operationId: string): Promise<ExposureReservation> {
    requireIdentifier(operationId); const state = await this.deps.repo.read(merchantId);
    const value = own(ledger(state).pending, operationId) ?? (await this.deps.repo.getRecord<ExposureReservation>(merchantId, resultKey(operationId)))?.payload;
    if (!value) throw new MetaAdsError('exposure_reservation_not_found', 404); return value;
  }
  async dispatched(merchantId: string, operationId: string): Promise<ExposureReservation> {
    const previous = await this.read(merchantId, operationId); const plan = await this.deps.commerce.getPlan(merchantId);
    return this.deps.repo.mutate(merchantId, keys(previous), (state, records) => {
      const pending = own(ledger(state).pending, operationId);
      if (!pending || !['reserved', 'sending'].includes(pending.status)) throw new MetaAdsError('exposure_reconciliation_required', 409);
      requireEntitlement(plan, state, this.clock()); const policy = this.policy(state, pending, records); this.campaign(state, pending.campaignId, records);
      if (hasUnreservedFinancialExecution(state, pending.campaignId)) throw new MetaAdsError('automatic_budget_control_unavailable', 409);
      if (totalMetaExposure(state.exposure) > policy.limits.storeCeilingCents && !(pending.action === 'budget' && pending.targetBudget.amountCents < pending.beforeCents)) throw new MetaAdsError('authorization_limit_exceeded', 409);
      pending.status = 'sending'; pending.updatedAt = this.clock().toISOString(); return { result: pending };
    });
  }
  async unknown(merchantId: string, operationId: string): Promise<ExposureReservation> {
    requireIdentifier(operationId);
    return this.deps.repo.mutate(merchantId, [], state => {
      const pending = own(ledger(state).pending, operationId);
      if (!pending || !['sending', 'unknown'].includes(pending.status)) throw new MetaAdsError('exposure_reconciliation_required', 409);
      pending.status = 'unknown'; pending.updatedAt = this.clock().toISOString(); return { result: pending };
    });
  }
  async cancel(merchantId: string, operationId: string): Promise<ExposureReservation> {
    requireIdentifier(operationId);
    return this.deps.repo.mutate(merchantId, [resultKey(operationId)], (state, records) => {
      const result = records.get(resultKey(operationId))?.payload as ExposureReservation | undefined; if (result) return { result };
      const pending = own(ledger(state).pending, operationId);
      if (!pending || pending.status !== 'reserved') throw new MetaAdsError('exposure_reconciliation_required', 409);
      const cancelled: ExposureReservation = { ...pending, status: 'cancelled', updatedAt: this.clock().toISOString() }; delete state.exposure!.pending[operationId];
      return { result: cancelled, records: [{ key: resultKey(operationId), kind: 'audit', payload: cancelled, createdAt: cancelled.updatedAt }] };
    });
  }
  async observe(merchantId: string, proof: MetaBudgetEvidence): Promise<void> {
    requireIdentifier(proof.campaignId);
    await this.deps.repo.mutate(merchantId, [`campaign-origin:${proof.campaignId}`], (state, records) => {
      this.proof(state, proof, records); ledger(state).allocations[proof.campaignId] = structuredClone(proof); return { result: null };
    });
  }
  async confirm(merchantId: string, operationId: string, proof: MetaBudgetEvidence): Promise<ExposureReservation> {
    requireIdentifier(operationId); requireIdentifier(proof.campaignId);
    return this.deps.repo.mutate(merchantId, [resultKey(operationId), `campaign-origin:${proof.campaignId}`], (state, records) => {
      const prior = records.get(resultKey(operationId))?.payload as ExposureReservation | undefined; if (prior) return { result: prior };
      const pending = own(ledger(state).pending, operationId);
      if (!pending || !['sending', 'unknown'].includes(pending.status) || pending.campaignId !== proof.campaignId || pending.targetBudget.amountCents !== proof.amountCents || pending.targetBudget.cadence !== proof.cadence) throw new MetaAdsError('exposure_confirmation_mismatch', 409);
      this.proof(state, proof, records); ledger(state).allocations[proof.campaignId] = structuredClone(proof);
      const confirmed: ExposureReservation = { ...pending, status: 'confirmed', updatedAt: this.clock().toISOString() }; delete state.exposure!.pending[operationId];
      return { result: confirmed, records: [{ key: resultKey(operationId), kind: 'audit', payload: confirmed, createdAt: confirmed.updatedAt }] };
    });
  }
}
