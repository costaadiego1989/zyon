import { randomUUID } from "node:crypto";
import type { MetaAdsCampaign, MetaAdsCampaignDraft, MetaAdsCampaignReadiness, MetaAdsMedia, MetaAdsProduct } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsRepository, type MetaAdsProviderPort, type CommerceContextPort, type MetaAdsStoreState, type MetaAdsRecord, type Clock, type IdFactory } from "../domain/types.js";
import { requireEntitlement, requireIdentifier, stableDigest } from "../domain/offer.js";
import type { ConnectionService } from "./connection.service.js";

import { normalizeCampaignDraft, assertCommercialTerms } from "../domain/campaign-draft.js";
export { normalizeCampaignDraft, assertCommercialTerms } from "../domain/campaign-draft.js";

export class CampaignService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan" | "products">,
    private readonly connection: Pick<ConnectionService, "access">, private readonly provider: Pick<MetaAdsProviderPort, "existingCampaigns">,
    private readonly clock: Clock = () => new Date(), private readonly id: IdFactory = randomUUID) {}

  private origin(state: MetaAdsStoreState, campaignId: string, record: MetaAdsRecord | null | undefined): MetaAdsCampaign {
    const campaign = Object.hasOwn(state.campaigns, campaignId) ? state.campaigns[campaignId] : null;
    const origin = record?.payload as { source?: string; campaignId?: string } | undefined;
    if (!campaign?.createdByAgent || !campaign.managed || origin?.source !== "agent" || origin.campaignId !== campaignId) throw new MetaAdsError("campaign_read_only", 403);
    return campaign;
  }
  async owned(merchantId: string, campaignId: string): Promise<MetaAdsCampaign> {
    return this.origin(await this.repo.read(merchantId), campaignId, await this.repo.getRecord(merchantId, `campaign-origin:${campaignId}`));
  }
  private async products(merchantId: string, draft: MetaAdsCampaignDraft): Promise<MetaAdsProduct[]> {
    const products = await this.commerce.products(merchantId, { variantIds: draft.variantIds });
    if (products.length !== draft.variantIds.length || draft.variantIds.some(variantId => !products.some(product => product.variantId === variantId)) || products.some(product => !product.active || (product.stockQuantity !== null && product.stockQuantity <= 0) || product.currency !== "BRL" || !Number.isSafeInteger(product.priceCents) || product.priceCents < 0)) throw new MetaAdsError("campaign_products_unavailable", 409);
    return products;
  }
  private media(state: MetaAdsStoreState, campaignId: string, draft: MetaAdsCampaignDraft, products: MetaAdsProduct[]): string[] {
    return draft.mediaIds.map(mediaId => {
      const source = Object.hasOwn(state.media, mediaId) ? state.media[mediaId] : null;
      if (!source || !products.some(product => product.variantId === source.variantId && product.productId === source.productId && product.commercialVersion === source.productVersion)) throw new MetaAdsError("campaign_media_unavailable", 409);
      if (source.campaignId === campaignId) return source.id;
      const reused = Object.values(state.media).find(item => item.campaignId === campaignId && item.url === source.url && item.variantId === source.variantId && item.productVersion === source.productVersion);
      if (reused) return reused.id;
      const copy: MetaAdsMedia = { ...source, id: this.id(), campaignId };
      state.media[copy.id] = copy;
      return copy.id;
    });
  }
  async create(merchantId: string, input: MetaAdsCampaignDraft, idempotencyKey: string, preparation?: {admissionId: string; opportunity: NonNullable<MetaAdsCampaign['opportunity']>}): Promise<MetaAdsCampaign> {
    requireIdentifier(idempotencyKey); const draft = normalizeCampaignDraft(input); const plan = await this.commerce.getPlan(merchantId);
    requireEntitlement(plan, await this.repo.read(merchantId), this.clock());
    const products = await this.products(merchantId, draft); const key = `campaign-request:${idempotencyKey}`; const digest = stableDigest(draft);
    return this.repo.mutate(merchantId, [key], (state, records) => {
      const subscription = requireEntitlement(plan, state, this.clock());
      if (records.has(key)) {
        const request = records.get(key)!.payload as { id: string; digest: string };
        if (request.digest !== digest) throw new MetaAdsError("campaign_request_conflict", 409);
        return { result: state.campaigns[request.id] };
      }
      const reservations=Object.values(state.preparationAdmissions??{}).filter(a=>a.state!=='closed'&&!a.campaignId);
      const occupied=Object.values(state.campaigns).filter(campaign=>campaign.managed).length+reservations.length;
      const admission=preparation?state.preparationAdmissions?.[preparation.admissionId]:null;
      if(preparation){
        if(!admission||admission.state==='closed'||admission.campaignId||state.automation?.activePolicyId!==admission.policyId||state.automation.version!==admission.policyVersion||state.connection.epoch!==admission.connectionEpoch)throw new MetaAdsError('automatic_authority_unavailable',409);
        if(state.preparationLimits&&(state.preparationLimits.dailyNewProposals===0||state.preparationLimits.maximumPendingProposals===0))throw new MetaAdsError('preparation_disabled',409);
        if(state.preparationLimits){
          const pending=Object.values(state.preparationAdmissions??{}).filter(a=>a.state!=='closed'&&(!a.campaignId||state.campaigns[a.campaignId]?.managed&&!['delivered','active_unconfirmed'].includes(state.campaigns[a.campaignId].status))).length;
          if(pending>Math.min(state.preparationLimits.maximumPendingProposals,subscription.offer.maxManagedCampaigns))throw new MetaAdsError('preparation_pending_limit',409);
          if(Object.values(state.preparationAdmissions??{}).filter(a=>a.accountLocalDay===admission.accountLocalDay).length>Math.min(state.preparationLimits.dailyNewProposals,subscription.offer.maxManagedCampaigns))throw new MetaAdsError('preparation_daily_limit',409);
        }
        if(Object.values(state.campaigns).some(c=>c.managed&&c.draft.destination===draft.destination&&c.draft.priority===draft.priority&&c.draft.country===draft.country&&c.draft.variantIds.some(id=>draft.variantIds.includes(id))))throw new MetaAdsError('opportunity_duplicate',409);
      }
      if (occupied+(admission?0:1)>subscription.offer.maxManagedCampaigns) throw new MetaAdsError("campaign_capacity_exceeded", 409);
      const id = requireIdentifier(this.id()); const now = this.clock().toISOString();
      const campaign: MetaAdsCampaign = { id, draft: { ...draft, mediaIds: this.media(state, id, draft, products) }, products, createdByAgent: true, managed: true,
        remoteCampaignId: null, remoteAdSetId: null, remoteAdIds: [], remoteAccountId: null, status: "draft", createdAt: now, updatedAt: now };
      state.campaigns[id] = campaign;
      if(admission&&preparation){admission.campaignId=id;admission.state='preparing';admission.updatedAt=now;campaign.opportunity=structuredClone(preparation.opportunity);}
      return { result: campaign, records: [{ key, kind: "audit", payload: { id, digest }, createdAt: now }, { key: `campaign-origin:${id}`, kind: "audit", payload: { source: "agent", campaignId: id }, createdAt: now }, ...(admission?[{key:`automatic-policy-campaign:${admission.policyId}:${id}`,kind:'audit' as const,payload:{policyId:admission.policyId,policyVersion:admission.policyVersion,campaignId:id},createdAt:now}]:[])] };
    });
  }
  async save(merchantId: string, campaignId: string, input: MetaAdsCampaignDraft): Promise<MetaAdsCampaign> {
    const snapshot = await this.owned(merchantId, campaignId); const draft = normalizeCampaignDraft(input); const plan = await this.commerce.getPlan(merchantId); const products = await this.products(merchantId, draft);
    return this.repo.mutate(merchantId, [`campaign-origin:${campaignId}`], (state, records) => {
      requireEntitlement(plan, state, this.clock()); const campaign = this.origin(state, campaignId, records.get(`campaign-origin:${campaignId}`));
      if (stableDigest(campaign.draft) !== stableDigest(snapshot.draft)) throw new MetaAdsError("campaign_changed", 409);
      campaign.draft = { ...draft, mediaIds: this.media(state, campaignId, draft, products) }; campaign.products = products; campaign.updatedAt = this.clock().toISOString();
      for (const proposal of Object.values(state.proposals)) if (proposal.campaignId === campaignId && ["pending_review", "approved"].includes(proposal.status)) proposal.status = "stale";
      return { result: campaign };
    });
  }
  async readiness(merchantId: string, campaignId: string): Promise<MetaAdsCampaignReadiness> {
    const plan = await this.commerce.getPlan(merchantId); const state = await this.repo.read(merchantId); requireEntitlement(plan, state, this.clock());
    const campaign = this.origin(state, campaignId, await this.repo.getRecord(merchantId, `campaign-origin:${campaignId}`));
    const missingSetup: string[] = []; const missingData: string[] = [];
    if (!campaign.draft.budget) missingSetup.push("campaign_budget_required");
    try { assertCommercialTerms(campaign.draft, campaign.products); } catch { missingSetup.push("creative_terms_mismatch"); }
    if (!campaign.draft.mediaIds.length) missingSetup.push("campaign_media_required");
    if (!campaign.draft.headline || !campaign.draft.primaryText) missingSetup.push("creative_copy_required");
    const fresh = await this.products(merchantId, campaign.draft);
    if (fresh.some(product => !campaign.products.some(previous => previous.variantId === product.variantId && previous.commercialVersion === product.commercialVersion))) missingSetup.push("campaign_products_changed");
    for (const id of campaign.draft.mediaIds) {
      const item = state.media[id]; const product = fresh.find(p => p.variantId === item?.variantId);
      if (!item || !product || product.commercialVersion !== item.productVersion) { missingSetup.push("campaign_media_unavailable"); continue; }
      if(item.source==='catalog'&&(item.canonicalImageUrl!==product.imageUrl||item.commercialReview?.method!=='canonical_source')){missingSetup.push('campaign_media_unavailable');continue;}
      if (item.commercialReview?.status === "rejected") missingSetup.push("creative_terms_mismatch");
      else if (item.commercialReview?.status !== "verified" || item.commercialReview.productVersion !== product.commercialVersion || !/^[a-f0-9]{64}$/i.test(item.commercialReview.imageSha256)) missingSetup.push("creative_terms_unverified");
    }
    try {
      const access = await this.connection.access(merchantId, { destination: campaign.draft.destination, operation: "prepare" });
      if (campaign.remoteCampaignId && campaign.remoteAccountId !== access.accountId) missingSetup.push("meta_asset_forbidden");
    } catch (error) { missingSetup.push(error instanceof MetaAdsError ? error.code : "meta_connection_required"); }
    const metrics = state.metrics[campaignId];
    if (!metrics?.paidOrders) missingData.push("confirmed_purchases_required");
    if (["cost_per_purchase", "roas", "contribution"].includes(campaign.draft.priority) && metrics?.spendCents == null) missingData.push("ad_spend_required");
    if (campaign.draft.priority === "roas" && metrics?.attributedRevenueCents == null) missingData.push("attributed_revenue_required");
    if (campaign.draft.priority === "contribution" && metrics?.costCoverage !== "complete") missingData.push("historical_cost_required");
    return { campaign, missingData, missingSetup: [...new Set(missingSetup)], ready: missingSetup.length === 0 };
  }
  async assertReady(merchantId: string, campaignId: string): Promise<MetaAdsCampaignReadiness> {
    const result = await this.readiness(merchantId, campaignId);
    if (!result.ready) throw new MetaAdsError(result.missingSetup[0], 409);
    return result;
  }
  async existing(merchantId: string) {
    const access = await this.connection.access(merchantId);
    return (await this.provider.existingCampaigns(access)).map(campaign => ({ ...campaign, createdByAgent: false as const, managed: false as const, readOnly: true as const }));
  }
  async stopManaging(merchantId: string, campaignId: string): Promise<MetaAdsCampaign> {
    return this.repo.mutate(merchantId, [`campaign-origin:${campaignId}`], (state, records) => {
      const campaign = this.origin(state, campaignId, records.get(`campaign-origin:${campaignId}`)); campaign.managed = false;
      for (const proposal of Object.values(state.proposals)) if (proposal.campaignId === campaignId && ["pending_review", "approved"].includes(proposal.status)) proposal.status = "stale";
      return { result: campaign };
    });
  }
}
