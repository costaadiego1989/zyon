import type {MetaAdsCampaign,MetaAdsMedia,MetaAdsProduct} from '@zyon/shared-types';
import {MetaAdsError} from './types.js';
import {requireIdentifier,stableDigest} from './offer.js';
import {assertCommercialTerms,normalizeCampaignDraft} from './campaign-draft.js';

/** Request freshness includes business data; it is not a financial approval. */
export function campaignPreparationDigest(campaign:MetaAdsCampaign):string {
  return stableDigest({draft:normalizeCampaignDraft(campaign.draft),products:[...campaign.products].sort((a,b)=>a.variantId.localeCompare(b.variantId))});
}

/** A budget correction or our own media selection never requests another paid image. */
export function campaignPreparationIntent(merchantId:string,campaign:MetaAdsCampaign,imageCount:number):string {
  requireIdentifier(merchantId);requireIdentifier(campaign.id);
  if(!Number.isSafeInteger(imageCount)||imageCount<1||imageCount>10)throw new MetaAdsError('image_count_invalid');
  const draft=normalizeCampaignDraft(campaign.draft);
  const brief={name:draft.name,destination:draft.destination,priority:draft.priority,variantIds:draft.variantIds,headline:draft.headline,primaryText:draft.primaryText,country:draft.country};
  const products=campaign.products.map(p=>({productId:p.productId,variantId:p.variantId,commercialVersion:p.commercialVersion})).sort((a,b)=>a.variantId.localeCompare(b.variantId));
  return stableDigest({merchantId,campaignId:campaign.id,imageCount,brief,products});
}

export interface CampaignPreparationContent {ready:boolean;missing:string[];reusableMediaIds:string[];}
const sellable=(p:MetaAdsProduct)=>p.active&&(p.stockQuantity===null||p.stockQuantity>0)&&p.currency==='BRL'&&Number.isSafeInteger(p.priceCents)&&p.priceCents>=0;
function verifiedMedia(campaignId:string,media:MetaAdsMedia,products:MetaAdsProduct[]):boolean {
  const product=products.find(p=>p.variantId===media.variantId&&p.productId===media.productId);
  if(media.campaignId!==campaignId||!product||!sellable(product)||media.productVersion!==product.commercialVersion||media.commercialReview?.status!=='verified'||media.commercialReview.productVersion!==product.commercialVersion||!/^[a-f0-9]{64}$/i.test(media.commercialReview.imageSha256))return false;
  try{const url=new URL(media.url);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}

/** Content readiness is combined with current actor/connection/entitlement in the services. */
export function campaignPreparationContent(campaign:MetaAdsCampaign,products:MetaAdsProduct[],media:MetaAdsMedia[]):CampaignPreparationContent {
  const draft=normalizeCampaignDraft(campaign.draft),missing:string[]=[];
  if(!draft.budget)missing.push('campaign_budget_required');
  if(!draft.headline||!draft.primaryText)missing.push('creative_copy_required');
  if(!draft.mediaIds.length)missing.push('campaign_media_required');
  if(products.length!==draft.variantIds.length||new Set(products.map(p=>p.variantId)).size!==products.length||draft.variantIds.some(id=>!products.some(p=>p.variantId===id))||products.some(p=>!sellable(p)))missing.push('campaign_products_unavailable');
  if(products.some(p=>!campaign.products.some(old=>old.variantId===p.variantId&&old.productId===p.productId&&old.commercialVersion===p.commercialVersion)))missing.push('campaign_products_changed');
  try{assertCommercialTerms(draft,products);}catch{missing.push('creative_terms_mismatch');}
  const reusable=media.filter(item=>verifiedMedia(campaign.id,item,products)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const valid=new Set(reusable.map(item=>item.id));
  for(const id of draft.mediaIds)if(!valid.has(id)){
    const item=media.find(m=>m.id===id);
    missing.push(item&&item.campaignId===campaign.id?'creative_terms_unverified':'campaign_media_unavailable');
  }
  const reasons=[...new Set(missing)];
  return {ready:reasons.length===0,missing:reasons,reusableMediaIds:reusable.map(item=>item.id)};
}
