import assert from 'node:assert/strict';import {test} from 'node:test';
import {metaAssistantFixture,assistantScope} from './__tests__/assistant-fixture.js';
import {MetaAdsAssistantAdapter} from './meta-ads-assistant.adapter.js';
import {CampaignPreparationService} from './campaign-preparation.service.js';
import {campaignLaunchFixture} from './__tests__/launch-fixture.js';
import {campaignPreparationDigest} from '../domain/campaign-preparation.js';
import {assessBudget} from './budget-guidance.js';
import {InitialLaunchService} from './initial-launch.service.js';

test('FR-02 BRL10 over ten days requires a new choice before campaign or image admission',async()=>{
 const f=await metaAssistantFixture();try{await f.connect();
 const adapter=new MetaAdsAssistantAdapter({service:f.service,conversations:f.conversations,authorizeActor:async()=>{},authorizeTool:async()=>{},clock:f.clock,planningContext:async()=>({accountId:'100',currency:'BRL',minimumDailyBudgetCents:570,timezone:'America/Sao_Paulo'})});
 const budget={amountCents:1000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-20T12:00:00.000Z',endsAt:'2026-11-30T12:00:00.000Z'},args={name:'Adaptador',destination:'whatsapp',priority:'paid_sales',variantIds:['variant-a'],country:'BR',headline:'Camisa',primaryText:'Conheça a camisa',mediaIds:[],budget,briefing:{selectionKind:'product',selectionQuery:'Camisa'}};
 const response=await adapter.execute({...f.input,name:'merchant_ads_save_draft',origin:'model',args});const value=response.data as any,progress=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!;
 assert.equal(value.budgetNeedsRevision,true);assert.equal(value.budgetAssessment.dailyEquivalentCents,100);assert.equal(value.budgetAssessment.estimatedMinimumTotalCents,5700);assert.deepEqual(progress.draft.budget,budget);assert.equal(progress.campaignId,null);assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length,0);assert.equal(f.physicalImages(),0);
 const reply=adapter.guidedResponse({message:'Brasil',suggestedReply:'Tudo pronto',campaign:progress,evidence:[{name:'merchant_ads_save_draft',result:response}]});assert.match(reply!,/1,00/);assert.match(reply!,/57,00/);assert.match(reply!,/ajustar|reduzir/);assert.equal((reply!.match(/\?/g)??[]).length,1);
 const corrected=await adapter.execute({...f.input,name:'merchant_ads_save_draft',origin:'model',args:{budget:{...budget,amountCents:5700}}});assert.ok((corrected.data as any).progress.campaignId);assert.equal((corrected.data as any).progress.draft.budget.amountCents,5700);assert.equal((corrected.data as any).progress.briefing?.budgetIssue,undefined);assert.equal(f.physicalImages(),0);
 }finally{await f.close();}
});

test('FR-02 resuming an existing low lifetime draft blocks preparation before image credits or proposals',async()=>{
 const f=await campaignLaunchFixture();try{const current=await f.service.campaigns.owned('store-a',f.campaignId),budget={amountCents:1000,currency:'BRL' as const,cadence:'lifetime' as const,startsAt:'2026-11-20T12:00:00.000Z',endsAt:'2026-11-30T12:00:00.000Z'};
 const saved=await f.service.campaigns.save('store-a',f.campaignId,{...current.draft,budget}),before=await f.repo.read('store-a');
 const service=new CampaignPreparationService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,connection:f.service.connection,preparations:f.preparations,authorizeActor:f.authorizeActor,enabled:()=>true,clock:f.clock,budgetAssessment:async()=>assessBudget(budget,{accountId:'100',currency:'BRL',minimumDailyBudgetCents:570},f.clock().toISOString())});
 const job=await service.request('store-a','owner-a',f.campaignId,{campaignDigest:campaignPreparationDigest(saved),imageCount:1});assert.equal(job.status,'blocked');assert.ok(job.missing.includes('campaign_budget_below_period_minimum'));const after=await f.repo.read('store-a');assert.deepEqual(after.credits,before.credits);assert.deepEqual(after.generations,before.generations);assert.deepEqual(after.proposals,before.proposals);assert.equal(f.calls.includes('launch'),false);
 const view=await service.read('store-a','owner-a',f.campaignId);assert.equal(view.budgetAssessment?.dailyEquivalentCents,100);assert.equal(view.budgetAssessment?.estimatedMinimumTotalCents,5700);
 }finally{await f.close();}
});

test('FR-02 final approval rechecks the account constraint and cannot publish a previously prepared low budget',async()=>{
 const f=await campaignLaunchFixture();try{const proposal=await f.propose('launch'),campaign=await f.service.campaigns.owned('store-a',f.campaignId);
 const assessment=assessBudget(campaign.draft.budget!,{accountId:'100',currency:'BRL',minimumDailyBudgetCents:50000},f.clock().toISOString());
 const service=new InitialLaunchService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,proposals:f.service.proposals,executions:f.executions,preparations:f.preparations,notices:f.notices,authorizeActor:f.authorizeActor,enabled:()=>true,clock:f.clock,budgetAssessment:async()=>assessment});
 const view=await service.review('store-a','owner-a',f.campaignId,proposal.id);assert.equal(view.canApprove,false);assert.ok(view.missing.includes('campaign_budget_below_period_minimum'));
 await assert.rejects(service.approveAndLaunch('store-a','owner-a',f.campaignId,proposal.id,{digest:proposal.digest,idempotencyKey:'low-budget-click'}),{code:'campaign_budget_below_period_minimum'});
 assert.equal((await f.repo.read('store-a')).proposals[proposal.id].status,'pending_review');assert.equal((await f.repo.read('store-a')).proposals[proposal.id].executionId,null);assert.equal(f.calls.includes('launch'),false);
 }finally{await f.close();}
});
