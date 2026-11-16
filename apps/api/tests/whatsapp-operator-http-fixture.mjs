import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createHandoffFixture} from './whatsapp-handoff-fixture.mjs';

/** Own AppModule/PG/Redis, real bearer authentication and tenant middleware.
 * Fixtures establish canonical waiting tickets; no auth/repository/provider override. */
export async function createWhatsAppOperatorHttpFixture(){
  const f=await createHandoffFixture();
  try{
    const request=async(path,body,auth,method='POST')=>{
      const correlationId=randomUUID();
      const response=await fetch(f.runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'content-type':'application/json','idempotency-key':randomUUID(),'x-correlation-id':correlationId,
          ...(auth?{authorization:'Bearer '+auth.access_token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const result={status:response.status,body:await response.json()};
      if(auth&&method!=='GET'&&path.includes('/whatsapp/claim')&&![401,403].includes(result.status)){
        const end=Date.now()+5000;let audit;
        do{audit=await f.raw.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId}});if(!audit)await pause(10);}while(!audit&&Date.now()<end);
        assert.ok(audit,'operator_claim_http_audit_required');assert.equal(audit.actorId,auth.user_id);
        assert.equal(audit.metadata.statusCode,result.status);assert.equal(audit.outcome,result.status<400?'success':'failed');
      }
      return result;
    };
    const register=async(mode,suffix)=>{
      const email=suffix+'@operator.example.test',password='SyntheticPassword123!';
      const result=await request('/auth/register',{merchant_name:'Synthetic '+suffix,email,password,business_mode:mode});
      assert.equal(result.status,201,JSON.stringify(result));
      const auth={...result.body,email,password};
      await f.raw.whatsAppChannelConfig.create({data:{id:auth.merchant_id+'-config',merchantId:auth.merchant_id,
        provider:'TWILIO',enabled:true,status:'ACTIVE',credentials:{}}});
      return auth;
    };
    const ownerAuth=await register('services','owner'),productAuth=await register('products','products'),foreignAuth=await register('services','foreign');
    const staffAuth=await register('services','staff');
    await f.raw.merchantUser.update({where:{id:staffAuth.user_id},data:{merchantId:ownerAuth.merchant_id,role:'staff'}});
    await f.raw.merchantTeamMember.updateMany({where:{userId:staffAuth.user_id},data:{merchantId:ownerAuth.merchant_id,role:'STAFF'}});
    const login=await request('/auth/login',{email:staffAuth.email,password:staffAuth.password});assert.equal(login.status,201,JSON.stringify(login));
    Object.assign(staffAuth,login.body);
    const makeCase=async(auth,suffix,patch={})=>{
      const user=await f.raw.merchantUser.findUniqueOrThrow({where:{id:auth.user_id}});
      const actor={merchantId:auth.merchant_id,userId:auth.user_id,role:user.role};
      const thread=await f.thread(actor,suffix),ticket=await f.ticket(thread,suffix,patch);
      if(ticket.source==='whatsapp')await f.as(actor,()=>f.repo.begin(thread.scope,ticket.id,0));
      return{...thread,ticket,auth};
    };
    const snapshot=async(value)=>({
      binding:await f.raw.whatsAppHandoffBinding.findFirst({where:{merchantId:value.actor.merchantId,whatsappSessionId:value.session.id}}),
      ticket:await f.raw.supportTicket.findUnique({where:{id:value.ticket.id}}),
      messages:await f.raw.supportTicketMessage.findMany({where:{ticketId:value.ticket.id},orderBy:{id:'asc'}}),
      events:(await f.raw.outboxMessage.findMany({where:{merchantId:value.actor.merchantId,eventType:'support.case.changed'},orderBy:{eventId:'asc'}}))
        .filter(event=>event.payload.ticketId===value.ticket.id).map(({eventId,eventType,payload})=>({eventId,eventType,payload})),
      checkout:await f.raw.checkoutSession.findUnique({where:{merchantId_sessionId:{merchantId:value.actor.merchantId,sessionId:value.session.checkoutSessionId}}}),
      session:await f.raw.whatsAppSession.findUnique({where:{id:value.session.id}}),
    });
    const path=value=>'/support/tickets/'+value.ticket.id+'/whatsapp/claim';
    return{...f,request,ownerAuth,productAuth,foreignAuth,staffAuth,makeCase,snapshot,path};
  }catch(error){await f.close();throw error;}
}
