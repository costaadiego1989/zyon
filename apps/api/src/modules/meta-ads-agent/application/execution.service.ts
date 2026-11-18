import { randomUUID } from "node:crypto";
import type { MetaAdsCampaign, MetaAdsExecution, MetaAdsMedia } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaAdsProviderPort, type MetaAdsStoreState, type StoredProposal, type MetaAdsRecord, type MetaAccess, type ProviderExecutionResult, type Clock, type IdFactory } from "../domain/types.js";
import { requireEntitlement, requireIdentifier, stableDigest } from "../domain/offer.js";
import { approvalProductVersion, assertReviewedProposal, remoteFingerprint } from "./proposal.service.js";
import type { CampaignService } from "./campaign.service.js";
import type { ConnectionService } from "./connection.service.js";
import type { ExecutionAuthorityPort, ExecutionAuthorityRequest, ResolvedExecutionAuthority } from '../domain/execution-authority.port.js';
import type { MetaBudgetControlPort } from '../domain/budget-control.port.js';
import type { ExposureReservationService } from './exposure-reservation.service.js';
import type { MetaAdsAutomationPolicy, MetaAdsBudget } from '@zyon/shared-types';

interface ExecutionInput { campaign: MetaAdsCampaign; proposal: StoredProposal; actorId: string; authority?: ResolvedExecutionAuthority; }
interface AuthorityDependencies { authority: ExecutionAuthorityPort; exposure: ExposureReservationService; budgetControl: MetaBudgetControlPort; }
const safeError = (error: unknown) => typeof error === "string" && /^(meta_|campaign_|proposal_|automatic_|authorization_|exposure_|approval_|addon_)[a-z0-9_]{1,80}$/.test(error) ? error : "meta_execution_unknown";
function mergeObjects(...groups: MetaAdsExecution["objects"][]): MetaAdsExecution["objects"] {
  return [...new Map(groups.flat().filter(ref => ["campaign", "ad_set", "creative", "ad"].includes(ref.type) && /^\d+$/.test(ref.id)).map(ref => [`${ref.type}:${ref.id}`, ref])).values()];
}
function completeLaunch(objects: MetaAdsExecution['objects']): boolean {
  return objects.length === 4 && ['campaign', 'ad_set', 'creative', 'ad'].every(type => objects.filter(ref => ref.type === type).length === 1);
}
function bindObjects(campaign: MetaAdsCampaign, objects: MetaAdsExecution["objects"], accountId: string | null): void {
  for (const ref of objects) {
    if (ref.type === "campaign") { campaign.remoteCampaignId = ref.id; campaign.remoteAccountId = accountId; }
    if (ref.type === "ad_set") campaign.remoteAdSetId = ref.id;
    if (ref.type === "ad" && !campaign.remoteAdIds.includes(ref.id)) campaign.remoteAdIds.push(ref.id);
  }
}

export class ExecutionService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan" | "products">,
    private readonly campaigns: Pick<CampaignService, "owned" | "assertReady">, private readonly connection: Pick<ConnectionService, "access">,
    private readonly provider: Pick<MetaAdsProviderPort, "snapshot" | "prepare" | "execute" | "reconcile">, private readonly clock: Clock = () => new Date(), private readonly id: IdFactory = randomUUID,
    private readonly authorityDeps?: AuthorityDependencies) {}

  private approved(merchantId: string, state: MetaAdsStoreState, proposalId: string, records: ReadonlyMap<string, MetaAdsRecord>): StoredProposal {
    const p = Object.hasOwn(state.proposals, proposalId) ? state.proposals[proposalId] : null;
    if (!p) throw new MetaAdsError("approval_required", 403);
    assertReviewedProposal(merchantId, p, records.get(`proposal-version:${p.id}`));
    const receipt = records.get(`proposal-approval:${p.id}`)?.payload as Record<string, unknown> | undefined;
    if (!receipt || !p.approvedBy || receipt.actorId !== p.approvedBy || receipt.digest !== p.digest || receipt.campaignId !== p.campaignId || receipt.kind !== p.kind || receipt.connectionEpoch !== p.connectionEpoch || receipt.approvedAt !== p.approvedAt) throw new MetaAdsError("approval_required", 403);
    return p;
  }
  private async productsUnchanged(merchantId: string, p: StoredProposal, campaign: MetaAdsCampaign): Promise<void> {
    const current = await this.commerce.products(merchantId, { variantIds: campaign.draft.variantIds });
    const versions = Object.fromEntries(current.map(product => [product.variantId, approvalProductVersion(product)]));
    if (stableDigest(versions) !== stableDigest(p.productVersions) || (p.kind !== "pause" && (current.length !== campaign.draft.variantIds.length || current.some(product => !product.active || product.stockQuantity === 0)))) throw new MetaAdsError("proposal_stale", 409);
  }
  private async lease(merchantId: string, executionId: string, input: ExecutionInput, access: MetaAccess): Promise<void> {
    const plan = await this.commerce.getPlan(merchantId); const state = await this.repo.read(merchantId);
    requireEntitlement(plan, state, this.clock());
    if (state.connection.epoch !== access.connectionEpoch || !state.connection.encryptedAccessToken) throw new MetaAdsError("meta_connection_changed", 409);
    const p = state.proposals[input.proposal.id]; const execution = state.executions[executionId]; const campaign = state.campaigns[input.campaign.id];
    const expectedStatus = input.authority?.kind === 'automatic' ? 'pending_review' : 'approved';
    if (!p || p.executionId !== executionId || p.status !== expectedStatus || p.digest !== input.proposal.digest || !["reserved", "sending"].includes(execution?.status) || !campaign?.managed || !campaign.createdByAgent || stableDigest(campaign.draft) !== stableDigest(input.campaign.draft)) throw new MetaAdsError("proposal_stale", 409);
    assertReviewedProposal(merchantId, p, await this.repo.getRecord(merchantId, `proposal-version:${p.id}`));
    if (campaign.remoteCampaignId && campaign.remoteAccountId !== access.accountId) throw new MetaAdsError("meta_asset_forbidden", 403);
    await this.productsUnchanged(merchantId, p, campaign);
    if (input.authority) await this.authorityDeps!.authority.assertCurrent(merchantId, p.id, input.authority);
  }
  async execute(merchantId: string, proposalId: string, actorId: string): Promise<MetaAdsExecution> {
    requireIdentifier(actorId);
    return this.executeWith(merchantId, proposalId, { kind: 'manual', actorId });
  }
  async executeAutomatic(merchantId: string, proposalId: string, request: Extract<ExecutionAuthorityRequest, { kind: 'automatic' }>): Promise<MetaAdsExecution> {
    if (!this.authorityDeps || request?.kind !== 'automatic') throw new MetaAdsError('automatic_authority_unavailable', 409);
    return this.executeWith(merchantId, proposalId, request);
  }
  private async executeWith(merchantId: string, proposalId: string, request: ExecutionAuthorityRequest): Promise<MetaAdsExecution> {
    requireIdentifier(proposalId); const plan = await this.commerce.getPlan(merchantId);
    const preliminary = await this.repo.read(merchantId); const candidate = preliminary.proposals[proposalId];
    if (!candidate) throw new MetaAdsError("approval_required", 403);
    if (candidate.kind === 'launch' && !this.authorityDeps) throw new MetaAdsError('execution_authority_invalid', 503);
    // A read of an existing automatic execution is reconciliation, never a new grant or resend.
    if (request.kind === 'automatic' && candidate.executionId) {
      const previous = (await this.repo.getRecord<ExecutionInput>(merchantId, `execution-input:${candidate.executionId}`))?.payload;
      const grant = previous?.authority;
      if (grant?.kind !== 'automatic' || grant.policyId !== request.policyId || grant.policyVersion !== request.policyVersion || grant.policyDigest !== request.policyDigest) throw new MetaAdsError('automatic_authority_unavailable', 409);
      return preliminary.executions[candidate.executionId];
    }
    const authority = this.authorityDeps ? await this.authorityDeps.authority.resolve(merchantId, proposalId, request) : undefined;
    const actorId = authority?.actorId ?? (request.kind === 'manual' ? request.actorId : 'service:meta-ads-agent');
    const reserved = await this.repo.mutate<{ execution: MetaAdsExecution; input: ExecutionInput | null }>(merchantId, [`proposal-version:${proposalId}`, `proposal-approval:${proposalId}`, `campaign-origin:${candidate.campaignId}`], (state, records) => {
      requireEntitlement(plan, state, this.clock());
      const p = request.kind === 'manual' ? this.approved(merchantId, state, proposalId, records) : state.proposals[proposalId];
      if (!p) throw new MetaAdsError('approval_required', 403);
      assertReviewedProposal(merchantId, p, records.get(`proposal-version:${p.id}`));
      if (p.executionId) return { result: { execution: state.executions[p.executionId], input: null } };
      const expectedStatus = request.kind === 'automatic' ? 'pending_review' : 'approved';
      if (p.status !== expectedStatus) throw new MetaAdsError(p.status === "stale" ? "proposal_stale" : "approval_required", 409);
      if (request.kind === 'automatic' && (!authority || authority.kind !== 'automatic' || p.approvedBy !== null || p.approvedAt !== null || state.automation?.activePolicyId !== authority.policyId || state.automation.version !== authority.policyVersion)) throw new MetaAdsError('automatic_authority_unavailable', 409);
      if (p.connectionEpoch !== state.connection.epoch) throw new MetaAdsError("proposal_stale", 409);
      const campaign = state.campaigns[p.campaignId]; const origin = records.get(`campaign-origin:${p.campaignId}`)?.payload as { source?: string; campaignId?: string } | undefined;
      if (!campaign?.managed || !campaign.createdByAgent || origin?.source !== "agent" || origin.campaignId !== p.campaignId) throw new MetaAdsError("campaign_read_only", 403);
      // A new proposal identity must not bypass an existing campaign write or retry an unknown result.
      if (Object.values(state.executions).some(value => value.campaignId === campaign.id && ["reserved", "sending", "publishing", "execution_unknown"].includes(value.status))) throw new MetaAdsError("campaign_execution_pending", 409);
      if (['prepare', 'launch'].includes(p.kind) && campaign.remoteCampaignId) throw new MetaAdsError("campaign_already_prepared", 409);
      if (campaign.remoteCampaignId && campaign.remoteAccountId !== state.connection.account?.id) throw new MetaAdsError("meta_asset_forbidden", 403);
      const id = requireIdentifier(this.id()); const now = this.clock().toISOString();
      const execution: MetaAdsExecution = { id, proposalId, campaignId: campaign.id, status: "reserved", objects: [], error: null, updatedAt: now };
      p.executionId = id; state.executions[id] = execution;
      const input: ExecutionInput = structuredClone({ campaign, proposal: p, actorId, ...(authority ? { authority } : {}) });
      return { result: { execution, input }, records: [{ key: `execution-input:${id}`, kind: "execution", payload: input, createdAt: now }] };
    });
    if (!reserved.input) return reserved.execution;
    const { input, execution } = reserved; let access: MetaAccess; let exposureReserved = false;
    try {
      access = await this.connection.access(merchantId, { destination: input.campaign.draft.destination, operation: input.proposal.kind === "prepare" ? "prepare" : ['publish', 'launch'].includes(input.proposal.kind) ? "publish" : "optimize" });
      if (input.authority?.kind === 'automatic' && ['prepare', 'publish', 'budget'].includes(input.proposal.kind)) {
        await this.authorityDeps!.exposure.reserve(merchantId, { operationId: execution.id, campaignId: input.campaign.id,
          policyId: input.authority.policyId, policyVersion: input.authority.policyVersion, policyDigest: input.authority.policyDigest,
          action: input.proposal.kind as 'prepare' | 'publish' | 'budget', targetBudget: this.targetBudget(input) });
        exposureReserved = true;
      }
      await this.lease(merchantId, execution.id, input, access);
      if (input.proposal.kind !== "pause") await this.campaigns.assertReady(merchantId, input.campaign.id);
      if (input.proposal.remoteBefore) {
        const snapshot = await this.provider.snapshot(access, input.campaign);
        if (remoteFingerprint(snapshot) !== remoteFingerprint(input.proposal.remoteBefore)) throw new MetaAdsError("proposal_stale", 409);
        if (!["pause", "creative"].includes(input.proposal.kind) && input.campaign.remoteCreativeIds?.length && stableDigest([...snapshot.creativeIds].sort()) !== stableDigest([...input.campaign.remoteCreativeIds].sort())) throw new MetaAdsError("proposal_stale", 409);
      }
      await this.lease(merchantId, execution.id, input, access);
      await this.repo.mutate(merchantId, [], state => {
        if (state.connection.epoch !== access.connectionEpoch || state.executions[execution.id].status !== "reserved" || state.proposals[proposalId].status !== (input.authority?.kind === 'automatic' ? 'pending_review' : 'approved')) throw new MetaAdsError("proposal_stale", 409);
        state.executions[execution.id].status = "sending"; state.executions[execution.id].updatedAt = this.clock().toISOString(); return { result: null };
      });
    } catch (error) {
      if (exposureReserved) await this.authorityDeps!.exposure.cancel(merchantId, execution.id);
      await this.repo.mutate(merchantId, [], state => {
        state.proposals[proposalId].status = "stale"; const value = state.executions[execution.id]; value.status = "failed"; value.error = safeError(error instanceof MetaAdsError ? error.code : null); value.updatedAt = this.clock().toISOString();
        return { result: null, records: [{ key: `execution-result:${execution.id}:1`, kind: "audit", createdAt: value.updatedAt, payload: { executionId: execution.id, proposalId, campaignId: value.campaignId, actorId, authority: input.authority ?? null, approvedBy: input.proposal.approvedBy, approvedAt: input.proposal.approvedAt, digest: input.proposal.digest, kind: input.proposal.kind, objects: value.objects, status: value.status, error: value.error } }] };
      });
      throw error;
    }
    if (input.authority?.kind === 'automatic') access.executionAuthority = input.authority;
    access.assertWriteAuthorized = async () => {
      await this.lease(merchantId, execution.id, input, access);
      if (exposureReserved) await this.authorityDeps!.exposure.dispatched(merchantId, execution.id);
    };
    const progress = async (objects: MetaAdsExecution["objects"]) => {
      await this.repo.mutate(merchantId, [], state => { const value = state.executions[execution.id]; value.objects = mergeObjects(value.objects, objects); bindObjects(state.campaigns[input.campaign.id], value.objects, access.accountId); value.updatedAt = this.clock().toISOString(); return { result: null }; });
      await this.lease(merchantId, execution.id, input, access);
    };
    let result: ProviderExecutionResult;
    try {
      await access.assertWriteAuthorized();
      result = input.proposal.kind === "prepare"
        ? await this.provider.prepare(access, input.campaign, input.proposal.after.media as MetaAdsMedia[], progress)
        : await this.provider.execute(access, input.campaign, input.proposal, progress);
    } catch { result = { status: "execution_unknown", objects: [], error: "meta_execution_unknown" }; }
    if (result.status === "delivered" || (input.proposal.kind === "prepare" && !["remote_paused", "remote_draft", "failed", "execution_unknown"].includes(result.status))) result = { ...result, status: "execution_unknown", error: "meta_publication_unconfirmed" };
    if (input.proposal.kind === 'launch' && ['active_unconfirmed', 'publishing'].includes(result.status)) {
      const state = await this.repo.read(merchantId);
      if (!completeLaunch(mergeObjects(state.executions[execution.id].objects, result.objects))) result = { ...result, status: 'execution_unknown', error: 'meta_preparation_incomplete' };
    }
    if (exposureReserved) result = await this.settleExposure(merchantId, execution.id, input, access, result);
    return this.finish(merchantId, execution.id, input, access, result, false);
  }
  private targetBudget(input: ExecutionInput): MetaAdsBudget {
    return structuredClone(input.proposal.kind === 'budget' ? input.proposal.after.budget : input.campaign.draft.budget) as MetaAdsBudget;
  }
  private async settleExposure(merchantId: string, executionId: string, input: ExecutionInput, access: MetaAccess | null, result: ProviderExecutionResult): Promise<ProviderExecutionResult> {
    if (!this.authorityDeps || input.authority?.kind !== 'automatic' || !['prepare', 'publish', 'budget'].includes(input.proposal.kind)) return result;
    const reservation = await this.authorityDeps.exposure.read(merchantId, executionId);
    if (['confirmed', 'cancelled'].includes(reservation.status)) return result;
    if (reservation.status === 'reserved') { await this.authorityDeps.exposure.cancel(merchantId, executionId); return result; }
    if (!result.error && ['remote_paused', 'remote_draft', 'active_unconfirmed', 'delivered'].includes(result.status) && access) {
      try {
        const campaign = await this.campaigns.owned(merchantId, input.campaign.id);
        const policy = (await this.repo.getRecord<{ policy: MetaAdsAutomationPolicy }>(merchantId, `automatic-policy:${input.authority.policyId}`))?.payload.policy;
        if (!policy) throw new MetaAdsError('exposure_confirmation_mismatch', 409);
        const proof = await this.authorityDeps.budgetControl.prove(access, campaign, this.targetBudget(input), policy.limits);
        await this.authorityDeps.exposure.confirm(merchantId, executionId, proof); return result;
      } catch { result = { ...result, status: 'execution_unknown', error: 'meta_budget_unconfirmed' }; }
    }
    await this.authorityDeps.exposure.unknown(merchantId, executionId); return result;
  }
  private async finish(merchantId: string, executionId: string, input: ExecutionInput, access: MetaAccess | null, result: ProviderExecutionResult, reconciliation: boolean): Promise<MetaAdsExecution> {
    return this.repo.mutate(merchantId, [`execution-result:${executionId}:1`], (state, records) => {
      const value = state.executions[executionId]; const p = state.proposals[input.proposal.id]; const campaign = state.campaigns[input.campaign.id];
      value.objects = mergeObjects(value.objects, result.objects); bindObjects(campaign, value.objects, campaign.remoteAccountId ?? input.campaign.remoteAccountId ?? access?.accountId ?? null);
      const sameConnection = access && state.connection.epoch === access.connectionEpoch;
      value.status = !reconciliation && !sameConnection ? "execution_unknown" : result.status;
      value.error = result.error ? safeError(result.error) : !sameConnection ? "meta_reconciliation_unavailable" : null;
      value.updatedAt = this.clock().toISOString(); campaign.status = value.status; campaign.updatedAt = value.updatedAt;
      if (sameConnection) state.connection.clientConversationId = access.clientConversationId;
      if (p.status === "approved" || input.authority?.kind === 'automatic' && p.status === 'pending_review') p.status = "executed";
      if (["remote_paused", "remote_draft", "active_unconfirmed", "delivered"].includes(value.status) && !value.error) {
        const creatives = value.objects.filter(ref => ref.type === "creative").map(ref => ref.id);
        if (creatives.length) campaign.remoteCreativeIds = creatives;
        if (input.proposal.kind === "budget") campaign.draft.budget = structuredClone(input.proposal.after.budget) as MetaAdsCampaign["draft"]["budget"];
        if (input.proposal.kind === "audience") campaign.draft.country = String(input.proposal.after.country);
      }
      const key = reconciliation ? `execution-reconciled:${executionId}:${requireIdentifier(this.id())}` : `execution-result:${executionId}:1`;
      return { result: value, records: !reconciliation && records.has(key) ? [] : [{ key, kind: "audit", createdAt: value.updatedAt, payload: { executionId, proposalId: p.id, campaignId: p.campaignId, actorId: input.actorId, authority: input.authority ?? null, approvedBy: input.proposal.approvedBy, approvedAt: input.proposal.approvedAt, digest: input.proposal.digest, kind: input.proposal.kind, objects: value.objects, status: value.status, error: value.error } }] };
    });
  }
  async reconcile(merchantId: string, executionId: string): Promise<MetaAdsExecution> {
    requireIdentifier(executionId); const state = await this.repo.read(merchantId); const execution = state.executions[executionId];
    if (!execution) throw new MetaAdsError("execution_not_found", 404);
    const receipt = await this.repo.getRecord<ExecutionInput>(merchantId, `execution-input:${executionId}`);
    if (!receipt) throw new MetaAdsError("execution_not_found", 404);
    if (execution.status === "reserved") return execution;
    if (execution.status === "sending" && this.clock().getTime() - new Date(execution.updatedAt).getTime() < 180000) return execution;
    let access: MetaAccess | null = null; let result: ProviderExecutionResult;
    try {
      access = await this.connection.access(merchantId, { allowExpired: true }); const campaign = await this.campaigns.owned(merchantId, execution.campaignId);
      if (!campaign.remoteCampaignId || campaign.remoteAccountId !== access.accountId) throw new MetaAdsError("meta_asset_forbidden", 403);
      result = await this.provider.reconcile(access, campaign, execution);
      if (receipt.payload.proposal.kind === "prepare" && (!campaign.remoteAdSetId || !campaign.remoteAdIds.length)) result = { status: execution.status === "failed" ? "failed" : "execution_unknown", objects: execution.objects, error: execution.error ?? "meta_preparation_incomplete" };
      if (receipt.payload.proposal.kind === 'launch') {
        if (!completeLaunch(execution.objects)) result = { status: 'execution_unknown', objects: execution.objects, error: 'meta_preparation_incomplete' };
        else {
          const snapshot = await this.provider.snapshot(access, campaign), budget = receipt.payload.campaign.draft.budget!;
          const expectedCreative = execution.objects.find(ref => ref.type === 'creative')!.id;
          const dateMatches = (actual: string | null | undefined, expected: string | null) => expected === null ? actual === null : typeof actual === 'string' && Number.isFinite(Date.parse(actual)) && Date.parse(actual) === Date.parse(expected);
          if (Number(snapshot.budget[budget.cadence === 'daily' ? 'daily_budget' : 'lifetime_budget']) !== budget.amountCents || snapshot.campaignId !== campaign.remoteCampaignId || snapshot.adSetId !== campaign.remoteAdSetId || stableDigest([...snapshot.adIds].sort()) !== stableDigest([...campaign.remoteAdIds].sort()) || !snapshot.creativeIds.includes(expectedCreative) || !dateMatches(snapshot.schedule?.startsAt, budget.startsAt) || !snapshot.schedule || !dateMatches(snapshot.schedule.endsAt, budget.endsAt)) result = { status: 'execution_unknown', objects: execution.objects, error: 'meta_launch_unconfirmed' };
        }
      }
      if (["budget", "audience", "creative"].includes(receipt.payload.proposal.kind)) {
        const snapshot = await this.provider.snapshot(access, campaign); const p = receipt.payload.proposal;
        const budget = p.after.budget as MetaAdsCampaign["draft"]["budget"];
        const expectedCreative = execution.objects.filter(ref => ref.type === "creative").at(-1)?.id;
        const confirmed = p.kind === "budget" ? budget && Number(snapshot.budget[budget.cadence === "daily" ? "daily_budget" : "lifetime_budget"]) === budget.amountCents
          : p.kind === "audience" ? stableDigest(snapshot.targeting) === stableDigest(p.after.targeting)
          : expectedCreative && snapshot.creativeIds.includes(expectedCreative);
        if (!confirmed) result = { status: "execution_unknown", objects: execution.objects, error: `meta_${p.kind}_unconfirmed` };
      }
    } catch { result = { status: "execution_unknown", objects: execution.objects, error: "meta_reconciliation_unavailable" }; }
    result = await this.settleExposure(merchantId, executionId, receipt.payload, access, result);
    return this.finish(merchantId, executionId, receipt.payload, access, result, true);
  }
}
