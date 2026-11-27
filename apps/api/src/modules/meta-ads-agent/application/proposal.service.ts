import { randomUUID } from "node:crypto";
import type { MetaAdsActionKind, MetaAdsCampaign, MetaAdsProduct } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type MetaAdsProviderPort, type StoredProposal, type RemoteSnapshot, type MetaAdsRecord, type MetaAdsStoreState, type Clock, type IdFactory } from "../domain/types.js";
import { requireEntitlement, requireIdentifier, stableDigest } from "../domain/offer.js";
import { normalizeCampaignDraft, type CampaignService } from "./campaign.service.js";
import type { ConnectionService } from "./connection.service.js";

export interface ProposalInput { kind: MetaAdsActionKind; after?: Record<string, unknown>; reasoning: string; idempotencyKey: string; }
const objectRefs = (campaign: MetaAdsCampaign) => [
  ...(campaign.remoteCampaignId ? [{ type: "campaign", id: campaign.remoteCampaignId }] : []),
  ...(campaign.remoteAdSetId ? [{ type: "ad_set", id: campaign.remoteAdSetId }] : []), ...campaign.remoteAdIds.map(id => ({ type: "ad", id })),
];
export function remoteFingerprint(value: RemoteSnapshot): string {
  return stableDigest({ ...value, adIds: [...value.adIds].sort(), creativeIds: [...value.creativeIds].sort(),
    ...(value.objectStates ? { objectStates: [...value.objectStates].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)) } : {}),
    budget: Object.fromEntries(Object.entries(value.budget).map(([key, amount]) => [key, amount === null ? null : String(amount)])) });
}
export function approvalProductVersion(product: MetaAdsProduct): string {
  return stableDigest({ productId: product.productId, variantId: product.variantId, commercialVersion: product.commercialVersion, stockQuantity: product.stockQuantity, active: product.active });
}
export function proposalDigest(merchantId: string, value: StoredProposal): string {
  return stableDigest({ merchantId, id: value.id, campaignId: value.campaignId, kind: value.kind, before: value.before, after: value.after, reasoning: value.reasoning,
    connectionEpoch: value.connectionEpoch, productVersions: value.productVersions, remoteBefore: value.remoteBefore });
}
export function assertReviewedProposal(merchantId: string, value: StoredProposal, frozen: MetaAdsRecord | undefined | null): void {
  const original = frozen?.payload as StoredProposal | undefined;
  if (!original || original.digest !== value.digest || proposalDigest(merchantId, value) !== value.digest || proposalDigest(merchantId, original) !== value.digest) throw new MetaAdsError("proposal_version_changed", 409);
}
function storedProposal(state: MetaAdsStoreState, id: string): StoredProposal {
  if (!Object.hasOwn(state.proposals, id)) throw new MetaAdsError("proposal_not_found", 404);
  return state.proposals[id];
}

export class ProposalService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan" | "products">,
    private readonly campaigns: Pick<CampaignService, "owned" | "assertReady">, private readonly connection: Pick<ConnectionService, "access">,
    private readonly provider: Pick<MetaAdsProviderPort, "snapshot">, private readonly clock: Clock = () => new Date(), private readonly id: IdFactory = randomUUID) {}

  private fields(input: ProposalInput): Record<string, unknown> {
    if (!["prepare", "publish", "pause", "budget", "audience", "creative", "launch"].includes(input.kind)) throw new MetaAdsError("meta_action_invalid");
    const after = input.after ?? {};
    const allowed = input.kind === "budget" ? ["budget"] : input.kind === "audience" ? ["country"] : [];
    if (!after || typeof after !== "object" || Array.isArray(after) || Object.keys(after).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(after, key))) throw new MetaAdsError("proposal_fields_invalid");
    if (typeof input.reasoning !== "string" || !input.reasoning.trim() || input.reasoning.length > 2000) throw new MetaAdsError("proposal_reasoning_invalid");
    return after;
  }
  async create(merchantId: string, campaignId: string, input: ProposalInput): Promise<StoredProposal> {
    const fields = this.fields(input); requireIdentifier(input.idempotencyKey);
    const plan = await this.commerce.getPlan(merchantId); const state = await this.repo.read(merchantId); requireEntitlement(plan, state, this.clock());
    const requestKey = `proposal-request:${input.idempotencyKey}`; const inputDigest = stableDigest({ campaignId, kind: input.kind, after: fields, reasoning: input.reasoning });
    const existing = await this.repo.getRecord<{ id: string; digest: string }>(merchantId, requestKey);
    if (existing) {
      if (existing.payload.digest !== inputDigest) throw new MetaAdsError("proposal_request_conflict", 409);
      return storedProposal(await this.repo.read(merchantId), existing.payload.id);
    }
    const campaign = await this.campaigns.owned(merchantId, campaignId);
    if (input.kind !== "pause") await this.campaigns.assertReady(merchantId, campaignId);
    const reviewedProducts = await this.commerce.products(merchantId, { variantIds: campaign.draft.variantIds });
    let targetBudget = campaign.draft.budget;
    if (input.kind === "budget") {
      targetBudget = normalizeCampaignDraft({ ...campaign.draft, budget: fields.budget as MetaAdsCampaign["draft"]["budget"] }).budget;
      if (!targetBudget || targetBudget.cadence !== campaign.draft.budget?.cadence) throw new MetaAdsError("campaign_budget_cadence_change_unsupported");
    }
    if (input.kind === "audience") normalizeCampaignDraft({ ...campaign.draft, country: fields.country as string });
    const initial = input.kind === "prepare" || input.kind === "launch";
    const operation = input.kind === "prepare" ? "prepare" : input.kind === "publish" || input.kind === "launch" ? "publish" : "optimize";
    const access = await this.connection.access(merchantId, { destination: campaign.draft.destination, operation });
    if (campaign.remoteCampaignId && campaign.remoteAccountId !== access.accountId) throw new MetaAdsError("meta_asset_forbidden", 403);
    if (initial && campaign.remoteCampaignId) throw new MetaAdsError("campaign_already_prepared", 409);
    if (!initial && !campaign.remoteCampaignId) throw new MetaAdsError("campaign_preparation_required", 409);
    if (input.kind === "publish" && (!campaign.remoteAdSetId || !campaign.remoteAdIds.length || !campaign.draft.budget)) throw new MetaAdsError("campaign_preparation_incomplete", 409);
    const remoteBefore = initial ? null : await this.provider.snapshot(access, campaign);
    const before: Record<string, unknown> = remoteBefore ? { objects: objectRefs(campaign), status: remoteBefore.status, budget: remoteBefore.budget, targeting: remoteBefore.targeting, creativeIds: remoteBefore.creativeIds } : { objects: [], status: "not_created", budget: null };
    if (remoteBefore?.objectStates) before.objectStates = remoteBefore.objectStates;
    before.productState = reviewedProducts.map(product => ({ variantId: product.variantId, commercialVersion: product.commercialVersion, stockQuantity: product.stockQuantity, active: product.active }));
    let after: Record<string, unknown>;
    if (initial) {
      const media = campaign.draft.mediaIds.map(id => state.media[id]);
      if (media.some(item => !item)) throw new MetaAdsError("proposal_stale", 409);
      after = { objects: ["campaign", "ad_set", "creative", "ad"], draft: campaign.draft, products: reviewedProducts,
        media, accountId: access.accountId, pageId: access.pageId, datasetId: access.datasetId, whatsappId: access.whatsappId,
        ...(input.kind === "launch" ? { status: "ACTIVE" } : {}) };
    }
    else if (input.kind === "publish") {
      const budget = campaign.draft.budget!; const remoteAmount = remoteBefore!.budget[budget.cadence === "daily" ? "daily_budget" : "lifetime_budget"];
      if (Number(remoteAmount) !== budget.amountCents) throw new MetaAdsError("proposal_stale", 409);
      after = { objects: objectRefs(campaign), status: "ACTIVE", budget };
    } else if (input.kind === "budget") after = { objects: objectRefs(campaign).filter(ref => ref.type === "campaign"), budget: targetBudget };
    else if (input.kind === "pause") after = { objects: objectRefs(campaign).filter(ref => ref.type === "campaign"), status: "PAUSED" };
    else if (input.kind === "audience") after = { objects: objectRefs(campaign).filter(ref => ref.type === "ad_set"), country: fields.country,
      targeting: { ...remoteBefore!.targeting, geo_locations: { countries: [fields.country] } } };
    else after = { objects: objectRefs(campaign).filter(ref => ref.type === "ad"), media: campaign.draft.mediaIds.map(id => state.media[id]), headline: campaign.draft.headline, primaryText: campaign.draft.primaryText };
    const now = this.clock().toISOString(); const id = requireIdentifier(this.id());
    const proposal: StoredProposal = { id, campaignId, kind: input.kind, status: "pending_review", before, after, digest: "", reasoning: input.reasoning.trim(), connectionEpoch: access.connectionEpoch,
      createdAt: now, approvedAt: null, approvedBy: null, executionId: null, remoteBefore, productVersions: Object.fromEntries(reviewedProducts.map(product => [product.variantId, approvalProductVersion(product)])) };
    proposal.digest = proposalDigest(merchantId, proposal);
    return this.repo.mutate(merchantId, [requestKey, `campaign-origin:${campaignId}`], (current, records) => {
      requireEntitlement(plan, current, this.clock());
      if (records.has(requestKey)) {
        const receipt = records.get(requestKey)!.payload as { id: string; digest: string };
        if (receipt.digest !== inputDigest) throw new MetaAdsError("proposal_request_conflict", 409);
        return { result: storedProposal(current, receipt.id) };
      }
      const live = current.campaigns[campaignId]; const origin = records.get(`campaign-origin:${campaignId}`)?.payload as { source?: string; campaignId?: string } | undefined;
      if (!live?.managed || !live.createdByAgent || origin?.source !== "agent" || origin.campaignId !== campaignId) throw new MetaAdsError("campaign_read_only", 403);
      if (current.connection.epoch !== access.connectionEpoch || stableDigest(live.draft) !== stableDigest(campaign.draft) || stableDigest(live.products) !== stableDigest(campaign.products)) throw new MetaAdsError("proposal_stale", 409);
      if (initial && (live.draft.mediaIds.some(id => !Object.hasOwn(current.media, id)) || stableDigest(live.draft.mediaIds.map(id => current.media[id])) !== stableDigest(after.media))) throw new MetaAdsError("proposal_stale", 409);
      current.proposals[id] = proposal;
      return { result: proposal, records: [{ key: requestKey, kind: "proposal", payload: { id, digest: inputDigest }, createdAt: now }, { key: `proposal-version:${id}`, kind: "proposal", payload: proposal, createdAt: now }] };
    });
  }
  async approve(merchantId: string, proposalId: string, actorId: string, expectedDigest: string): Promise<StoredProposal> {
    requireIdentifier(actorId); const plan = await this.commerce.getPlan(merchantId);
    return this.repo.mutate(merchantId, [`proposal-version:${proposalId}`, `proposal-approval:${proposalId}`], (state, records) => {
      requireEntitlement(plan, state, this.clock()); const value = storedProposal(state, proposalId);
      if (value.connectionEpoch !== state.connection.epoch || value.status === "stale") throw new MetaAdsError("proposal_stale", 409);
      assertReviewedProposal(merchantId, value, records.get(`proposal-version:${proposalId}`));
      if (value.digest !== expectedDigest) throw new MetaAdsError("proposal_version_changed", 409);
      if (value.status === "approved" && value.approvedBy === actorId) return { result: value };
      if (value.status !== "pending_review") throw new MetaAdsError("proposal_not_pending", 409);
      value.status = "approved"; value.approvedBy = actorId; value.approvedAt = this.clock().toISOString();
      return { result: value, records: [{ key: `proposal-approval:${proposalId}`, kind: "proposal", payload: { actorId, digest: value.digest, campaignId: value.campaignId, kind: value.kind,
        connectionEpoch: value.connectionEpoch, objects: value.after.objects, approvedAt: value.approvedAt }, createdAt: value.approvedAt }] };
    });
  }
  async reject(merchantId: string, proposalId: string, actorId: string): Promise<StoredProposal> {
    requireIdentifier(actorId); const plan = await this.commerce.getPlan(merchantId);
    return this.repo.mutate(merchantId, [`proposal-rejection:${proposalId}`], (state, records) => {
      requireEntitlement(plan, state, this.clock()); const value = storedProposal(state, proposalId);
      if (records.has(`proposal-rejection:${proposalId}`)) return { result: value };
      if (!["pending_review", "approved"].includes(value.status) || value.executionId) throw new MetaAdsError("proposal_not_pending", 409);
      value.status = "rejected";
      return { result: value, records: [{ key: `proposal-rejection:${proposalId}`, kind: "proposal", payload: { actorId, digest: value.digest, kind: value.kind, campaignId: value.campaignId }, createdAt: this.clock().toISOString() }] };
    });
  }
}
