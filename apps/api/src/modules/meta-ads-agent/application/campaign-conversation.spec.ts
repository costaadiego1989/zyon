import assert from 'node:assert/strict';import {test} from 'node:test';
import {assistantCampaignFixture} from './__tests__/assistant-campaign-fixture.js';

test('ACJ-01 a completed conversational briefing requires agent copy then prepares one campaign for administrative review',async()=>{
 const f=await assistantCampaignFixture();try{
 await f.at('2026-11-18T12:00:00Z');
 const save=(args:Record<string,unknown>)=>f.context.execute({...f.input,name:'merchant_ads_save_draft',origin:'model' as const,args});
 const awaitingCopy=await save({planningKind:'campaign',variantIds:['variant-a'],destination:'whatsapp',priority:'paid_sales',country:'BR',budget:{amountCents:12000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-20T12:00:00.000Z',endsAt:'2026-11-27T12:00:00.000Z'}});
 assert.equal((awaitingCopy.data as any).copyRequired,true);assert.deepEqual((awaitingCopy.data as any).products.map((p:any)=>({id:p.variantId,name:p.name})),[{id:'variant-a',name:'Camisa'}]);assert.equal((await f.progress()).campaignId,null);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);
 await save({headline:'Camisa de algodão',primaryText:'Conheça nossa camisa e converse com a loja pelo WhatsApp.'});
 const p=await f.progress();assert.ok(p.campaignId);assert.deepEqual(p.awaitingFields,[]);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),1);
 await f.verifyMedia(p.campaignId!);await f.runtime.preparationWorker.drain();const review=await f.runtime.launches.review('store-a','owner-a',p.campaignId!);
 assert.equal(review.proposal.status,'pending_review');assert.equal(review.campaign.draft.headline,'Camisa de algodão');assert.equal(review.campaign.draft.primaryText,'Conheça nossa camisa e converse com a loja pelo WhatsApp.');assert.equal(review.campaign.draft.budget!.amountCents,12000);assert.equal(review.campaign.draft.destination,'whatsapp');assert.deepEqual(review.media.map(m=>m.id),['brief-media']);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});
