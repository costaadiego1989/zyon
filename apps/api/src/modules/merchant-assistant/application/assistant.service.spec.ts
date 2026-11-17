import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantModelInput, AssistantModelPort, AssistantModelResult } from '../domain/model.port.js';
import { AssistantError } from '../domain/assistant.port.js';
import { AssistantKnowledgeRetriever } from '../infrastructure/assistant-knowledge.retriever.js';
import { META_ADS_MERCHANT_KNOWLEDGE } from '../infrastructure/knowledge/meta-ads.pt-BR.js';
import { assistantScope, metaAssistantFixture } from '../../meta-ads-agent/application/__tests__/assistant-fixture.js';
import { AssistantService } from './assistant.service.js';

const answer = (reply: string, referenceIds: string[] = []): AssistantModelResult => ({ reply, referenceIds, toolCalls: [], providerRequestId: 'req-a', costMicros: 20n });
const tools = (name: string, args: Record<string, unknown>): AssistantModelResult => ({ ...answer(''), reply: null, toolCalls: [{ id: 'call-a', name, args }] });
async function fixture(run: (input: AssistantModelInput, call: number) => AssistantModelResult | Promise<AssistantModelResult>) {
  const f = await metaAssistantFixture(); f.setNow('2026-11-16T12:00:00Z');
  await f.conversations.atomic(assistantScope, f.thread.id, async tx => { await tx.update(f.turn.id, { leaseUntil: '2026-11-16T12:02:00Z' }); });
  const inputs: AssistantModelInput[] = []; const documents = structuredClone(META_ADS_MERCHANT_KNOWLEDGE);
  const knowledge = new AssistantKnowledgeRetriever(() => documents, f.clock);
  const model: AssistantModelPort = { complete: async input => { inputs.push(structuredClone(input)); return run(input, inputs.length); } };
  const service = new AssistantService({ repo: f.conversations, context: f.adapter, knowledge, model, clock: f.clock });
  const message = async (value: string) => f.sql.query('UPDATE merchant_assistant_turns SET message=$1 WHERE id=$2', [value, f.turn.id]);
  return { ...f, inputs, knowledge, documents, service, message, process: () => service.respond(f.input) };
}
test('ADAS-16 actual retrieval precedes model and only validated current references leave the service', async () => {
  const f = await fixture(input => {
    assert.ok(input.knowledge.some(k => k.reference.id.startsWith('verba-e-pagamentos:')));
    assert.ok(input.knowledge.every(k => k.reference.version === '2026-11-16.2'));
    return answer('O investimento em anúncios é pago diretamente à Meta.', [input.knowledge[0].reference.id]);
  }); try {
    await f.message('Como adicionar fundos para os anúncios?'); const response = await f.process();
    assert.equal(response.reply, 'O investimento em anúncios é pago diretamente à Meta.');
    assert.equal(response.references.length, 1); assert.equal(response.references[0].reviewedAt, '2026-11-16');
    assert.match(response.references[0].url, /^\/\?tab=meta-ads-agent&help=/);
    assert.equal(f.inputs.length, 1);
  } finally { await f.close(); }
});
test('ADAS-18 empty retrieval cannot pass invented payment procedure or value into the response', async () => {
  const f = await fixture(() => answer('Faça Pix de R$ 149 para a Zyon que creditaremos na Meta.')); try {
    f.documents.splice(0); await f.message('Adicionar fundos'); const response = await f.process();
    assert.match(response.reply, /não (encontrei|tenho)|indisponível/i); assert.deepEqual(response.references, []);
    assert.ok(!response.reply.includes('Pix')); assert.ok(!response.reply.includes('149'));
  } finally { await f.close(); }
});
test('ADAS-18 forged and revoked references replace the unsupported answer with a clear limitation', async () => {
  for (const revoke of [false, true]) {
    const f = await fixture(input => {
      const id = input.knowledge[0]?.reference.id;
      if (revoke) f.documents.splice(0);
      return answer('Saldo comprovado de 1000 reais.', [revoke ? id : 'inventado:saldo']);
    }); try {
      await f.message('Qual o saldo para anunciar?'); const response = await f.process();
      assert.deepEqual(response.references, []); assert.match(response.reply, /não (encontrei|tenho)|indisponível/i);
      assert.ok(!response.reply.includes('1000'));
    } finally { await f.close(); }
  }
});
test('ADAS-23 model receives missing campaign fields and asks only the remaining goals', async () => {
  const f = await fixture((input, call) => call === 1 ? tools('merchant_ads_save_draft', { priority: 'roas', variantIds: ['variant-a'], destination: 'store' }) : (() => {
    assert.equal(input.state?.campaign?.draft.priority, 'roas');
    assert.deepEqual(input.state?.campaign?.draft.variantIds, ['variant-a']);
    assert.ok(!input.state?.campaign?.awaitingFields.includes('priority'));
    return answer('Qual orçamento, período e região deseja?');
  })()); try {
    const response = await f.process(); assert.match(response.reply, /orçamento/);
    const progress = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    assert.deepEqual(progress.awaitingFields, ['budget', 'country']);
    assert.equal(response.artifacts[0].type, 'campaign_progress'); assert.equal(f.inputs.length, 2);
    assert.ok(f.inputs[1].messages.some(m => m.role === 'tool' && m.tool_call_id === 'call-a'));
  } finally { await f.close(); }
});
test('ADAS-25 ambiguous amount is clarified without inventing cadence dates or automatic approval', async () => {
  const f = await fixture(() => answer('Os R$ 100 são por dia ou para todo o período? Quais datas deseja?')); try {
    await f.message('Quero anunciar meu produto com 100'); const response = await f.process();
    assert.match(response.reply, /por dia ou para todo/);
    assert.equal((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, null);
    assert.deepEqual((await f.repo.read('store-a')).campaigns, {});
  } finally { await f.close(); }
});
test('ADAS-27 a funding question preserves the partial draft and next correction updates that same draft', async () => {
  const f = await fixture(input => answer('A verba é paga à Meta.', [input.knowledge[0].reference.id])); try {
    await f.call('merchant_ads_save_draft', { variantIds: ['variant-a'], priority: 'roas' });
    const before = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress;
    await f.message('Preciso adicionar fundos?'); await f.process();
    assert.deepEqual((await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress, before);
    await f.call('merchant_ads_save_draft', { priority: 'cost_per_purchase' });
    const after = (await f.conversations.readThread(assistantScope, f.thread.id)).campaignProgress!;
    assert.equal(after.draft.priority, 'cost_per_purchase'); assert.deepEqual(after.draft.variantIds, ['variant-a']);
  } finally { await f.close(); }
});
test('ADAS-51 completed history is supplied with current progress after reconstructing the service', async () => {
  const f = await fixture(input => {
    assert.ok(input.messages.some(m => m.role === 'assistant' && m.content === 'Prefere loja ou WhatsApp?'));
    assert.equal(input.messages.at(-1)?.content, 'Loja'); return answer('Qual será o orçamento?');
  }); try {
    await f.conversations.atomic(assistantScope, f.thread.id, async tx => {
      await tx.update(f.turn.id, { status: 'completed', reply: 'Prefere loja ou WhatsApp?', budgetState: 'settled', usageCostMicros: 0n });
    });
    const next = await f.admission.submit(assistantScope, f.thread.id, { message: 'Loja', expectedRevision: 1, idempotencyKey: 'next-turn' });
    await f.conversations.atomic(assistantScope, f.thread.id, async tx => { await tx.update(next.turn.id, { status: 'running', leaseToken: 'lease-b', leaseUntil: '2026-11-16T12:02:00Z' }); });
    const response = await f.service.respond({ ...f.input, turnId: next.turn.id, leaseToken: 'lease-b' });
    assert.equal(response.reply, 'Qual será o orçamento?');
  } finally { await f.close(); }
});
test('ADAS-53 provider payload and internal errors never become model tool output or merchant text', async () => {
  const f = await fixture((_input, call) => call === 1 ? tools('merchant_ads_catalog', { query: 'camisa' }) : answer('A consulta está indisponível.')); try {
    f.commerce.products = async () => { throw Error('Authorization: secret-token, customer-card-number'); };
    const response = await f.process(); assert.ok(!JSON.stringify(response).includes('secret-token'));
    assert.ok(!JSON.stringify(f.inputs).includes('secret-token'));
    assert.ok(f.inputs[1].messages.some(m => m.content.includes('assistant_tool_failed')));
  } finally { await f.close(); }
});
test('ADAS-48 role revocation after first model response denies tools before any catalog access', async () => {
  const f = await fixture(() => tools('merchant_ads_catalog', {})); try {
    f.adapter.authorizeInvocation = async () => { if (f.inputs.length) throw new AssistantError('assistant_forbidden', 403); };
    await assert.rejects(f.process(), /assistant_forbidden/); assert.deepEqual(f.catalogReads, []);
  } finally { await f.close(); }
});
test('ADAS-49 repeated tool cycle is bounded and cannot endlessly consume model calls', async () => {
  const f = await fixture(() => tools('merchant_ads_catalog', {})); try {
    await assert.rejects(f.process(), /assistant_tool_round_limit/);
    assert.equal(f.inputs.length, 6); assert.equal(f.catalogReads.length, 5);
  } finally { await f.close(); }
});
test('ADAS-21 model cannot return an arbitrary tool or an injected approval capability', async () => {
  const f = await fixture(() => tools('merchant_ads_approve', { proposalId: 'whatever' })); try {
    await assert.rejects(f.process(), /assistant_tool_forbidden/); assert.deepEqual(f.calls, []); assert.deepEqual(f.catalogReads, []);
  } finally { await f.close(); }
});
test('ADAS-24 catalog facts remain answerable without a document citation after an authorized live tool read', async () => {
  const f = await fixture((_input, call) => call === 1 ? tools('merchant_ads_catalog', { query: 'camisa' }) : answer('Camisa: R$ 99,00, com 8 unidades em estoque.')); try {
    f.documents.splice(0); const response = await f.process();
    assert.equal(response.reply, 'Camisa: R$ 99,00, com 8 unidades em estoque.');
    assert.deepEqual(f.catalogReads, ['store-a']); assert.deepEqual(response.references, []);
  } finally { await f.close(); }
});

test('ADAS-18 a question suffix cannot make an invented payment procedure supported',async()=>{const f=await fixture(()=>answer('Faça um Pix de R$ 237 para a Zyon para adicionar fundos à Meta, combinado?'));try{f.documents.splice(0);await f.message('Onde faço o pagamento da verba?');const response=await f.process();assert.doesNotMatch(response.reply,/Pix|237|combinado/);assert.match(response.reply,/não (encontrei|tenho)|evidência|indisponível/i);assert.deepEqual(response.references,[]);}finally{await f.close();}});
test('ADAS-18 a canonical catalog read cannot support an invented payment procedure',async()=>{const f=await fixture((_input,call)=>call===1?tools('merchant_ads_catalog',{}):answer('Faça um Pix de R$ 237 para a Zyon para adicionar fundos à Meta.'));try{f.documents.splice(0);await f.message('Como pago a verba da minha camisa?');const response=await f.process();assert.doesNotMatch(response.reply,/Pix|237/);assert.deepEqual(f.catalogReads,['store-a']);assert.deepEqual(response.references,[]);}finally{await f.close();}});
test('ADAS-18 source-free clarification is rendered by the host without repeating model payment claims',async()=>{const f=await fixture(()=>answer('Faça um Pix de R$ 237. Qual será o orçamento?'));try{f.documents.splice(0);const response=await f.process();assert.equal(response.reply,'Qual será o orçamento?');assert.deepEqual(response.references,[]);assert.deepEqual(f.catalogReads,[]);}finally{await f.close();}});

test('ADAS-53 a sixth tool in one response is rejected before business actions or image consumption',async()=>{const f=await fixture(()=>({...answer(''),reply:null,toolCalls:Array.from({length:6},(_,i)=>({id:`too-many-${i}`,name:'merchant_ads_catalog',args:{}}))}));try{await assert.rejects(f.process(),{code:'assistant_tool_forbidden'});assert.equal(f.inputs.length,1);assert.deepEqual(f.catalogReads,[]);const state=await f.repo.read('store-a');assert.deepEqual(state.campaigns,{});assert.deepEqual(state.generations,{});assert.equal(state.credits.monthlyAvailable,30);}finally{await f.close();}});
test('ADAS-18 only missing fields become host clarification and a known budget is not asked again',async()=>{const f=await fixture(()=>answer('Qual será o orçamento?'));try{f.documents.splice(0);await f.call('merchant_ads_save_draft',{budget:{amountCents:10000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'}});const response=await f.process();assert.match(response.reply,/Não encontrei evidência/);assert.equal((await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!.draft.budget!.amountCents,10000);assert.equal(Object.keys((await f.repo.read('store-a')).campaigns).length,0);}finally{await f.close();}});

test('ADAS-18 host clarification asks only the absent business field and never returns injected prose',async t=>{for(const [field,pattern] of [['budget',/orçamento/i],['variantIds',/produto/i],['destination',/loja ou WhatsApp/i],['priority',/resultado/i],['country',/país/i]] as const)await t.test(field,async()=>{const f=await fixture(()=>answer('Faça Pix de R$ 237. Qual produto, destino, objetivo, região e orçamento?'));try{f.documents.splice(0);const draft={variantIds:['variant-a'],destination:'store' as const,priority:'roas' as const,country:'BR',budget:{amountCents:10000,currency:'BRL' as const,cadence:'lifetime' as const,startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'}};delete (draft as Record<string,unknown>)[field];await f.conversations.atomic(assistantScope,f.thread.id,tx=>tx.setProgress({campaignId:null,draft,awaitingFields:[field],approvalPreference:'manual'}));const response=await f.process();assert.match(response.reply,pattern);assert.doesNotMatch(response.reply,/Pix|237/);assert.equal((response.reply.match(/\?/g)??[]).length,1);assert.deepEqual((await f.conversations.readThread(assistantScope,f.thread.id)).campaignProgress!.awaitingFields,[field]);assert.deepEqual(f.catalogReads,[]);}finally{await f.close();}});});

test('ADAS-18 a safe greeting is allowed but cannot carry a prefixed payment instruction',async()=>{for(const malicious of [false,true]){const f=await fixture(()=>answer(malicious?'Faça Pix de R$ 237. Como posso ajudar?':'Como posso ajudar?'));try{f.documents.splice(0);const response=await f.process();if(malicious){assert.match(response.reply,/Não encontrei evidência/);assert.doesNotMatch(response.reply,/Pix|237/);}else assert.equal(response.reply,'Como posso ajudar?');}finally{await f.close();}}});
