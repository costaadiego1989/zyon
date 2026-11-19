import { randomUUID } from "node:crypto";
import type { MetaAdsCampaign, MetaAdsGeneration, MetaAdsMedia } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type ImageGenerationPort, type GeneratedImageResult, type ImageUsage, type TextModelUsage, type MetaAdsStoreState, type Clock, type IdFactory, type MetaAdsRecord } from "../domain/types.js";
import { requireEntitlement, requireIdentifier, stableDigest } from "../domain/offer.js";
import { reserveCredits, settleCredits } from "./credits.service.js";
import type {GenerationAuthorizer,PreparationGenerationAuthority} from '../domain/types.js';

interface FrozenGeneration { campaign: MetaAdsCampaign; count: number; authority?:PreparationGenerationAuthority; }
const reservationKey = (generationId: string, index: number) => `${generationId}-${index}`;
function safeUsage(raw?: ImageUsage): ImageUsage {
  const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const model = typeof raw?.model === "string" && /^gpt-image-[A-Za-z0-9.-]{1,120}$/.test(raw.model) ? raw.model : "unknown";
  const cost = typeof raw?.costMicros === "string" && /^\d{1,24}$/.test(raw.costMicros) && (raw.costStatus === "estimated" || raw.costStatus === "provider_reported") && /^[A-Z]{3}$/.test(raw.currency ?? "") ? raw.costMicros : null;
  return { provider: raw?.provider === "openai" ? "openai" : "unknown", model,
    providerRequestId: typeof raw?.providerRequestId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(raw.providerRequestId) ? raw.providerRequestId : null,
    inputTextTokens: tokens(raw?.inputTextTokens), inputImageTokens: tokens(raw?.inputImageTokens), outputImageTokens: tokens(raw?.outputImageTokens),
    costMicros: cost, currency: cost !== null ? raw!.currency : null, costStatus: cost === null ? "unpriced" : raw!.costStatus };
}
function generation(state: MetaAdsStoreState, id: string): MetaAdsGeneration {
  if (!Object.hasOwn(state.generations, id)) throw new MetaAdsError("generation_not_found", 404);
  return state.generations[id];
}
function safeReviewUsage(raw: TextModelUsage): TextModelUsage {
  const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const cost = typeof raw.costMicros === "string" && /^\d{1,24}$/.test(raw.costMicros) && ["estimated", "provider_reported"].includes(raw.costStatus) && /^[A-Z]{3}$/.test(raw.currency ?? "") ? raw.costMicros : null;
  return { provider: raw.provider === "openai" ? "openai" : "unknown", model: /^gpt-[A-Za-z0-9.-]{1,120}$/.test(raw.model) ? raw.model : "unknown",
    providerRequestId: raw.providerRequestId && /^[A-Za-z0-9_-]{1,160}$/.test(raw.providerRequestId) ? raw.providerRequestId : null,
    inputTokens: tokens(raw.inputTokens), cachedInputTokens: tokens(raw.cachedInputTokens), outputTokens: tokens(raw.outputTokens),
    costMicros: cost, currency: cost !== null ? raw.currency : null, costStatus: cost === null ? "unpriced" : raw.costStatus };
}
function finish(state: MetaAdsStoreState, value: MetaAdsGeneration): void {
  const pending = Array.from({ length: value.requestedImages }, (_, i) => state.credits.reservations[reservationKey(value.id, i)]).some(reservation => reservation?.status === "unknown");
  value.status = pending ? "unknown" : value.mediaIds.length === value.requestedImages ? "succeeded" : value.mediaIds.length ? "partial" : "failed";
  value.error = pending ? "image_provider_outcome_unknown" : value.status === "succeeded" ? null : ["creative_terms_mismatch", "creative_review_unavailable"].includes(value.error ?? "") ? value.error : "image_generation_incomplete";
}

export class GenerationService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan" | "products">,
    private readonly images: ImageGenerationPort, private readonly clock: Clock = () => new Date(), private readonly id: IdFactory = randomUUID,private readonly authorize?:GenerationAuthorizer) {}
  configured():boolean{return this.images.configured();}

  async request(merchantId: string, campaignId: string, input: { imageCount: number; idempotencyKey: string },authority?:PreparationGenerationAuthority): Promise<MetaAdsGeneration> {
    requireIdentifier(input.idempotencyKey);
    if(authority){requireIdentifier(authority.preparationId);if(Object.keys(authority).length!==2||!/^[a-f0-9]{64}$/.test(authority.intentDigest)||!this.authorize)throw new MetaAdsError('generation_authority_unavailable',409);}
    if (!Number.isSafeInteger(input.imageCount) || input.imageCount < 1 || input.imageCount > 10) throw new MetaAdsError("image_count_invalid");
    const plan = await this.commerce.getPlan(merchantId); const snapshot = await this.repo.read(merchantId);
    requireEntitlement(plan, snapshot, this.clock());
    const requestKey = `generation-request:${input.idempotencyKey}`;
    const repeated = (record: MetaAdsRecord, state: MetaAdsStoreState) => {
      const value = record.payload as { id: string; campaignId: string; count: number;authorityDigest?:string };
      if (value.campaignId !== campaignId || value.count !== input.imageCount || (value.authorityDigest??null)!==(authority?stableDigest(authority):null)) throw new MetaAdsError("generation_request_conflict", 409);
      return generation(state, value.id);
    };
    const existing = await this.repo.getRecord(merchantId, requestKey);
    if (existing) return repeated(existing, snapshot);
    if (!this.images.configured()) throw new MetaAdsError("image_provider_not_configured", 503);
    const campaign = Object.hasOwn(snapshot.campaigns, campaignId) ? snapshot.campaigns[campaignId] : null;
    if (!campaign) throw new MetaAdsError("campaign_not_found", 404);
    if (!campaign.createdByAgent || !campaign.managed) throw new MetaAdsError("campaign_read_only", 403);
    const products = await this.commerce.products(merchantId, { variantIds: campaign.draft.variantIds });
    if (!products.length || products.length !== campaign.draft.variantIds.length || products.some(p => !p.active || (p.stockQuantity !== null && p.stockQuantity <= 0) || !p.imageUrl || !campaign.draft.variantIds.includes(p.variantId))) throw new MetaAdsError("campaign_products_unavailable", 409);
    const frozen: FrozenGeneration = { campaign: { ...structuredClone(campaign), products: structuredClone(products) }, count: input.imageCount,...(authority?{authority:structuredClone(authority)}:{}) };
    if(authority)await this.authorize!(merchantId,authority,frozen.campaign);
    return this.repo.mutate(merchantId, [requestKey], (state, records) => {
      requireEntitlement(plan, state, this.clock());
      if (records.has(requestKey)) return { result: repeated(records.get(requestKey)!, state) };
      if (!Object.hasOwn(state.campaigns, campaignId) || stableDigest(state.campaigns[campaignId].draft) !== stableDigest(campaign.draft)) throw new MetaAdsError("generation_campaign_changed", 409);
      const id = requireIdentifier(this.id()); const now = this.clock().toISOString();
      for (let i = 0; i < input.imageCount; i++) reserveCredits(state, reservationKey(id, i), 1, this.clock());
      const value: MetaAdsGeneration = { id, campaignId, requestedImages: input.imageCount, status: "reserved", mediaIds: [], error: null, createdAt: now, updatedAt: now };
      state.generations[id] = value;
      return { result: value, records: [{ key: requestKey, kind: "generation", payload: { id, campaignId, count: input.imageCount,...(authority?{authorityDigest:stableDigest(authority)}:{}) }, createdAt: now }, { key: `generation:${id}`, kind: "generation", payload: frozen, createdAt: now }] };
    });
  }
  private releaseRemaining(state: MetaAdsStoreState, value: MetaAdsGeneration, from: number): void {
    for (let i = from; i < value.requestedImages; i++) {
      const key = reservationKey(value.id, i);
      if (state.credits.reservations[key]?.status === "reserved") settleCredits(state, key, 0);
    }
  }
  async run(merchantId: string, generationId: string): Promise<MetaAdsGeneration> {
    const snapshot=await this.repo.read(merchantId);if(generation(snapshot,generationId).status!=='reserved')return generation(snapshot,generationId);
    const admission=(await this.repo.getRecord<FrozenGeneration>(merchantId,`generation:${generationId}`))?.payload;
    if(admission?.authority){if(!this.authorize)throw new MetaAdsError('generation_authority_unavailable',409);await this.authorize(merchantId,admission.authority,admission.campaign);}
    const plan = await this.commerce.getPlan(merchantId);
    const claim = await this.repo.mutate<{ value: MetaAdsGeneration; frozen: FrozenGeneration | null }>(merchantId, [`generation:${generationId}`], (state, records) => {
      const value = generation(state, generationId);
      if (value.status !== "reserved") return { result: { value, frozen: null } };
      try { requireEntitlement(plan, state, this.clock()); } catch {
        this.releaseRemaining(state, value, 0); finish(state, value); value.updatedAt = this.clock().toISOString();
        return { result: { value, frozen: null } };
      }
      const frozen = records.get(`generation:${generationId}`)?.payload as FrozenGeneration | undefined;
      if (!frozen) throw new MetaAdsError("generation_input_missing", 500);
      value.status = "running"; value.updatedAt = this.clock().toISOString();
      return { result: { value, frozen } };
    });
    if (!claim.frozen) return claim.value;
    const frozen = claim.frozen;
    for (let index = 0; index < frozen.count; index++) {
      if(frozen.authority){
        try{if(!this.authorize)throw new MetaAdsError('generation_authority_unavailable',409);await this.authorize(merchantId,frozen.authority,frozen.campaign);}
        catch{await this.repo.mutate(merchantId,[],state=>{const value=generation(state,generationId);this.releaseRemaining(state,value,index);finish(state,value);return{result:null};});break;}
      }
      const currentPlan = await this.commerce.getPlan(merchantId);
      const attemptKey = `generation-attempt:${generationId}:${index}`;
      const allowed = await this.repo.mutate(merchantId, [attemptKey], (state, records) => {
        const value = generation(state, generationId);
        if (value.status !== "running" || records.has(attemptKey)) return { result: false };
        try { requireEntitlement(currentPlan, state, this.clock()); } catch {
          this.releaseRemaining(state, value, index); finish(state, value); value.updatedAt = this.clock().toISOString(); return { result: false };
        }
        value.updatedAt = this.clock().toISOString();
        return { result: true, records: [{ key: attemptKey, kind: "generation", payload: { generationId, imageIndex: index, status: "sending" }, createdAt: this.clock().toISOString() }] };
      });
      if (!allowed) break;
      let result: GeneratedImageResult;
      try {
        const assertAuthorized=frozen.authority?()=>this.authorize!(merchantId,frozen.authority!,frozen.campaign):undefined;
        try{await assertAuthorized?.();}catch{result={status:'failed',url:null,error:'generation_authority_unavailable',usage:safeUsage()};await this.recordOutcome(merchantId,generationId,index,frozen,result);await this.repo.mutate(merchantId,[],state=>{this.releaseRemaining(state,generation(state,generationId),index+1);return{result:null};});break;}
        result = await this.images.generate({ merchantId, generationId, imageIndex: index, product: frozen.campaign.products[index % frozen.campaign.products.length], brief: frozen.campaign.draft,...(assertAuthorized?{assertAuthorized}:{}) });
      }
      catch { result = { status: "unknown", url: null, error: "image_provider_outcome_unknown", usage: safeUsage() }; }
      await this.recordOutcome(merchantId, generationId, index, frozen, result);
      if (result.status === "unknown") break;
    }
    return this.repo.mutate(merchantId, [], state => {
      const value = generation(state, generationId);
      if (value.status === "running") { finish(state, value); value.updatedAt = this.clock().toISOString(); }
      return { result: value };
    });
  }
  private async recordOutcome(merchantId: string, generationId: string, index: number, frozen: FrozenGeneration, result: GeneratedImageResult, evidence?: { actorId: string; sha256: string }): Promise<void> {
    const key = `usage:${generationId}:${index}${evidence ? ":reconciled" : ""}`;
    const recoveredKey = `usage:${generationId}:${index}:recovered`;
    await this.repo.mutate(merchantId, [key, recoveredKey], (state, records) => {
      if (records.has(key)) return { result: undefined };
      const value = generation(state, generationId); const product = frozen.campaign.products[index % frozen.campaign.products.length];
      let usable = result.status === "succeeded" && Boolean(result.url);
      if (usable) { try { const url = new URL(result.url!); usable = url.protocol === "https:" && !url.username && !url.password; } catch { usable = false; } }
      if (result.commercialReview && (result.commercialReview.status !== "verified" || result.commercialReview.productVersion !== product.commercialVersion || !/^[a-f0-9]{64}$/i.test(result.commercialReview.imageSha256))) usable = false;
      const outcome = result.status === "unknown" ? "unknown" : usable ? "succeeded" : "failed";
      if (usable) {
        const media: MetaAdsMedia = { id: this.id(), campaignId: value.campaignId, productId: product.productId, variantId: product.variantId, productVersion: product.commercialVersion, url: result.url!, createdAt: this.clock().toISOString() };
        if (result.commercialReview) media.commercialReview = { status: result.commercialReview.status, productVersion: result.commercialReview.productVersion, imageSha256: result.commercialReview.imageSha256 };
        state.media[media.id] = media; value.mediaIds.push(media.id);
      }
      if (["creative_terms_mismatch", "creative_review_unavailable"].includes(result.error ?? "")) value.error = result.error;
      const reservation = state.credits.reservations[reservationKey(generationId, index)];
      if (outcome === "unknown") { reservation.status = "unknown"; this.releaseRemaining(state, value, index + 1); value.status = "unknown"; value.error = "image_provider_outcome_unknown"; }
      else settleCredits(state, reservationKey(generationId, index), usable ? 1 : 0);
      value.updatedAt = this.clock().toISOString();
      if (evidence || value.status === "unknown") finish(state, value);
      const usage = safeUsage(result.usage);
      const correction = evidence ? `usage:${generationId}:${index}` : records.has(recoveredKey) ? recoveredKey : null;
      const entries: MetaAdsRecord[] = [{ key, kind: "usage", payload: { generationId, imageIndex: index, component: "image_generation", outcome, usage, ...(correction ? { correctsUsageKey: correction } : {}) }, createdAt: this.clock().toISOString() }];
      for (const [reviewIndex, reviewUsage] of (result.reviewUsage ?? []).entries()) entries.push({ key: `${key}:review:${reviewIndex}`, kind: "usage", payload: { generationId, imageIndex: index, component: "creative_review", outcome: result.commercialReview?.status ?? "unavailable", usage: safeReviewUsage(reviewUsage) }, createdAt: this.clock().toISOString() });
      if (evidence) entries.push({ key: `generation-reconciled:${generationId}:${index}`, kind: "audit", payload: { actorId: evidence.actorId, sha256: evidence.sha256, generationId, imageIndex: index }, createdAt: this.clock().toISOString() });
      return { result: undefined, records: entries };
    });
  }
  /** Server operations only, backed by reviewed provider evidence; never bind this method to a merchant request body. */
  async reconcileResult(merchantId: string, generationId: string, index: number, result: GeneratedImageResult, evidence: { actorId: string; sha256: string }): Promise<MetaAdsGeneration> {
    requireIdentifier(evidence.actorId);
    if (!/^[a-f0-9]{64}$/i.test(evidence.sha256) || result.status === "unknown") throw new MetaAdsError("generation_evidence_required", 409);
    const state = await this.repo.read(merchantId); const value = generation(state, generationId);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.requestedImages || state.credits.reservations[reservationKey(generationId, index)]?.status !== "unknown") throw new MetaAdsError("generation_not_unknown", 409);
    const frozen = (await this.repo.getRecord<FrozenGeneration>(merchantId, `generation:${generationId}`))?.payload;
    if (!frozen) throw new MetaAdsError("generation_input_missing", 500);
    await this.recordOutcome(merchantId, generationId, index, frozen, result, evidence);
    return generation(await this.repo.read(merchantId), generationId);
  }
  async recoverStalled(merchantId: string, generationId: string, before: Date): Promise<MetaAdsGeneration> {
    const keys = Array.from({ length: 10 }, (_, i) => `generation-attempt:${generationId}:${i}`);
    return this.repo.mutate(merchantId, keys, (state, records) => {
      const value = generation(state, generationId);
      if (value.status !== "running" || new Date(value.updatedAt) >= before) return { result: value };
      const entries: MetaAdsRecord[] = [];
      for (let index = 0; index < value.requestedImages; index++) {
        const key = reservationKey(generationId, index); const reservation = state.credits.reservations[key];
        if (reservation.status !== "reserved") continue;
        if (records.has(`generation-attempt:${generationId}:${index}`)) {
          reservation.status = "unknown";
          entries.push({ key: `usage:${generationId}:${index}:recovered`, kind: "usage", payload: { generationId, imageIndex: index, outcome: "unknown", usage: safeUsage() }, createdAt: this.clock().toISOString() });
        }
        else settleCredits(state, key, 0);
      }
      finish(state, value); value.updatedAt = this.clock().toISOString();
      return { result: value, records: entries };
    });
  }
}
