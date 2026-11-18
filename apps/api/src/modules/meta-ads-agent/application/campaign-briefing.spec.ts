import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AssistantCampaignProgress} from '@zyon/shared-types';
import {briefingChecklist,receiveBriefingAnswer} from './campaign-briefing.js';

const selected=():AssistantCampaignProgress=>({campaignId:null,draft:{destination:'store',variantIds:['v1'],priority:'paid_sales'},awaitingFields:['budget','country'],approvalPreference:'manual'});
test('ACF-05 durable checklist retains explicit amount cadence and raw dates across help and serialization',()=>{
  let progress=selected();
  for(const [index,message] of ['R$ 120','No total','Dia 20','Dia 27'].entries())progress=receiveBriefingAnswer(progress,message,'t'+index)!;
  const stored=JSON.parse(JSON.stringify(progress));
  assert.deepEqual(stored.briefing.budget,{amountCents:12000,cadence:'lifetime',startText:'Dia 20',endText:'Dia 27'});
  assert.equal(stored.draft.budget,undefined);
  assert.deepEqual(receiveBriefingAnswer(stored,'O que é Pixel?','help'),stored);
  const checklist=briefingChecklist(stored);
  assert.equal(checklist.next,'country');assert.deepEqual(checklist.needsInterpretation,['start','end']);assert.equal(checklist.complete,false);
  assert.equal(checklist.newCampaignApproval,'always_required');
  assert.deepEqual(receiveBriefingAnswer(progress,'Mude isso','t3'),progress);
});
test('ACF-05 short choices are explicit while suggestions never select canonical products or approve',()=>{
  let progress=receiveBriefingAnswer(null,'quero criar uma campanha','start',true)!;
  progress=receiveBriefingAnswer(progress,'Na loja','destination')!;
  assert.equal(progress.draft.destination,'store');assert.equal(briefingChecklist(progress).next,'selection');
  progress.briefing!.productOptions=[{variantId:'v1',name:'Camisa'},{variantId:'v2',name:'Calça'}];
  progress=receiveBriefingAnswer(progress,'a segunda','choice')!;
  assert.equal(progress.briefing!.selectionQuery,'Calça');assert.equal(progress.briefing!.selectedVariantId,'v2');assert.equal(progress.draft.variantIds,undefined);
  assert.equal(progress.campaignId,null);assert.equal(progress.approvalPreference,'manual');
  assert.equal(receiveBriefingAnswer(null,'O que é Pixel?','help'),null);
});
test('ACF-05 incomplete numbers dates and lifetime end never become a guessed valid budget',()=>{
  const progress=selected();
  const amount=receiveBriefingAnswer(progress,'100','amount')!;
  assert.equal(amount.briefing!.budget!.amountCents,10000);assert.equal(amount.briefing!.budget!.cadence,undefined);assert.equal(briefingChecklist(amount).next,'cadence');
  amount.briefing!.budget={amountCents:10000,cadence:'lifetime',startsAt:'2026-11-20T12:00:00Z',endsAt:null};
  assert.equal(briefingChecklist(amount).items.find(item=>item.key==='end')!.status,'pending');
  amount.briefing!.budget.cadence='daily';assert.equal(briefingChecklist(amount).items.find(item=>item.key==='end')!.value,'no_end_date');
  assert.equal(receiveBriefingAnswer(progress,'Como funciona o orçamento?','help'),progress);
});
