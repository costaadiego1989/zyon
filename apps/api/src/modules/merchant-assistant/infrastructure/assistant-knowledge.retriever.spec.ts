import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AssistantKnowledgeDocument} from '../domain/knowledge.port.js';
import {AssistantKnowledgeRetriever} from './assistant-knowledge.retriever.js';
import {META_ADS_MERCHANT_KNOWLEDGE} from './knowledge/meta-ads.pt-BR.js';
const scope={context:'meta_ads',audience:'merchant' as const};
const now=()=>new Date('2026-11-16T12:00:00Z');
const doc=(change:Partial<AssistantKnowledgeDocument>={}):AssistantKnowledgeDocument=>({id:'sample',version:'v1',title:'Pagamentos',context:'meta_ads',audience:'merchant',published:true,
  reviewedAt:'2026-11-16',validFrom:'2026-11-16T00:00:00Z',validUntil:null,url:'/?tab=meta-ads-agent&help=sample',externalSources:[],
  sections:[{id:'saldo',keywords:['fundos','pagamento'],content:'Adicione fundos no ambiente oficial quando a conta for pré-paga.'}],...change});

test('ADAS-16 retrieval supplies current approved content and preserves its source metadata',async()=>{
  const retriever=new AssistantKnowledgeRetriever(()=>[doc()],now);
  const result=await retriever.retrieve(scope,'Como adiciono fundos?');assert.equal(result[0].reference.id,'sample:saldo');
  assert.match(result[0].content,/pré-paga/);assert.equal(result[0].reference.reviewedAt,'2026-11-16');assert.equal(result[0].reference.version,'v1');
  assert.equal((await retriever.validateReferences(scope,['sample:saldo'],result))[0].url,'/?tab=meta-ads-agent&help=sample');
});
test('ADAS-19 questions across all nine subjects retrieve the relevant curated document first',async()=>{
  const retriever=new AssistantKnowledgeRetriever(()=>META_ADS_MERCHANT_KNOWLEDGE,now);
  const examples=[['Como conectar minha Página no aplicativo Zyon?','conexao-meta'],['Como adicionar fundos e recarregar saldo?','verba-e-pagamentos'],
    ['Qual a franquia de créditos e o pacote extra?','assinatura-e-franquia'],['Como escolher produtos do catálogo?','catalogo-e-produtos'],
    ['Quero criar uma imagem fiel e um carrossel','criativos'],['Como autorizar o modo automático e revogar a política?','aprovacao-e-automatico'],
    ['Como publicar e acompanhar a veiculação?','publicacao'],['Onde vejo métricas e o relatório da meia-noite?','metricas'],['O envio deu timeout e resultado desconhecido, posso repetir?','erros-e-recuperacao']];
  assert.equal(META_ADS_MERCHANT_KNOWLEDGE.length,9);
  for(const [query,id]of examples){const result=await retriever.retrieve(scope,query);assert.equal(result[0]?.reference.id.split(':')[0],id,query);}
});
test('ADAS-20 revoked and superseded versions cannot enter a new turn or validate an old citation',async()=>{
  let docs=[doc()];const retriever=new AssistantKnowledgeRetriever(()=>docs,now),prior=await retriever.retrieve(scope,'fundos');
  docs=[doc({published:false})];assert.deepEqual(await retriever.retrieve(scope,'fundos'),[]);
  await assert.rejects(retriever.validateReferences(scope,['sample:saldo'],prior),{code:'assistant_reference_invalid'});
  docs=[doc({published:true}),doc({version:'v2',reviewedAt:'2026-11-16T10:00:00Z',sections:[{id:'saldo',keywords:['fundos'],content:'Nova orientação para fundos.'}]})];
  const updated=await retriever.retrieve(scope,'fundos');assert.equal(updated.length,1);assert.equal(updated[0].reference.version,'v2');
  await assert.rejects(retriever.validateReferences(scope,['sample:saldo'],prior),{code:'assistant_reference_invalid'});
});
test('retrieval is bounded to five unique relevant chunks and excludes expired or future material',async()=>{
  const sections=Array.from({length:9},(_,i)=>({id:`part-${i}`,keywords:['fundos'],content:`Fundos: orientação ${i}.`}));
  const retriever=new AssistantKnowledgeRetriever(()=>[doc({sections}),doc({id:'future',validFrom:'2026-11-17T00:00:00Z'}),doc({id:'expired',validUntil:'2026-11-16T11:00:00Z'})],now);
  const result=await retriever.retrieve(scope,'fundos');assert.equal(result.length,5);assert.equal(new Set(result.map(x=>x.reference.id)).size,5);
  assert.ok(result.every(x=>x.reference.id.startsWith('sample:')));
});
test('empty unrelated or foreign-audience retrieval returns no evidence',async()=>{
  const retriever=new AssistantKnowledgeRetriever(()=>[doc()],now);
  for(const query of ['','   ','zxqvplm29'])assert.deepEqual(await retriever.retrieve(scope,query),[]);
  assert.deepEqual(await retriever.retrieve({...scope,context:'other'},'fundos'),[]);
  assert.deepEqual(await retriever.retrieve({...scope,audience:'buyer'},'fundos'),[]);
});
test('citation validation rejects an arbitrary id or citation not provided to the model',async()=>{
  const retriever=new AssistantKnowledgeRetriever(()=>[doc()],now),retrieved=await retriever.retrieve(scope,'fundos');
  await assert.rejects(retriever.validateReferences(scope,['invented:source'],retrieved),{code:'assistant_reference_invalid'});
  await assert.rejects(retriever.validateReferences(scope,['sample:saldo'],[]),{code:'assistant_reference_invalid'});
  assert.deepEqual(await retriever.validateReferences(scope,[],retrieved),[]);
});
test('source reader opens the same approved document by document or chunk id and returns a detached copy',async()=>{
  const retriever=new AssistantKnowledgeRetriever(()=>[doc()],now);
  const first=await retriever.source(scope,'sample:saldo');assert.equal(first?.id,'sample');assert.equal((await retriever.source(scope,'sample'))?.version,'v1');
  first!.title='tampered';assert.equal((await retriever.source(scope,'sample'))?.title,'Pagamentos');
  assert.equal(await retriever.source({...scope,audience:'buyer'},'sample'),null);
});
test('retrieval excludes unsafe source origins and never trusts a supplied citation URL',async()=>{
  for(const url of ['javascript:alert(1)','https://developers.facebook.com.evil.test/docs','https://token:secret@developers.facebook.com/docs','https://developers.facebook.com/docs?access_token=secret']){
    const retriever=new AssistantKnowledgeRetriever(()=>[doc({url})],now);assert.deepEqual(await retriever.retrieve(scope,'fundos'),[]);
  }
  const retriever=new AssistantKnowledgeRetriever(()=>[doc()],now),retrieved=await retriever.retrieve(scope,'fundos');
  retrieved[0].reference.url='https://evil.test';
  await assert.rejects(retriever.validateReferences(scope,['sample:saldo'],retrieved),{code:'assistant_reference_invalid'});
});
test('source content changed without a version update invalidates a prior retrieved chunk',async()=>{
  let current=doc();const retriever=new AssistantKnowledgeRetriever(()=>[current],now),retrieved=await retriever.retrieve(scope,'fundos');
  current=doc({sections:[{id:'saldo',keywords:['fundos'],content:'Conteúdo trocado sem revisão.'}]});
  await assert.rejects(retriever.validateReferences(scope,['sample:saldo'],retrieved),{code:'assistant_reference_invalid'});
});
test('publication and validity guards reject otherwise valid sources independently',async()=>{
  for(const change of [{published:false},{validFrom:'2026-11-17T00:00:00Z'},{validUntil:'2026-11-16T11:59:59Z'},{reviewedAt:'2026-11-17'},{validFrom:'invalid'}]){
    const retriever=new AssistantKnowledgeRetriever(()=>[doc(change)],now);
    assert.deepEqual(await retriever.retrieve(scope,'fundos'),[],JSON.stringify(change));
  }
});
test('unavailable retrieval is empty and cannot validate a previous reference',async()=>{
  let unavailable=false;const retriever=new AssistantKnowledgeRetriever(()=>{if(unavailable)throw new Error('provider failed');return [doc()];},now);
  const prior=await retriever.retrieve(scope,'fundos');unavailable=true;
  assert.deepEqual(await retriever.retrieve(scope,'fundos'),[]);
  await assert.rejects(retriever.validateReferences(scope,['sample:saldo'],prior),{code:'assistant_reference_invalid'});
});
test('source reader returns a detached article and nonstandard official-host ports are rejected',async()=>{
  const document=doc();const retriever=new AssistantKnowledgeRetriever(()=>[document],now);
  const article=await retriever.source(scope,'sample:saldo');assert.equal(article?.id,'sample');
  article!.title='Changed by caller';assert.equal((await retriever.source(scope,'sample'))?.title,'Pagamentos');
  const unsafe=new AssistantKnowledgeRetriever(()=>[doc({url:'https://developers.facebook.com:8443/docs'})],now);
  assert.deepEqual(await unsafe.retrieve(scope,'fundos'),[]);
});
