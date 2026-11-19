import assert from 'node:assert/strict';import {test} from 'node:test';
import {assistantCampaignFixture} from './__tests__/assistant-campaign-fixture.js';
import {briefingChecklist} from './campaign-briefing.js';

test('ACJ-07 a partial low budget is warned before asking dates and retains its original amount after reload',async()=>{
 const f=await assistantCampaignFixture();try{await f.at('2026-11-18T12:00:00Z');const response=await f.context.execute({...f.input,name:'merchant_ads_save_draft',origin:'model',args:{destination:'whatsapp',briefing:{budget:{amountCents:50,cadence:'daily'}}}});
 const p=await f.progress();assert.equal((response.data as any).budgetNeedsRevision,true);assert.equal(p.briefing!.budget!.amountCents,50);assert.equal(p.briefing!.budgetIssue!.minimumDailyBudgetCents,100);assert.equal(briefingChecklist(JSON.parse(JSON.stringify(p))).next,'amount');assert.equal(p.campaignId,null);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('ACJ-07 a daily budget below the live account floor stays editable and cannot admit images or a campaign',async()=>{
 const f=await assistantCampaignFixture();try{await f.at('2026-11-18T12:00:00Z');
 const save=(args:Record<string,unknown>)=>f.context.execute({...f.input,name:'merchant_ads_save_draft',origin:'model' as const,args});
 const response=await save({variantIds:['variant-a'],destination:'whatsapp',priority:'paid_sales',country:'BR',headline:'Camisa',primaryText:'Conheça a camisa',budget:{amountCents:50,currency:'BRL',cadence:'daily',startsAt:'2026-11-20T12:00:00.000Z',endsAt:'2026-11-27T12:00:00.000Z'}});
 const data=response.data as any;assert.equal(data.budgetNeedsRevision,true);assert.equal(data.budgetAssessment.minimumDailyBudgetCents,100);assert.equal(data.budgetAssessment.status,'below_account_minimum');let p=await f.progress();assert.equal(p.draft.budget!.amountCents,50);assert.equal(p.campaignId,null);assert.deepEqual(p.awaitingFields,['budget']);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.equal(Object.keys((await f.repo.read('store-a')).generations).length,0);
 await save({briefing:{budget:{amountCents:200}}});p=await f.progress();assert.ok(p.campaignId);assert.equal(p.draft.budget!.amountCents,200);assert.equal(p.draft.budget!.cadence,'daily');assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),1);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

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
