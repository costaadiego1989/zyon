import test from 'node:test';
import assert from 'node:assert/strict';
import { CASHBACK_MERCHANT_KNOWLEDGE, cashbackMerchantGuideSources } from './knowledge/cashback.pt-BR.js';

test('reviewed cashback corpus covers all approved help topics without prefilled commercial values',()=>{
  const topics=['ganhos','liberacao','validade','uso','cupons','regras-avancadas','tetos','carteira','pausa'];
  assert.deepEqual(CASHBACK_MERCHANT_KNOWLEDGE.map(doc=>doc.id),topics.map(topic=>`cashback-${topic}`));
  for(const doc of CASHBACK_MERCHANT_KNOWLEDGE){
    assert.ok(doc.sections.length>0);assert.ok(doc.sections.every(section=>section.content.length>80));
    assert.doesNotMatch(doc.sections.map(section=>section.content).join(' '),/\d+\s*%|R\$\s*\d+|\d+\s*dias/);
    assert.match(doc.sections.map(section=>section.content).join(' '),/regra|configura|lojista|publicad/i);
  }
  const content=CASHBACK_MERCHANT_KNOWLEDGE.flatMap(doc=>doc.sections.map(s=>s.content)).join(' ');
  assert.match(content,/mesma loja/i);assert.match(content,/site e.*WhatsApp/i);assert.match(content,/créditos já concedidos/i);
  assert.match(content,/todos os planos/i);assert.match(content,/físicos.*serviços.*digitais.*comida/i);
});
test('cashback source metadata is published reviewed versioned and restricted to its internal help route',()=>{
  assert.equal(new Set(CASHBACK_MERCHANT_KNOWLEDGE.map(doc=>doc.id)).size,9);
  for(const doc of CASHBACK_MERCHANT_KNOWLEDGE){
    assert.equal(doc.context,'cashback');assert.equal(doc.audience,'merchant');assert.equal(doc.published,true);
    assert.equal(doc.version,'2026-11-18.1');assert.equal(doc.reviewedAt,'2026-11-18');
    assert.equal(doc.validFrom,'2026-11-18T00:00:00Z');assert.equal(doc.validUntil,null);
    assert.equal(doc.url,`/?tab=cashback&help=${doc.id}`);assert.deepEqual(doc.externalSources,[]);
    assert.equal(new Set(doc.sections.map(s=>s.id)).size,doc.sections.length);
  }
});
test('merchant guide source materialization contains only reviewed content and detached tenant identities',async()=>{
  const sources=await cashbackMerchantGuideSources.listMerchantGuides('qa-cbx-a');
  assert.equal(sources.length,9);
  for(const [i,source] of sources.entries()){
    const doc=CASHBACK_MERCHANT_KNOWLEDGE[i]!;
    assert.deepEqual(source,{kind:'merchant_help',merchantId:'qa-cbx-a',audience:'merchant',context:'cashback',sourceType:'merchant_guide',
      id:doc.id,version:Date.parse('2026-11-18T00:00:00Z')+1,active:true,chunks:doc.sections.map(s=>({id:s.id,content:s.content}))});
  }
  sources[0]!.chunks[0]!.content='tampered';
  assert.notEqual((await cashbackMerchantGuideSources.listMerchantGuides('qa-cbx-b'))[0]!.chunks[0]!.content,'tampered');
});
