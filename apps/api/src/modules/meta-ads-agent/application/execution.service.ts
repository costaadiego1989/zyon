import { randomUUID } from "node:crypto";
import type { MetaAdsCampaign, MetaAdsExecution, MetaAdsMedia } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaAdsProviderPort, type MetaAdsStoreState, type StoredProposal, type MetaAdsRecord, type MetaAccess, type ProviderExecutionResult, type Clock, type IdFactory } from "../domain/types.js";
import { requireEntitlement, requireIdentifier, stableDigest } from "../domain/offer.js";
import { approvalProductVersion, assertReviewedProposal, remoteFingerprint } from "./proposal.service.js";
import type { CampaignService } from "./campaign.service.js";
import type { ConnectionService } from "./connection.service.js";

interface ExecutionInput { campaign: MetaAdsCampaign; proposal: StoredProposal; actorId: string; }
const safeError = (error: unknown) => typeof error === "string" && /^(meta_|campaign_|proposal_)[a-z0-9_]{1,80}$/.test(error) ? error : "meta_execution_unknown";
function mergeObjects(...groups: MetaAdsExecution["objects"][]): MetaAdsExecution["objects"] {
  return [...new Map(groups.flat().filter(ref => ["campaign", "ad_set", "creative", "ad"].includes(ref.type) && /^\d+$/.test(ref.id)).map(ref => [`${ref.type}:${ref.id}`, ref])).values()];
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
    private readonly provider: Pick<MetaAdsProviderPort, "snapshot" | "prepare" | "execute" | "reconcile">, private readonly clock: Clock = () => new Date(), private readonly id: IdFactory = randomUUID) {}

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
    if (!p || p.executionId !== executionId || p.status !== "approved" || p.digest !== input.proposal.digest || !["reserved", "sending"].includes(execution?.status) || !campaign?.managed || !campaign.createdByAgent || stableDigest(campaign.draft) !== stableDigest(input.campaign.draft)) throw new MetaAdsError("proposal_stale", 409);
    assertReviewedProposal(merchantId, p, await this.repo.getRecord(merchantId, `proposal-version:${p.id}`));
    if (campaign.remoteCampaignId && campaign.remoteAccountId !== access.accountId) throw new MetaAdsError("meta_asset_forbidden", 403);
    await this.productsUnchanged(merchantId, p, campaign);
  }
  async execute(merchantId: string, proposalId: string, actorId: string): Promise<MetaAdsExecution> {
    requireIdentifier(actorId); requireIdentifier(proposalId); const plan = await this.commerce.getPlan(merchantId);
    const preliminary = await this.repo.read(merchantId); const candidate = preliminary.proposals[proposalId];
    if (!candidate) throw new MetaAdsError("approval_required", 403);
    const reserved = await this.repo.mutate<{ execution: MetaAdsExecution; input: ExecutionInput | null }>(merchantId, [`proposal-version:${proposalId}`, `proposal-approval:${proposalId}`, `campaign-origin:${candidate.campaignId}`], (state, records) => {
      requireEntitlement(plan, state, this.clock()); const p = this.approved(merchantId, state, proposalId, records);
      if (p.executionId) return { result: { execution: state.executions[p.executionId], input: null } };
      if (p.status !== "approved") throw new MetaAdsError(p.status === "stale" ? "proposal_stale" : "approval_required", 409);
      if (p.connectionEpoch !== state.connection.epoch) throw new MetaAdsError("proposal_stale", 409);
      const campaign = state.campaigns[p.campaignId]; const origin = records.get(`campaign-origin:${p.campaignId}`)?.payload as { source?: string; campaignId?: string } | undefined;
      if (!campaign?.managed || !campaign.createdByAgent || origin?.source !== "agent" || origin.campaignId !== p.campaignId) throw new MetaAdsError("campaign_read_only", 403);
      // A new proposal identity must not bypass an existing campaign write or retry an unknown result.
      if (Object.values(state.executions).some(value => value.campaignId === campaign.id && ["reserved", "sending", "publishing", "execution_unknown"].includes(value.status))) throw new MetaAdsError("campaign_execution_pending", 409);
      if (p.kind === "prepare" && campaign.remoteCampaignId) throw new MetaAdsError("campaign_already_prepared", 409);
      if (campaign.remoteCampaignId && campaign.remoteAccountId !== state.connection.account?.id) throw new MetaAdsError("meta_asset_forbidden", 403);
      const id = requireIdentifier(this.id()); const now = this.clock().toISOString();
      const execution: MetaAdsExecution = { id, proposalId, campaignId: campaign.id, status: "reserved", objects: [], error: null, updatedAt: now };
      p.executionId = id; state.executions[id] = execution;
      const input: ExecutionInput = structuredClone({ campaign, proposal: p, actorId });
      return { result: { execution, input }, records: [{ key: `execution-input:${id}`, kind: "execution", payload: input, createdAt: now }] };
    });
    if (!reserved.input) return reserved.execution;
    const { input, execution } = reserved; let access: MetaAccess;
    try {
      access = await this.connection.access(merchantId, { destination: input.campaign.draft.destination, operation: input.proposal.kind === "prepare" ? "prepare" : input.proposal.kind === "publish" ? "publish" : "optimize" });
      await this.lease(merchantId, execution.id, input, access);
      if (input.proposal.kind !== "pause") await this.campaigns.assertReady(merchantId, input.campaign.id);
      if (input.proposal.remoteBefore) {
        const snapshot = await this.provider.snapshot(access, input.campaign);
        if (remoteFingerprint(snapshot) !== remoteFingerprint(input.proposal.remoteBefore)) throw new MetaAdsError("proposal_stale", 409);
        if (!["pause", "creative"].includes(input.proposal.kind) && input.campaign.remoteCreativeIds?.length && stableDigest([...snapshot.creativeIds].sort()) !== stableDigest([...input.campaign.remoteCreativeIds].sort())) throw new MetaAdsError("proposal_stale", 409);
      }
      await this.lease(merchantId, execution.id, input, access);
      await this.repo.mutate(merchantId, [], state => {
        if (state.connection.epoch !== access.connectionEpoch || state.executions[execution.id].status !== "reserved" || state.proposals[proposalId].status !== "approved") throw new MetaAdsError("proposal_stale", 409);
        state.executions[execution.id].status = "sending"; state.executions[execution.id].updatedAt = this.clock().toISOString(); return { result: null };
      });
    } catch (error) {
      await this.repo.mutate(merchantId, [], state => {
        state.proposals[proposalId].status = "stale"; const value = state.executions[execution.id]; value.status = "failed"; value.error = safeError(error instanceof MetaAdsError ? error.code : null); value.updatedAt = this.clock().toISOString();
        return { result: null, records: [{ key: `execution-result:${execution.id}:1`, kind: "audit", createdAt: value.updatedAt, payload: { executionId: execution.id, proposalId, campaignId: value.campaignId, actorId, approvedBy: input.proposal.approvedBy, approvedAt: input.proposal.approvedAt, digest: input.proposal.digest, kind: input.proposal.kind, objects: value.objects, status: value.status, error: value.error } }] };
      });
      throw error;
    }
    access.assertWriteAuthorized = () => this.lease(merchantId, execution.id, input, access);
    const progress = async (objects: MetaAdsExecution["objects"]) => {
      await this.repo.mutate(merchantId, [], state => { const value = state.executions[execution.id]; value.objects = mergeObjects(value.objects, objects); bindObjects(state.campaigns[input.campaign.id], value.objects, access.accountId); value.updatedAt = this.clock().toISOString(); return { result: null }; });
      await this.lease(merchantId, execution.id, input, access);
    };
    let result: ProviderExecutionResult;
    try {
      result = input.proposal.kind === "prepare"
        ? await this.provider.prepare(access, input.campaign, input.proposal.after.media as MetaAdsMedia[], progress)
        : await this.provider.execute(access, input.campaign, input.proposal, progress);
    } catch { result = { status: "execution_unknown", objects: [], error: "meta_execution_unknown" }; }
    if (result.status === "delivered" || (input.proposal.kind === "prepare" && !["remote_paused", "remote_draft", "failed", "execution_unknown"].includes(result.status))) result = { ...result, status: "execution_unknown", error: "meta_publication_unconfirmed" };
    return this.finish(merchantId, execution.id, input, access, result, false);
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
      if (p.status === "approved") p.status = "executed";
      if (["remote_paused", "remote_draft", "active_unconfirmed", "delivered"].includes(value.status) && !value.error) {
        const creatives = value.objects.filter(ref => ref.type === "creative").map(ref => ref.id);
        if (creatives.length) campaign.remoteCreativeIds = creatives;
        if (input.proposal.kind === "budget") campaign.draft.budget = structuredClone(input.proposal.after.budget) as MetaAdsCampaign["draft"]["budget"];
        if (input.proposal.kind === "audience") campaign.draft.country = String(input.proposal.after.country);
      }
      const key = reconciliation ? `execution-reconciled:${executionId}:${requireIdentifier(this.id())}` : `execution-result:${executionId}:1`;
      return { result: value, records: !reconciliation && records.has(key) ? [] : [{ key, kind: "audit", createdAt: value.updatedAt, payload: { executionId, proposalId: p.id, campaignId: p.campaignId, actorId: input.actorId, approvedBy: input.proposal.approvedBy, approvedAt: input.proposal.approvedAt, digest: input.proposal.digest, kind: input.proposal.kind, objects: value.objects, status: value.status, error: value.error } }] };
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
    return this.finish(merchantId, executionId, receipt.payload, access, result, true);
  }
}
