import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createWhatsAppOperatorHttpFixture} from './whatsapp-operator-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T58 real AppModule DI and failed durable projection',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createWhatsAppOperatorHttpFixture({provider:'META_CLOUD',operatorDelivery:true,whatsapp:true});
  try{
    const value=await f.makeCase(f.ownerAuth,'unavailable-read'),ordinary=await f.makeCase(f.ownerAuth,'ordinary-read',{source:'widget'});
    const base='/support/whatsapp/conversations',get=(path,auth=f.ownerAuth)=>f.request(base+path,undefined,auth,'GET');
    await t.test('actual controller and injected reader/claim/close resolve through served auth routes',async()=>{
      const context=await get('/context',f.staffAuth);assert.equal(context.status,200);assert.equal(context.body.role,'STAFF');
      assert.equal((await f.request('/merchants/me',undefined,f.staffAuth,'GET')).status,403);
      assert.equal((await get('')).status,200);assert.equal((await get('/'+value.ticket.id)).status,200);
      assert.equal((await f.request(base+'/'+value.ticket.id+'/claim',{expectedEpoch:1},f.ownerAuth)).status,201);
      assert.equal((await f.request(base+'/'+value.ticket.id+'/close',{expectedEpoch:2},f.ownerAuth)).status,201);
      assert.equal((await get('/'+value.ticket.id,f.foreignAuth)).status,404);
    });
    await t.test('malformed real SQL projection is a failed HTTP read, not empty success; repair restores it',async()=>{
      const row=await f.raw.supportTicketMessage.create({data:{id:randomUUID(),ticketId:value.ticket.id,senderType:'merchant',content:'Synthetic bounded projection failure',
        metadata:{kind:'whatsapp_outgoing',schemaVersion:1,clientMessageId:'t58_projection_fixture',delivery:{status:'not-a-public-status',revision:1}}}});
      const before=await f.snapshot(value);
      try{
        const failed=await get('/'+value.ticket.id);assert.equal(failed.status,500);
        assert.equal(Object.hasOwn(failed.body,'messages'),false);assert.equal(Object.hasOwn(failed.body,'data'),false);
        assert.equal(JSON.stringify(failed.body).includes('Synthetic bounded projection failure'),false);
        assert.equal((await get('/'+value.ticket.id,f.foreignAuth)).status,404);
        assert.deepEqual(await f.snapshot(value),before);
        assert.equal((await f.request('/support/tickets/'+ordinary.ticket.id+'/messages',undefined,f.ownerAuth,'GET')).status,200);
      }finally{await f.raw.supportTicketMessage.update({where:{id:row.id},data:{metadata:{kind:'whatsapp_outgoing',schemaVersion:1,
        clientMessageId:'t58_projection_fixture',delivery:{status:'unknown',revision:1}}}});}
      const restored=await get('/'+value.ticket.id);assert.equal(restored.status,200);
      assert.deepEqual(restored.body.messages.find(message=>message.id===row.id).delivery,{status:'unknown',revision:1});
    });
    assert.equal(f.runtime.evidence().providerCalls,0);assert.equal(f.runtime.evidence().authOverrides,false);assert.equal(f.runtime.evidence().repositoryOverrides,false);
  }finally{await f.close();}
});
