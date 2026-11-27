import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {MetaAdsCampaign,MetaAdsMedia,MetaAdsProduct} from '@zyon/shared-types';
import {campaignPreparationContent,campaignPreparationDigest,campaignPreparationIntent} from './campaign-preparation.js';

function fixture(){
  const product:MetaAdsProduct={productId:'product-a',variantId:'variant-a',name:'Camisa',description:'Algodao',sku:'CA',imageUrl:'https://media.example.test/source.png',priceCents:9900,currency:'BRL',stockQuantity:8,active:true,storefrontUrl:'https://store.example.test/camisa',commercialVersion:'commercial-a'};
  const campaign:MetaAdsCampaign={id:'campaign-a',draft:{name:'Colecao',variantIds:['variant-a'],destination:'store',priority:'paid_sales',country:'BR',headline:'Camisa para o dia a dia',primaryText:'Conheca a colecao.',mediaIds:['media-a'],budget:{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-17T12:00:00Z',endsAt:'2026-11-24T12:00:00Z'}},products:[product],managed:true,createdByAgent:true,remoteCampaignId:null,remoteAdSetId:null,remoteAdIds:[],status:'draft',createdAt:'2026-11-17T12:00:00Z',updatedAt:'2026-11-17T12:00:00Z'};
  const media:MetaAdsMedia={id:'media-a',campaignId:campaign.id,variantId:product.variantId,productId:product.productId,url:'https://media.example.test/verified.png',productVersion:product.commercialVersion,createdAt:campaign.createdAt,commercialReview:{status:'verified',productVersion:product.commercialVersion,imageSha256:'a'.repeat(64)}};
  return {campaign,product,media};
}
test('ACAP-10 budget and date correction changes review identity without admitting another media intent',()=>{
  const {campaign}=fixture();const corrected=structuredClone(campaign);corrected.draft.budget!.amountCents=8000;corrected.draft.budget!.endsAt='2026-11-25T12:00:00Z';
  assert.equal(campaignPreparationIntent('store-a',corrected,1),campaignPreparationIntent('store-a',campaign,1));
  assert.notEqual(campaignPreparationDigest(corrected),campaignPreparationDigest(campaign));
});
test('ACAP-10 the workers own media selection and remote progress do not create another paid intent',()=>{
  const {campaign}=fixture();const selected=structuredClone(campaign);selected.draft.mediaIds=['another-media'];selected.remoteCampaignId='123';selected.status='remote_paused';
  assert.equal(campaignPreparationIntent('store-a',selected,1),campaignPreparationIntent('store-a',campaign,1));
  assert.notEqual(campaignPreparationDigest(selected),campaignPreparationDigest(campaign));
});
test('ACAP-10 intent is isolated by store campaign image count and commercial version',()=>{
  const {campaign}=fixture();const original=campaignPreparationIntent('store-a',campaign,1);
  assert.notEqual(campaignPreparationIntent('store-b',campaign,1),original);
  assert.notEqual(campaignPreparationIntent('store-a',{...campaign,id:'campaign-b'},1),original);
  assert.notEqual(campaignPreparationIntent('store-a',campaign,2),original);
  const changed=structuredClone(campaign);changed.products[0].commercialVersion='new-commercial';assert.notEqual(campaignPreparationIntent('store-a',changed,1),original);
});
test('ACAP-06 intent rejects invalid image bounds instead of inventing a paid quantity',()=>{
  const {campaign}=fixture();assert.notEqual(campaignPreparationIntent('store-a',campaign,10),campaignPreparationIntent('store-a',campaign,1));
  for(const count of [0,-1,11,1.5,NaN])assert.throws(()=>campaignPreparationIntent('store-a',campaign,count),{code:'image_count_invalid'});
});
test('ACAP-08 an equivalent JSONB read has the same draft and media intent identities',()=>{
  const {campaign}=fixture();const reordered={...campaign,draft:Object.fromEntries(Object.entries(campaign.draft).reverse()) as unknown as MetaAdsCampaign['draft']};
  assert.equal(campaignPreparationDigest(reordered),campaignPreparationDigest(campaign));assert.equal(campaignPreparationIntent('store-a',reordered,1),campaignPreparationIntent('store-a',campaign,1));
});
test('ACAP-07 budget copy and selected media are required before readiness',()=>{
  const {campaign,product}=fixture();campaign.draft.budget=null;campaign.draft.headline='';campaign.draft.mediaIds=[];
  const result=campaignPreparationContent(campaign,[product],[]);assert.equal(result.ready,false);assert.deepEqual(new Set(result.missing),new Set(['campaign_budget_required','creative_copy_required','campaign_media_required']));assert.deepEqual(result.reusableMediaIds,[]);
});
test('ACAP-07 pending unavailable or rejected media never becomes a ready review',()=>{
  const {campaign,product,media}=fixture();
  for(const review of [undefined,{...media.commercialReview!,status:'unavailable' as const},{...media.commercialReview!,status:'rejected' as const}]){
    const result=campaignPreparationContent(campaign,[product],[{...media,commercialReview:review}]);assert.equal(result.ready,false);assert.equal(result.reusableMediaIds.length,0);assert.ok(result.missing.includes('creative_terms_unverified'));
  }
});
test('ACAP-08 verified selected media produces content readiness without provider writes',()=>{
  const {campaign,product,media}=fixture();assert.deepEqual(campaignPreparationContent(campaign,[product],[media]),{ready:true,missing:[],reusableMediaIds:['media-a']});
});
test('ACAP-14 canonical catalog change or unavailable stock invalidates content readiness',()=>{
  const {campaign,product,media}=fixture();
  const changed=campaignPreparationContent(campaign,[{...product,commercialVersion:'new-commercial',priceCents:10900}],[media]);assert.equal(changed.ready,false);assert.ok(changed.missing.includes('campaign_products_changed'));assert.deepEqual(changed.reusableMediaIds,[]);
  const unavailable=campaignPreparationContent(campaign,[{...product,stockQuantity:0}],[media]);assert.equal(unavailable.ready,false);assert.ok(unavailable.missing.includes('campaign_products_unavailable'));
});
test('ACAP-14 foreign campaign media unsafe URLs and a mismatching review hash are not reusable',()=>{
  const {campaign,product,media}=fixture();
  for(const invalid of [{...media,campaignId:'campaign-b'},{...media,url:'http://media.example.test/a.png'},{...media,url:'https://secret@media.example.test/a.png'},{...media,commercialReview:{...media.commercialReview!,imageSha256:'not-a-hash'}}]){
    const result=campaignPreparationContent(campaign,[product],[invalid]);assert.equal(result.ready,false);assert.deepEqual(result.reusableMediaIds,[]);
  }
});
test('ACAP-14 carousel order changes the review while retaining the reusable generation intent',()=>{
  const {campaign,product,media}=fixture();const second={...media,id:'media-b'};campaign.draft.mediaIds=['media-a','media-b'];const reversed=structuredClone(campaign);reversed.draft.mediaIds.reverse();
  assert.notEqual(campaignPreparationDigest(reversed),campaignPreparationDigest(campaign));assert.equal(campaignPreparationIntent('store-a',reversed,2),campaignPreparationIntent('store-a',campaign,2));
  assert.equal(campaignPreparationContent(reversed,[product],[media,second]).ready,true);
});
test('ACAP-07 unsupported commercial promises cannot become a ready review',()=>{
  const {campaign,product,media}=fixture();campaign.draft.primaryText='Desconto de 50% e frete gratis.';const result=campaignPreparationContent(campaign,[product],[media]);assert.equal(result.ready,false);assert.ok(result.missing.includes('creative_terms_mismatch'));
});
