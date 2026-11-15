import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServiceTestRuntime} from './service-test-runtime.mjs';

export async function createProfessionalHttpFixture(){
  const runtime=await createServiceTestRuntime({local:true});
  let prisma;
  try{
    const {PrismaClient}=await import('@prisma/client');
    prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    const request=async(path,body,auth,method='POST')=>{
      const correlationId=randomUUID();
      const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json','idempotency-key':randomUUID(),'x-correlation-id':correlationId,...(auth?{authorization:'Bearer '+auth.access_token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const result={status:response.status,body:await response.json()};
      // The global interceptor records audits asynchronously. Await actual
      // persisted effects of entered mutation handlers before snapshots/close.
      if(auth&&method!=='GET'&&path.includes('/service-professionals')&&[200,201,400,404,409].includes(response.status)){
        assert.equal(response.headers.get('x-correlation-id'),correlationId);
        const deadline=Date.now()+5000;let audit;
        do{audit=await prisma.merchantAuditEvent.findFirst({where:{merchantId:auth.merchant_id,correlationId}});}while(!audit&&Date.now()<deadline);
        assert.ok(audit,'service_professional_http_audit_required');
        assert.equal(audit.actorId,auth.user_id);assert.equal(audit.action,'http.'+method.toLowerCase());
        assert.equal(audit.outcome,response.status<400?'success':'failed');assert.equal(audit.metadata.statusCode,response.status);
      }
      return result;
    };
    const register=async(mode,suffix=mode)=>{
      const email=suffix+'@professional.example.test',password='SyntheticPassword123!';
      const response=await request('/auth/register',{merchant_name:'Synthetic '+suffix,email,password,business_mode:mode});
      assert.equal(response.status,201,JSON.stringify(response));
      await prisma.merchant.update({where:{id:response.body.merchant_id},data:{plan:'STORE_ONLY'}});
      return{...response.body,email,password};
    };
    const owner=await register('services'),foreign=await register('services','foreign'),products=await register('products');
    const staff=await register('services','staff');
    await prisma.merchantUser.update({where:{id:staff.user_id},data:{role:'staff'}});
    await prisma.merchantTeamMember.updateMany({where:{userId:staff.user_id},data:{role:'STAFF'}});
    Object.assign(staff,(await request('/auth/login',{email:staff.email,password:staff.password})).body);
    const path=auth=>'/merchants/'+auth.merchant_id+'/service-professionals';
    const profile={publicName:'Synthetic professional',publicProfile:{description:'Public biography',specialties:['Consulting']},timeZone:'America/Sao_Paulo',isPublished:true};
    return {runtime,prisma,request,register,owner,foreign,products,staff,path,profile,close:async()=>{await prisma.$disconnect();await runtime.close();assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});}};
  }catch(error){if(prisma)await prisma.$disconnect();await runtime.close();throw error;}
}
