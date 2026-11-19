import type {MetaAdsMedia} from '@zyon/shared-types';import {MetaAdsError,type CatalogImagePort,type MetaAdsRepository,type CommerceContextPort,type Clock} from '../domain/types.js';
import {requireEntitlement,requireIdentifier,stableDigest} from '../domain/offer.js';
export class CatalogCreativeService{
 constructor(private readonly repo:MetaAdsRepository,private readonly commerce:Pick<CommerceContextPort,'getPlan'|'products'>,private readonly images:CatalogImagePort,private readonly clock:Clock=()=>new Date()){}
 async capture(merchantId:string,campaignId:string,count:number):Promise<string[]>{
  requireIdentifier(merchantId);requireIdentifier(campaignId);if(!Number.isSafeInteger(count)||count<1||count>10)throw new MetaAdsError('image_count_invalid');
  const snapshot=await this.repo.read(merchantId);requireEntitlement(await this.commerce.getPlan(merchantId),snapshot,this.clock());
  const campaign=snapshot.campaigns[campaignId];if(!campaign)throw new MetaAdsError('campaign_not_found',404);if(!campaign.createdByAgent||!campaign.managed)throw new MetaAdsError('campaign_read_only',403);
  const products=await this.commerce.products(merchantId,{variantIds:campaign.draft.variantIds});
  if(products.length!==campaign.draft.variantIds.length||products.some(p=>!p.active||p.stockQuantity!==null&&p.stockQuantity<=0||!p.imageUrl||!campaign.products.some(old=>old.variantId===p.variantId&&old.productId===p.productId&&old.commercialVersion===p.commercialVersion)))throw new MetaAdsError('campaign_products_changed',409);
  if(count>products.length)throw new MetaAdsError('catalog_photo_count_unavailable',409);
  const ids:string[]=[];
  for(const product of campaign.draft.variantIds.map(id=>products.find(p=>p.variantId===id)!).slice(0,count)){
   const id=`catalog-${stableDigest({merchantId,campaignId,variantId:product.variantId,version:product.commercialVersion,url:product.imageUrl})}`,state=await this.repo.read(merchantId),existing=state.media[id];
   if(existing){if(existing.source!=='catalog'||existing.canonicalImageUrl!==product.imageUrl||existing.productVersion!==product.commercialVersion)throw new MetaAdsError('catalog_photo_changed',409);ids.push(id);continue;}
   const copied=await this.images.capture({merchantId,mediaKey:id,product});
   if(copied.sourceUrl!==product.imageUrl||!/^https:\/\//.test(copied.url)||!/^[a-f0-9]{64}$/.test(copied.imageSha256))throw new MetaAdsError('catalog_photo_invalid',409);
   const fresh=await this.commerce.products(merchantId,{variantIds:[product.variantId]}),plan=await this.commerce.getPlan(merchantId);
   if(fresh.length!==1||fresh[0].commercialVersion!==product.commercialVersion||!fresh[0].active||fresh[0].stockQuantity!==null&&fresh[0].stockQuantity<=0)throw new MetaAdsError('campaign_products_changed',409);
   await this.repo.mutate(merchantId,[],current=>{requireEntitlement(plan,current,this.clock());const live=current.campaigns[campaignId];if(!live||stableDigest(live.draft)!==stableDigest(campaign.draft))throw new MetaAdsError('preparation_version_changed',409);
    const media:MetaAdsMedia={id,campaignId,variantId:product.variantId,productId:product.productId,productVersion:product.commercialVersion,url:copied.url,createdAt:this.clock().toISOString(),source:'catalog',canonicalImageUrl:product.imageUrl!,commercialReview:{status:'verified',method:'canonical_source',productVersion:product.commercialVersion,imageSha256:copied.imageSha256}};
    current.media[id]??=media;return{result:null};});ids.push(id);
  }return ids;
 }
}
