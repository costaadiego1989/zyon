import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_TOOLS } from '../../ai-governance/ai-access-policy.js';
import { assistantProduct, assistantScope, metaAssistantFixture } from './__tests__/assistant-fixture.js';
import { MetaAdsAssistantAdapter } from './meta-ads-assistant.adapter.js';
import { PrismaDailyObservationRepository } from '../infrastructure/prisma-daily-observation.repository.js';
import { latestClosedObservationDay } from '../domain/daily-observation-calendar.js';
import {assistantCampaignFixture} from './__tests__/assistant-campaign-fixture.js';

const brief={name:'Camisa da loja',variantIds:['variant-a'],destination:'store',priority:'roas',country:'BR',budget:{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'},headline:'Camisa',primaryText:'Conheça a camisa da loja'};

test('ACF-05 partial briefing assembles only a fully validated budget and cannot inject completion or authority',async()=>{const f=await metaAssistantFixture();try{
  await f.call('merchant_ads_save_draft',{destination:'store',briefing:{budget:{amountCents:10000}}});
  await f.call('merchant_ads_save_draft',{briefing:{budget:{cadence:'lifetime',startText:'Dia 20'}}});
  let progress=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!;
  assert.equal(progress.draft.budget,null);assert.equal(progress.briefing!.budget!.amountCents,10000);assert.equal(progress.briefing!.budget!.startText,'Dia 20');assert.ok(progress.awaitingFields.includes('budget'));
  for(const briefing of [{approved:true},{complete:true},{capturedTurnId:'foreign'},{answers:{destination:'approved'}},{productOptions:[{variantId:'foreign',name:'Fake'}]},{budget:{amountCents:0}},{budget:{startsAt:'tomorrow'}}])await assert.rejects(f.call('merchant_ads_save_draft',{briefing}),{code:'assistant_tool_arguments_invalid'});
  await f.call('merchant_ads_save_draft',{briefing:{budget:{startsAt:'2026-11-20T12:00:00Z',endsAt:'2026-11-27T12:00:00Z'}}});
  progress=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!;
  assert.deepEqual(progress.draft.budget,{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-20T12:00:00.000Z',endsAt:'2026-11-27T12:00:00.000Z'});assert.equal(progress.campaignId,null);assert.equal(progress.approvalPreference,'manual');assert.deepEqual((await f.repo.read('store-a')).campaigns,{});
}finally{await f.close();}});

test('ACF-05 automatic answer capture respects revoked tools expired leases foreign scope and dispatched outcomes',async()=>{const f=await metaAssistantFixture();try{
  await f.call('merchant_ads_save_draft',{destination:'store'});await f.sql.query('UPDATE merchant_assistant_turns SET message=$1 WHERE id=$2',['No WhatsApp',f.turn.id]);const before=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress;
  const denied=new MetaAdsAssistantAdapter({service:f.service,conversations:f.conversations,authorizeActor:scope=>f.adapter.authorize(scope),authorizeTool:async()=>{throw Object.assign(new Error('assistant_forbidden'),{code:'assistant_forbidden'});},clock:f.clock});
  await assert.rejects(denied.prepareTurn(f.input),{code:'assistant_forbidden'});await assert.rejects(f.adapter.prepareTurn({...f.input,scope:{...assistantScope,merchantId:'store-b'}}));
  await f.conversations.atomic(assistantScope,f.thread.id,async tx=>{await tx.update(f.turn.id,{providerRequests:[{key:'sent',kind:'model',status:'unknown'}]});});
  await f.adapter.prepareTurn(f.input);assert.deepEqual((await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress,before);
  f.setNow('2026-11-16T12:02:00Z');await assert.rejects(f.adapter.prepareTurn(f.input),{code:'assistant_lease_lost'});assert.deepEqual((await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress,before);
}finally{await f.close();}});
test('ACF-05 ordinal product identity survives duplicate names reordered searches and cannot be forged by the model',async()=>{const f=await metaAssistantFixture();try{
  const products=[{...assistantProduct,variantId:'variant-a'},{...assistantProduct,variantId:'variant-b'}];let reversed=false;
  f.commerce.products=async(_merchant,input)=>input?.variantIds?products.filter(product=>input.variantIds!.includes(product.variantId)):reversed?[...products].reverse():products;
  await f.call('merchant_ads_save_draft',{destination:'store'});await f.call('merchant_ads_catalog',{query:'Camisa'});
  await f.sql.query('UPDATE merchant_assistant_turns SET message=$1 WHERE id=$2',['o segundo',f.turn.id]);await f.adapter.prepareTurn(f.input);
  reversed=true;await f.call('merchant_ads_catalog',{query:'Camisa'});
  let progress=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!;assert.equal(progress.briefing!.selectedVariantId,'variant-b');assert.equal(f.adapter.checklist(progress).selection.selectedVariantId,'variant-b');
  await assert.rejects(f.call('merchant_ads_save_draft',{variantIds:['variant-a']}),{code:'assistant_selection_mismatch'});
  await assert.rejects(f.call('merchant_ads_save_draft',{briefing:{selectedVariantId:'variant-a'}}),{code:'assistant_tool_arguments_invalid'});
  await f.call('merchant_ads_save_draft',{variantIds:['variant-b']});progress=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!;assert.deepEqual(progress.draft.variantIds,['variant-b']);assert.deepEqual((await f.repo.read('store-a')).campaigns,{});
}finally{await f.close();}});
test('ACF-05 contradictory full and partial budgets are rejected without discarding the correction',async()=>{const f=await metaAssistantFixture();try{
  await f.call('merchant_ads_save_draft',{budget:brief.budget});const before=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress;
  await assert.rejects(f.call('merchant_ads_save_draft',{budget:brief.budget,briefing:{budget:{startText:'Dia 22'}}}),{code:'assistant_tool_arguments_invalid'});
  assert.deepEqual((await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress,before);
  await f.call('merchant_ads_save_draft',{briefing:{budget:{startText:'Dia 22'}}});const progress=(await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!;assert.equal(progress.draft.budget,null);assert.equal(progress.briefing!.budget!.startText,'Dia 22');assert.equal(progress.briefing!.budget!.startsAt,undefined);assert.equal(progress.briefing!.budget!.amountCents,10000);
}finally{await f.close();}});
test('ACF-04 an ambiguous amount is clarified before dates when a model asks both at once',async()=>{const f=await metaAssistantFixture();try{const campaign={campaignId:null,draft:{variantIds:['variant-a'],destination:'store' as const,priority:'paid_sales' as const,country:'BR'},awaitingFields:['budget'],approvalPreference:'manual' as const};assert.equal(f.adapter.uncitedResponse({suggestedReply:'Esse orçamento é diário ou total? Quais são as datas de início e término?',campaign,evidence:[]}), 'Esse valor é por dia ou para todo o período?');assert.equal(f.adapter.uncitedResponse({suggestedReply:'Em que dia você quer encerrar a campanha?',campaign,evidence:[]}), 'Até que dia a campanha deve ficar no ar?');}finally{await f.close();}});
test('ACF-03 an unscoped catalog request never reads inventory and filtered suggestions are bounded',async()=>{const f=await metaAssistantFixture();try{const queries:unknown[]=[];f.commerce.products=async(merchantId,input)=>{queries.push({merchantId,...input});return Array.from({length:10000},(_,i)=>({...assistantProduct,variantId:'v'+i,name:'Produto '+i}));};assert.deepEqual((await f.call('merchant_ads_catalog')).data,{selectionRequired:true,products:[],hasMore:false});assert.deepEqual(queries,[]);const data=(await f.call('merchant_ads_catalog',{categoryId:'category-a',query:'som'})).data as any;assert.equal(data.products.length,3);assert.deepEqual(data.products.map((p:any)=>p.name),['Produto 0','Produto 1','Produto 2']);assert.equal(data.hasMore,true);assert.deepEqual(queries,[{merchantId:'store-a',categoryId:'category-a',query:'som',limit:4}]);assert.deepEqual((await f.repo.read('store-a')).campaigns,{});}finally{await f.close();}});
test('ACF-03 category discovery is merchant scoped, bounded and does not read products',async()=>{const f=await metaAssistantFixture();try{const scopes:unknown[]=[];f.commerce.categories=async(merchantId,input)=>{scopes.push({merchantId,...input});return{categories:Array.from({length:9},(_,i)=>({id:'category-'+i,name:'Categoria '+i,productCount:30})),hasMore:true};};const data=(await f.call('merchant_ads_catalog',{kind:'categories',query:'eletrônicos'})).data as any;assert.equal(data.categories.length,5);assert.equal(data.hasMore,true);assert.deepEqual(scopes,[{merchantId:'store-a',query:'eletrônicos',limit:5}]);assert.deepEqual(f.catalogReads,[]);await assert.rejects(f.call('merchant_ads_catalog',{kind:'categories',categoryId:'foreign'}));await assert.rejects(f.call('merchant_ads_catalog',{kind:'categories',merchantId:'other-store'}));assert.equal(scopes.length,1);}finally{await f.close();}});
test('ACF-02 generic creation starts with the destination and preserves known choices without a product dump',async()=>{const f=await metaAssistantFixture();try{const evidence=[{name:'merchant_ads_catalog',result:{data:{products:Array.from({length:100},()=>assistantProduct)},artifacts:[]}}];for(const message of ['quero criar uma campanha','Crie um anúncio dos meus produtos']){const reply=f.adapter.guidedResponse({message,suggestedReply:'Camisa R$ 99. Qual produto?',campaign:null,evidence});assert.match(reply!,/loja.*WhatsApp/);assert.equal((reply!.match(/\?/g)??[]).length,1);assert.doesNotMatch(reply!,/Camisa|R\$|estoque/);}const campaign={campaignId:null,draft:{destination:'store' as const},awaitingFields:['variantIds','budget'],approvalPreference:'manual' as const};assert.match(f.adapter.guidedResponse({message:'quero criar uma campanha',suggestedReply:'Qual produto?',campaign,evidence})!,/produto específico.*categoria/);assert.equal(campaign.draft.destination,'store');}finally{await f.close();}});
test('ACF-04 filtered products and categories remain concise and later dates stay separate decisions',async()=>{const f=await metaAssistantFixture();try{const evidence=[{name:'merchant_ads_catalog',result:{data:{products:Array.from({length:50},(_,i)=>({...assistantProduct,name:'Som '+i})),hasMore:true},artifacts:[]}}];const reply=f.adapter.guidedResponse({message:'Quero ver caixas de som',suggestedReply:'Lista completa',campaign:null,evidence})!;assert.equal(reply.split('\n').filter(line=>line.startsWith('•')).length,3);assert.match(reply,/Há mais opções/);assert.doesNotMatch(reply,/R\$|estoque|Som 3\b/);const campaign={campaignId:null,draft:{variantIds:['variant-a'],destination:'store' as const,priority:'paid_sales' as const,country:'BR'},awaitingFields:['budget'],approvalPreference:'manual' as const};assert.equal(f.adapter.uncitedResponse({suggestedReply:'Qual a data de início?',campaign,evidence:[]}), 'Em que dia você quer começar a campanha?');for(const suggestedReply of ['Até que dia deve terminar?','Em que dia você quer encerrar a campanha?','Até quando deve ficar no ar?'])assert.equal(f.adapter.uncitedResponse({suggestedReply,campaign,evidence:[]}), 'Até que dia a campanha deve ficar no ar?');}finally{await f.close();}});
test('ACAP-01 complete briefing creates one canonical campaign and preparation without asking approval preference again',async()=>{
  const f=await assistantCampaignFixture();try{const response=await f.call('merchant_ads_save_draft',brief);const progress=await f.progress();assert.ok(progress.campaignId);assert.deepEqual(progress.awaitingFields,[]);assert.equal(progress.approvalPreference,'manual');assert.equal(progress.draft.budget!.amountCents,10000);assert.equal(progress.draft.priority,'roas');const jobs=await f.runtime.preparations.list('store-a',progress.campaignId!);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'queued');assert.equal(jobs[0].requestedBy,'owner-a');assert.equal((response.data as any).preparation.id,jobs[0].id);await f.call('merchant_ads_save_draft',brief);assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length,1);assert.equal((await f.runtime.preparations.list('store-a',progress.campaignId!)).length,1);assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,30);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-02 guided briefing preserves supplied fields and asks only the missing budget and region',async()=>{
  const f=await assistantCampaignFixture();try{await f.call('merchant_ads_save_draft',{priority:'roas',variantIds:['variant-a'],destination:'store'});const partial=await f.progress();assert.deepEqual(partial.awaitingFields,['budget','country']);assert.equal(partial.draft.priority,'roas');assert.deepEqual(partial.draft.variantIds,['variant-a']);assert.equal(partial.campaignId,null);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);await f.call('merchant_ads_save_draft',{budget:brief.budget,country:'BR',headline:brief.headline,primaryText:brief.primaryText});const completed=await f.progress();assert.ok(completed.campaignId);assert.deepEqual(completed.awaitingFields,[]);assert.deepEqual(completed.draft.variantIds,['variant-a']);assert.equal(completed.draft.budget!.cadence,'lifetime');assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),1);}finally{await f.close();}
});
test('ACAP-03 ambiguous money dates objectives and unavailable products cannot replace the clarified planning',async()=>{
  const f=await assistantCampaignFixture();try{await f.call('merchant_ads_save_draft',{variantIds:['variant-a'],destination:'store'});const before=await f.progress();for(const patch of [{budget:{amountCents:10000}},{budget:{...brief.budget,cadence:'100'}},{budget:{...brief.budget,startsAt:'data tal'}},{priority:'mais vendas talvez'},{variantIds:['unknown-product']}])await assert.rejects(f.call('merchant_ads_save_draft',patch));assert.deepEqual(await f.progress(),before);assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length,0);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-04 correction and an interruption for help preserve campaign and generation intent identity',async()=>{
  const f=await assistantCampaignFixture();try{await f.call('merchant_ads_save_draft',brief);const before=await f.progress(),job=(await f.runtime.preparations.list('store-a',before.campaignId!))[0];await f.call('merchant_ads_funding');await f.call('merchant_ads_save_draft',{budget:{...brief.budget,amountCents:9000}});const after=await f.progress(),jobs=await f.runtime.preparations.list('store-a',after.campaignId!);assert.equal(after.campaignId,before.campaignId);assert.equal(after.draft.budget!.amountCents,9000);assert.deepEqual(after.draft.variantIds,before.draft.variantIds);assert.equal(jobs.length,1);assert.equal(jobs[0].id,job.id);assert.equal(jobs[0].intentDigest,job.intentDigest);assert.equal(Object.keys((await f.repo.read('store-a')).generations).length,0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-11 automatic preference and accepted policy still leave a new campaign pending administrative review',async()=>{
  const f=await assistantCampaignFixture();try{await f.call('merchant_ads_save_draft',{...brief,approvalPreference:'automatic'});const progress=await f.progress();await f.verifyMedia(progress.campaignId!);const policy=await f.policy(progress.campaignId!,true);await f.runtime.automatic.bindCampaign('store-a',progress.campaignId!,policy.id);await f.runtime.preparationWorker.drain();await f.runtime.automatic.drain();await f.runtime.launches.drain();const view=await f.runtime.launches.review('store-a','owner-a',progress.campaignId!);assert.equal(view.proposal.kind,'launch');assert.equal(view.proposal.status,'pending_review');assert.equal(view.proposal.approvedBy,null);assert.equal(view.execution,null);assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${view.proposal.id}`),null);await assert.rejects(f.call('merchant_ads_approve',{proposalId:view.proposal.id}));assert.equal(Object.keys((await f.repo.read('store-a')).executions).length,0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-06 explicit carousel image count survives guided completion preparation replay and canonical draft validation',async()=>{
  const f=await assistantCampaignFixture();try{await f.call('merchant_ads_save_draft',{variantIds:['variant-a'],imageCount:3});await f.call('merchant_ads_save_draft',brief);const progress=await f.progress();assert.equal(progress.requestedImages,3);assert.equal(Object.hasOwn(progress.draft,'imageCount'),false);const first=await f.call('merchant_ads_prepare'),second=await f.call('merchant_ads_prepare',{imageCount:3});assert.equal((first.data as any).preparation.id,(second.data as any).preparation.id);const jobs=await f.runtime.preparations.list('store-a',progress.campaignId!);assert.equal(jobs.length,1);assert.equal(jobs[0].requestedImages,3);assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,30);await assert.rejects(f.call('merchant_ads_prepare',{imageCount:31}));assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-09 complete chat briefing persists its disabled-engine blocker without spending or buying extras',async()=>{
  const f=await assistantCampaignFixture({META_ADS_AGENT_CAMPAIGN_APPROVAL_ENABLED:'false'});try{const response=await f.call('merchant_ads_save_draft',brief),progress=await f.progress();assert.ok(progress.campaignId);assert.deepEqual(progress.awaitingFields,[]);assert.equal((response.data as any).preparation.status,'blocked');assert.ok((response.data as any).preparation.missing.includes('campaign_preparation_unavailable'));assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),1);assert.equal(Object.keys((await f.repo.read('store-a')).generations).length,0);assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,30);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-09 a denied preparation grant keeps the canonical briefing and explains the blocker without admission',async()=>{
  const f=await assistantCampaignFixture();try{f.denyTool('merchant_ads_prepare');const response=await f.call('merchant_ads_save_draft',brief),progress=await f.progress();assert.ok(progress.campaignId);assert.deepEqual(progress.awaitingFields,[]);assert.equal((response.data as any).preparation.status,'blocked');assert.equal((response.data as any).preparation.error,'campaign_preparation_forbidden');assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,30);assert.equal(Object.keys((await f.repo.read('store-a')).generations).length,0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-25 chat preparation status reads canonical review notice and verified media without private execution metadata',async()=>{
  const f=await assistantCampaignFixture();try{await f.call('merchant_ads_save_draft',brief);const progress=await f.progress();await f.verifyMedia(progress.campaignId!);await f.runtime.preparationWorker.drain();await f.runtime.noticeWorker.drain();const response=await f.call('merchant_ads_preparation'),data=response.data as any;assert.equal(data.campaignId,progress.campaignId);assert.equal(data.preparations[0].status,'review_ready');assert.equal(data.review.proposal.kind,'launch');assert.equal(data.review.proposal.status,'pending_review');assert.deepEqual(data.review.media.map((m:any)=>m.id),['brief-media']);assert.equal(data.review.notice.reviewState,'awaiting_approval');assert.equal(data.review.notice.whatsappStatus,'blocked');assert.ok(response.artifacts.some(a=>a.type==='proposal'&&a.proposal.id===data.review.proposal.id));for(const secret of ['requestedBy','leaseToken','remoteBefore','productVersions','encryptedAccessToken','clientConversationId'])assert.equal(JSON.stringify(data).includes(secret),false);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),1);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-03 planning time uses the actual ad account IANA date around the UTC boundary',async()=>{
  const f=await assistantCampaignFixture();try{await f.at('2026-11-16T01:30:00Z');const response=await f.call('merchant_ads_planning_context'),data=response.data as any;assert.equal(data.accountId,'100');assert.equal(data.timezone,'America/Sao_Paulo');assert.equal(data.now,'2026-11-16T01:30:00.000Z');assert.equal(data.localDate,'2026-11-15');assert.equal(data.localTime,'22:30:00');assert.equal(data.initialApprovalRequired,true);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-03 missing account timezone and injected account or clock are clarified instead of silently using UTC',async()=>{
  const f=await assistantCampaignFixture();try{for(const args of [{accountId:'200'},{timezone:'UTC'},{now:'2030-01-01'}])await assert.rejects(f.call('merchant_ads_planning_context',args));(f.runtime.service.provider as any).accountTimezone=async()=>'';await assert.rejects(f.call('merchant_ads_planning_context'),{code:'meta_timezone_unavailable'});assert.equal((await f.progress()),null);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-25 chat metrics return the actual persisted daily report and do not admit a preparation',async()=>{
  const f=await assistantCampaignFixture();try{const campaign=await f.create();await f.call('merchant_ads_select_campaign',{campaignId:campaign.id});await f.sql.query('CREATE TABLE completed_orders(id TEXT PRIMARY KEY,merchant_id TEXT,completed_at TIMESTAMPTZ)');await f.runtime.observation.run();const canonical=(await f.runtime.daily.list('store-a','100'))[0].report!;assert.equal(canonical.timezone,'America/Sao_Paulo');const response=await f.call('merchant_ads_daily_reports',{localDay:canonical.localDay});assert.deepEqual(response.data,{reports:[canonical],source:'zyon_daily_observation'});assert.deepEqual(response.artifacts,[{type:'daily_report',report:canonical}]);assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-09 a revoked preparation grant blocks a queued worker before image reservation',async()=>{
  const f=await assistantCampaignFixture();try{await f.call('merchant_ads_save_draft',brief);const progress=await f.progress(),job=(await f.runtime.preparations.list('store-a',progress.campaignId!))[0];f.denyTool('merchant_ads_prepare');await f.runtime.preparationWorker.drain();const blocked=await f.runtime.preparations.read('store-a',job.id);assert.equal(blocked.status,'blocked');assert.equal(blocked.error,'campaign_preparation_forbidden');assert.equal(Object.keys((await f.repo.read('store-a')).generations).length,0);assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,30);assert.equal(f.requests.some(url=>url.includes('/images/')),false);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});
test('ACAP-18 new chat tools reject foreign scope and expired turn ownership before canonical access',async()=>{
  const f=await assistantCampaignFixture();try{await assert.rejects(f.context.execute({...f.input,scope:{...f.input.scope,merchantId:'store-b'},name:'merchant_ads_preparation',args:{}}),(e:any)=>e.status===403);await f.at('2026-11-16T12:02:00Z',false);await assert.rejects(f.call('merchant_ads_planning_context'),{code:'assistant_lease_lost'});assert.equal(await f.prisma.metaAdsCampaignPreparation.count(),0);assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length,0);assert.deepEqual(f.writes,[]);}finally{await f.close();}
});

test('ADAS-47 chat reads the canonical closed-day report with its actual account period and sources', async () => {
  const f = await metaAssistantFixture(); try {
    await f.connect(); const daily = new PrismaDailyObservationRepository(f.prisma, f.clock), day = latestClosedObservationDay(f.clock(), 'America/Sao_Paulo');
    const run = await daily.admit({ merchantId: 'store-a', accountId: '100', ...day }), lease = (await daily.claim('store-a', run.id))!;
    const report = { id: run.id, accountId: '100', localDay: day.localDay, timezone: day.timezone, since: day.since, until: day.until, status: 'partial' as const, analysisStatus: 'pending' as const, collectedAt: null, updatedAt: f.clock().toISOString(), campaigns: [], notes: ['meta_metrics_unavailable'] };
    await daily.checkpoint(lease, { report }); await daily.finish(lease, 'partial');
    const scopes: string[] = [];
    const adapter = new MetaAdsAssistantAdapter({ service: f.service, conversations: f.conversations, authorizeActor: scope => f.adapter.authorize(scope), authorizeTool: async (_scope, name) => { scopes.push(name); }, clock: f.clock,
      dailyReports: async (merchantId, localDay) => (await daily.list(merchantId, '100')).flatMap(row => row.report && (!localDay || row.localDay === localDay) ? [row.report] : []) });
    const result = await adapter.execute({ ...f.input, name: 'merchant_ads_daily_reports', args: { localDay: day.localDay } });
    assert.deepEqual(result.data, { reports: [report], source: 'zyon_daily_observation' }); assert.deepEqual(result.artifacts, [{ type: 'daily_report', report }]);
    assert.deepEqual(scopes, ['merchant_ads_daily_reports']); assert.ok((AI_TOOLS as readonly string[]).includes('merchant_ads_daily_reports')); assert.equal(f.calls.includes('execute'), false);
  } finally { await f.close(); }
});

test('ADAS-48 report tool rejects foreign scope invalid day and client account before reading protected reports', async () => {
  const f = await metaAssistantFixture(); try {
    let reads = 0; const adapter = new MetaAdsAssistantAdapter({ service: f.service, conversations: f.conversations, authorizeActor: scope => f.adapter.authorize(scope), authorizeTool: async () => {}, clock: f.clock, dailyReports: async () => { reads++; return []; } });
    await assert.rejects(adapter.execute({ ...f.input, scope: { ...assistantScope, merchantId: 'store-b' }, name: 'merchant_ads_daily_reports', args: {} }), /assistant_forbidden/);
    for (const args of [{ localDay: '2026-02-30' }, { accountId: '200' }]) await assert.rejects(adapter.execute({ ...f.input, name: 'merchant_ads_daily_reports', args }), /assistant_tool_arguments_invalid/);
    assert.equal(reads, 0);
  } finally { await f.close(); }
});

const draft = { name: 'Camisa da loja', variantIds: ['variant-a'], destination: 'store', priority: 'paid_sales', country: 'BR', approvalPreference: 'manual', budget: { amountCents: 10000, currency: 'BRL', cadence: 'lifetime', startsAt: '2026-11-16T03:00:00Z', endsAt: '2026-11-23T03:00:00Z' }, headline: 'Camisa de algodão', primaryText: 'Conheça a camisa da loja' };
test('ADAS-24 catalog returns canonical store product price stock image and identity', async () => {
  const f = await metaAssistantFixture(); try {
    const result = await f.call('merchant_ads_catalog', { query: 'camisa' });
    assert.deepEqual(result.data, { products: [assistantProduct],hasMore:false });
    assert.deepEqual(f.catalogReads, ['store-a']);
    assert.deepEqual(f.governed, ['merchant_ads_catalog']);
  } finally { await f.close(); }
});
test('ADAS-48 actor context tool and thread must be authorized before reading protected catalog', async () => {
  const f = await metaAssistantFixture(); try {
    for (const scope of [{ ...assistantScope, actorId: 'staff-b' }, { ...assistantScope, merchantId: 'store-b' }, { ...assistantScope, context: 'buyer' }])
      await assert.rejects(f.adapter.execute({ ...f.input, scope, name: 'merchant_ads_catalog', args: {} }), /assistant_(forbidden|context_unavailable)/);
    await assert.rejects(f.adapter.execute({ ...f.input, threadId: 'foreign-thread', name: 'merchant_ads_catalog', args: {} }), /assistant_thread_not_found/);
    assert.deepEqual(f.catalogReads, []); assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});
test('ADAS-21 model cannot inject store account authority secrets unknown fields or tools', async () => {
  const f = await metaAssistantFixture(); try {
    for (const [name, args] of [['merchant_ads_catalog', { merchantId: 'store-b' }], ['merchant_ads_save_draft', { ...draft, approvedBy: 'owner-a' }], ['merchant_ads_generate', { imageCount: 1, accountId: '200' }], ['merchant_ads_approve', {}], ['merchant_ads_accept_policy', {}], ['merchant_ads_topup', {}]] as const)
      await assert.rejects(f.call(name, args), /assistant_(tool_unavailable|tool_arguments_invalid)/);
    assert.deepEqual(f.catalogReads, []); assert.deepEqual(f.calls, []);
    assert.equal((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, null);
    for (const tool of f.adapter.tools()) assert.ok((AI_TOOLS as readonly string[]).includes(tool.name));
  } finally { await f.close(); }
});
test('ADAS-24 conversational draft resolves products and creates one canonical campaign on replay', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', { priority: 'paid_sales', variantIds: ['variant-a'] });
    const partial = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    assert.equal(partial.campaignId, null); assert.ok(partial.awaitingFields.includes('budget')); assert.ok(partial.awaitingFields.includes('destination'));
    const first = await f.call('merchant_ads_save_draft', draft); const second = await f.call('merchant_ads_save_draft', draft);
    const state = await f.repo.read('store-a'); const campaigns = Object.values(state.campaigns);
    assert.equal(campaigns.length, 1); assert.deepEqual(campaigns[0].products, [assistantProduct]);
    assert.deepEqual(first.artifacts, second.artifacts); assert.equal(campaigns[0].draft.budget?.amountCents, 10000);
    assert.deepEqual((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress?.awaitingFields, []);
  } finally { await f.close(); }
});
test('ADAS-27 help and corrections preserve campaign identity and prior fields', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft); const before = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    await f.call('merchant_ads_overview');
    await f.call('merchant_ads_save_draft', { headline: 'Nova camisa', approvalPreference: 'automatic' });
    const after = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    assert.equal(after.campaignId, before.campaignId); assert.equal(after.draft.headline, 'Nova camisa');
    assert.deepEqual(after.draft.budget, before.draft.budget); assert.equal(after.approvalPreference, 'automatic');
    assert.equal(Object.values((await f.repo.read('store-a')).campaigns).length, 1);
    assert.equal((await f.repo.listRecords('store-a', 'proposal')).length, 0);
  } finally { await f.close(); }
});
test('ADAS-25 ambiguous budgets unknown product fields and unavailable selection never become authority', async () => {
  const f = await metaAssistantFixture(); try {
    for (const input of [{ ...draft, priceCents: 1 }, { ...draft, budget: { amountCents: 10000 } }, { ...draft, budget: { ...draft.budget, cadence: 'total' } }, { ...draft, variantIds: ['foreign-variant'] }])
      await assert.rejects(f.call('merchant_ads_save_draft', input), /assistant_tool_arguments_invalid|campaign_budget_invalid|campaign_products_unavailable/);
    assert.deepEqual((await f.repo.read('store-a')).campaigns, {});
    assert.equal((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, null);
  } finally { await f.close(); }
});
test('ADAS-28 image requests use actual quota reservation and replay without buying extras or generating twice', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft);
    const first = await f.call('merchant_ads_generate', { imageCount: 2 }); const repeat = await f.call('merchant_ads_generate', { imageCount: 2 });
    assert.deepEqual(first, repeat); assert.equal(first.artifacts[0].type, 'generation');
    const state = await f.repo.read('store-a');
    assert.equal(Object.keys(state.generations).length, 1); assert.equal(Object.keys(state.credits.reservations).length, 2);
    assert.equal(state.credits.monthlyAvailable, 28); assert.equal(f.physicalImages(), 0);
    await assert.rejects(f.call('merchant_ads_generate', { imageCount: 31 }), /assistant_tool_arguments_invalid/);
  } finally { await f.close(); }
});
test('ADAS-29 preparation remains a reviewed proposal and executing unapproved cannot write Meta', async () => {
  const f = await metaAssistantFixture(); try {
    await f.connect(); await f.call('merchant_ads_save_draft', draft);
    const campaignId = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId!;
    await f.repo.mutate('store-a', [], state => {
      state.media['media-a'] = { id: 'media-a', campaignId, productId: 'product-a', variantId: 'variant-a', productVersion: 'version-a', kind: 'image', url: 'https://media.example.test/ad.png', generationId: 'gen-a', createdAt: f.clock().toISOString(), commercialReview: { status: 'verified', productVersion: 'version-a', imageSha256: 'a'.repeat(64), reviewedAt: f.clock().toISOString(), reason: null } };
      return { result: null };
    });
    await f.call('merchant_ads_save_draft', { mediaIds: ['media-a'] });
    const result = await f.call('merchant_ads_propose', { kind: 'prepare', reasoning: 'Preparar pausada para revisão' });
    const p = result.artifacts.find(a => a.type === 'proposal'); assert.ok(p?.type === 'proposal');
    assert.equal(p.proposal.status, 'pending_review'); assert.equal(p.proposal.approvedBy, null); assert.equal(p.execution, null);
    await assert.rejects(f.call('merchant_ads_execute', { proposalId: p.proposal.id }), /approval_required/);
    assert.ok(!f.calls.includes('prepare')); assert.ok(!f.calls.includes('execute'));
    assert.ok(!JSON.stringify(result).includes('remoteBefore')); assert.ok(!JSON.stringify(result).includes('scoped-test-token'));
  } finally { await f.close(); }
});
test('ADAS-22 campaign status is a scoped timestamped configuration read with child state, not proof of delivery', async () => {
  const f = await metaAssistantFixture(); try {
    await f.connect(); await f.call('merchant_ads_save_draft', draft);
    const campaignId = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId!;
    await f.repo.mutate('store-a', [], state => { Object.assign(state.campaigns[campaignId], { remoteAccountId: '100', remoteCampaignId: '200' }); return { result: null }; });
    f.provider.snapshot = async access => { assert.equal(access.accountId, '100'); return { campaignId: '200', status: 'ACTIVE', effectiveStatus: 'ACTIVE', budget: {}, targeting: {}, adSetId: '300', adIds: ['500'], creativeIds: ['400'], objectStates: [{ type: 'ad', id: '500', status: 'PAUSED', effectiveStatus: 'PAUSED' }] }; };
    const result = await f.call('merchant_ads_status'); const status = result.artifacts[0];
    assert.ok(status.type === 'campaign_status'); assert.equal(status.snapshot.accountId, '100'); assert.equal(status.snapshot.checkedAt, f.clock().toISOString());
    assert.equal(status.snapshot.source, 'meta_configuration'); assert.equal(status.snapshot.configuredStatus, 'ACTIVE');
    assert.deepEqual(status.snapshot.objectStates, [{ type: 'ad', id: '500', status: 'PAUSED', effectiveStatus: 'PAUSED' }]);
    assert.equal(status.snapshot.deliveryConfirmed, false);
  } finally { await f.close(); }
});
test('ADAS-48 expired lease and inactive subscription cannot perform tools but retained help stays readable', async () => {
  const f = await metaAssistantFixture(); try {
    f.setNow('2026-11-14T12:02:00Z'); await assert.rejects(f.call('merchant_ads_catalog'), /assistant_lease_lost/);
    f.setNow('2026-12-02T12:00:00Z'); await assert.rejects(f.adapter.authorizeInvocation(assistantScope), /addon_not_entitled/);
    await f.adapter.authorize(assistantScope); assert.deepEqual(f.catalogReads, []);
  } finally { await f.close(); }
});
test('ADAS-21 existing campaigns can be analyzed but not selected for management or execution', async () => {
  const f = await metaAssistantFixture(); try {
    await f.connect(); f.provider.existingCampaigns = async () => [{ id: '888', name: 'Existente', status: 'PAUSED' }];
    const result = await f.call('merchant_ads_analyze_existing', { remoteId: '888', since: '2026-11-01', until: '2026-11-13' });
    assert.equal((result.data as { source: string }).source, 'meta_reported');
    await assert.rejects(f.call('merchant_ads_select_campaign', { campaignId: '888' }), /campaign_read_only/);
    assert.deepEqual((await f.repo.read('store-a')).campaigns, {}); assert.ok(!f.calls.includes('execute'));
  } finally { await f.close(); }
});
test('ADAS-21 nested draft budget cannot carry hidden authority or arbitrary fields', async () => {
  const f = await metaAssistantFixture(); try {
    await assert.rejects(f.call('merchant_ads_save_draft', { ...draft, budget: { ...draft.budget, accountId: '200' } }), /assistant_tool_arguments_invalid/);
    assert.deepEqual((await f.repo.read('store-a')).campaigns, {});
  } finally { await f.close(); }
});
test('ADAS-27 incomplete correction cannot submit the older canonical campaign instead', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft);
    await f.call('merchant_ads_save_draft', { budget: null });
    await assert.rejects(f.call('merchant_ads_propose', { kind: 'prepare', reasoning: 'Rever orçamento' }), /assistant_campaign_incomplete/);
    assert.deepEqual((await f.repo.read('store-a')).proposals, {});
  } finally { await f.close(); }
});
test('ADAS-27 explicit new campaign resets only conversation progress and preserves prior campaign', async () => {
  const f = await metaAssistantFixture(); try {
    await f.call('merchant_ads_save_draft', draft);
    const first = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId;
    await f.call('merchant_ads_new_campaign');
    assert.equal((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, null);
    await f.call('merchant_ads_save_draft', { ...draft, name: 'Outra campanha' });
    const second = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!.campaignId;
    assert.notEqual(first, second); assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length, 2);
  } finally { await f.close(); }
});
