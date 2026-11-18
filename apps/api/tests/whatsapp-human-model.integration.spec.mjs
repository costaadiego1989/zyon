import assert from 'node:assert/strict';
import test from 'node:test';
import {humanModelFixture,HUMAN_MODEL_REPLY,observeHumanModelFailure} from './whatsapp-human-model.fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const modelCalls=f=>f.runtime.storefrontQueryModel.events().filter(event=>event.kind==='providerFetch');
async function assertPreserved(f,before){
  const after=await f.snapshot();assert.deepEqual(after.checkout,before.checkout);
  assert.equal(after.payments,before.payments);assert.equal(after.orders,before.orders);return after;
}
async function selectedHuman(f){
  const row=await f.raw.whatsAppSession.findUniqueOrThrow({where:{id:f.session.id}}),state=row.conversationState;
  const entry=Object.entries(state.selections??{}).find(([,action])=>action.kind==='message'&&action.message==='Falar com atendente');
  assert.ok(entry,'fixed human main-menu control required');return entry[0];
}
test('T57 signed semantic human tools and native main-menu preserve checkout collection',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  for(const mode of ['products','services'])await t.test(mode+' main menu exposes a current fixed human control and admits its gesture once',async()=>{
    const f=await humanModelFixture(mode,{model:false});
    try{
      const before=await f.snapshot();await f.post(f.payload('t57-menu','/atalhos'));await f.processed('t57-menu');
      const native=f.sent().flatMap(event=>event.input.uiMessage?.interactive?.action?.sections?.flatMap(section=>section.rows)??[]);
      assert.ok(native.some(row=>row.title.includes('Falar com atendente')));assert.ok(native.length<=10);
      await assertPreserved(f,before);assert.equal((await f.snapshot()).tickets.length,0);
      const id=await selectedHuman(f);
      // The title is not a request: only the current server mapping supplies
      // this fixed gesture; a model/body reason is never a selection grant.
      const payload=f.payload('t57-selected','Escolher',{interactiveId:id});await f.post(payload);const inbox=await f.processed('t57-selected');
      const after=await assertPreserved(f,before);assert.equal(after.tickets.length,1);assert.equal(after.binding.mode,'waiting_human');
      assert.equal(after.binding.epoch,1);assert.equal(inbox.responseState.handoff.ticketId,after.tickets[0].id);
      const messages=await f.raw.supportTicketMessage.findMany({where:{ticketId:after.tickets[0].id}});
      assert.equal(messages.length,1);assert.equal(messages[0].metadata.origin,'button');assert.equal(messages[0].content,'Escolher');
      const count=f.sent().length;await f.post(payload);await f.processed('t57-selected');assert.equal(f.sent().length,count);
      assert.equal((await f.snapshot()).tickets.length,1);assert.match(f.text(),/Atendimento humano solicitado/);assert.equal(modelCalls(f).length,0);
    }catch(error){observeHumanModelFailure(f,error);throw error;}finally{await f.close();}
  });
  for(const mode of ['products','services'])for(const voice of [false,true])await t.test(mode+' semantic '+(voice?'voice':'text')+' interrupts a missing '+(voice?'address':'name')+' without writing that answer',async()=>{
    const message='Você consegue me colocar em contato com alguém da equipe da loja?';
    const f=await humanModelFixture(mode,{missing:voice?'address':'name',...(voice?{transcript:message}:{})});
    try{
      const before=await f.snapshot(),payload=f.payload('t57-semantic',voice?'12345':message,{audio:voice});
      await f.post(payload);const inbox=await f.processed('t57-semantic');const after=await assertPreserved(f,before);
      assert.equal(after.tickets.length,1);assert.equal(after.tickets[0].source,'whatsapp');assert.equal(after.tickets[0].sessionId,f.session.id);
      assert.equal(after.binding.merchantId,f.merchantId);assert.equal(after.binding.configId,f.configId);assert.equal(after.binding.mode,'waiting_human');
      const rows=await f.raw.supportTicketMessage.findMany({where:{ticketId:after.tickets[0].id}});
      assert.equal(rows.length,1);assert.equal(rows[0].content,message);assert.equal(rows[0].metadata.origin,voice?'voice':'text');
      assert.equal(rows[0].metadata.inboxId,inbox.id);assert.match(f.text(),/Atendimento humano solicitado/);assert.doesNotMatch(f.text(),new RegExp(HUMAN_MODEL_REPLY));
      const tools=modelCalls(f).filter(event=>event.result.humanToolCall);assert.equal(tools.length,1);
      assert.ok(tools[0].input.toolNames.includes('escalate_to_human'));
      if(voice){const captures=f.runtime.whatsapp.events().filter(event=>event.kind==='voiceInterpret');assert.equal(captures.length,1);assert.equal(captures[0].result.scope.inboxId,inbox.id);}
      const stable=await f.snapshot(),count=f.sent().length;await f.post(payload);await f.processed('t57-semantic');
      assert.deepEqual(await f.snapshot(),stable);assert.equal(f.sent().length,count);
      assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);assert.equal(f.runtime.evidence().providerCalls,0);
    }catch(error){observeHumanModelFailure(f,error);throw error;}finally{await f.close();}
  });
  for(const [message,pattern]of [
    ['Não quero falar com atendente, quero continuar por aqui.',/Não abri um chamado/],
    ['O texto "quero falar com atendente" é apenas um exemplo.',/equipe da loja/],
    ['Quero falar com um atendente médico para decidir meu tratamento.',/equipe da loja/],
  ])await t.test('ordinary model-selected tool cannot override current '+message,async()=>{
    const f=await humanModelFixture('services',{missing:'name'});
    try{
      const before=await f.snapshot();await f.post(f.payload('t57-no-grant',message));await f.processed('t57-no-grant');
      const after=await assertPreserved(f,before);assert.equal(after.tickets.length,0);assert.ok(!after.binding||after.binding.mode==='ai');
      assert.match(f.text(),pattern);assert.doesNotMatch(f.text(),/Atendimento humano solicitado|MODEL_REPLY_MUST_NOT_REPLACE/);
      assert.equal(modelCalls(f).filter(event=>event.result.humanToolCall).length,1);
    }catch(error){observeHumanModelFailure(f,error);throw error;}finally{await f.close();}
  });
  await t.test('audio labels without the admitted scoped transcript cannot request a person',async()=>{
    const f=await humanModelFixture('products',{model:false});
    try{
      const before=await f.snapshot(),payload=f.payload('t57-unread','99999',{audio:true});
      payload.entry[0].changes[0].value.messages[0].text={body:'Você pode chamar alguém da equipe?'};
      await f.post(payload);await f.processed('t57-unread');const after=await assertPreserved(f,before);
      assert.equal(after.tickets.length,0);assert.ok(!after.binding||after.binding.mode==='ai');assert.equal(modelCalls(f).length,0);
      assert.match(f.text(),/Não consegui transcrever/);assert.doesNotMatch(f.text(),/Atendimento humano solicitado/);
    }catch(error){observeHumanModelFailure(f,error);throw error;}finally{await f.close();}
  });
});
