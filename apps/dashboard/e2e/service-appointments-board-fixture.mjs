import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
/** Adds T103 preconditions to the owned real journey runtime. New appointments,
 * attendance, local settlement and cancellation use canonical HTTP writers.
 * The order-only sentinel is explicitly imported historical data, no payment. */
export async function prepareAppointmentBoardFixtures(runtime,journeys){
  assert.ok(journeys?.scenarios instanceof Map,'appointment_board_requires_owned_journeys');
  const evidence=runtime.evidence();assert.equal(evidence.canonicalAppModule,true);assert.equal(evidence.authOverrides,false);assert.equal(evidence.repositoryOverrides,false);assert.equal(evidence.providerCalls,0);
  const marker=JSON.parse(await runtime.db.sql('SELECT json_build_object(\'runId\',run_id) FROM synthetic_native_marker;'));assert.equal(marker.runId,runtime.db.runId);
  assert.equal(typeof journeys.boardBase,'function','appointment_board_requires_private_base');
  const metadata=new Map(),boardCases=new Map();
  const history=async(seed,date,extra={})=>{
    const sessionId='board-history-'+randomUUID(),orderId=randomUUID(),externalId='HISTORICO-'+randomUUID();
    await runtime.db.sql(`INSERT INTO checkout_sessions(id,merchant_id,session_id,global_user_id,conversation_id,cart,customer,created_at,updated_at) VALUES (${sql(randomUUID())},${sql(seed.merchant_id)},${sql(sessionId)},${sql('buyer-'+sessionId)},${sql('conversation-'+sessionId)},'{"items":[],"currency":"BRL","total":50}'::jsonb,'{"fullName":"Cliente histórico do quadro"}'::jsonb,now(),now()); INSERT INTO completed_orders(id,merchant_id,session_id,external_order_id,order_total,currency,status,completed_at,line_items_json) VALUES (${sql(orderId)},${sql(seed.merchant_id)},${sql(sessionId)},${sql(externalId)},50,'BRL','approved',now(),'[]'::jsonb);`);
    const facts={runId:runtime.db.runId,fixtureId:seed.fixtureId,date,...extra,orderId,externalOrderId:externalId};
    metadata.set(seed.fixtureId,facts);return facts;
  };
  // Pagination and product-negative cases retain owned historical sentinels,
  // without appending board admissions to the original32-appointment owner.
  for(const name of ['local','products']){const seed=journeys.scenarios.get(name);await history(seed,seed.manualDate);}
  const boardCase=(caseKey,navigation=false)=>{
    assert.equal(typeof caseKey,'string');assert.match(caseKey,/^[a-f0-9]{64}$/);assert.equal(typeof navigation,'boolean');
    const key=(navigation?'navigation:':'board:')+caseKey;
    if(!boardCases.has(key))boardCases.set(key,(async()=>{
      const owner=await journeys.boardBase(caseKey,navigation);
  let seedOrdinal=0;
  const request=async(path,method='GET',body,auth=owner)=>{
    const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+auth.access_token,...(body===undefined?{}:{'content-type':'application/json','idempotency-key':body.commandId??randomUUID()})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const ordinal=++seedOrdinal,expected=method==='POST'?201:200;
    if(response.status!==expected){const remaining=response.headers.get('x-ratelimit-remaining');console.error('owned_board_seed_failure',JSON.stringify({ordinal,method,status:response.status,expected,quotaRemaining:remaining!==null&&/^[0-9]{1,6}$/.test(remaining)?Number(remaining):null}));}
    const value=await response.json();assert.equal(response.status,method==='POST'?201:200,'owned_board_seed_http_status');return value;
  };
  const root=`/merchants/${owner.merchant_id}/service-appointments`,date=owner.manualDate;
  const setPolicy=async paymentMode=>{const saved=await request('/merchants/me/service-business-policy','GET');const policy=await request('/merchants/me/service-business-policy','PUT',{expectedVersion:saved.version,paymentMode,holdEnabled:false,holdMinutes:null,admissionsEnabled:true});owner.policyVersion=policy.version;return policy;};
  const create=async(label,index,selectors={})=>{
    const made=await request(root+'/manual','POST',{commandId:randomUUID(),productId:selectors.productId??owner.productId,variantId:selectors.variantId??owner.variantId,professionalId:selectors.professionalId??owner.professionalId,expectedProfessionalVersion:selectors.professionalVersion??owner.professionalVersion,expectedPolicyVersion:owner.policyVersion,startsAt:date+`T${String(11+Math.floor(index/2)).padStart(2,'0')}:${index%2?'30':'00'}:00.000Z`,customer:{kind:'contact',name:'Quadro local '+label,email:'board@example.test'}});
    return made.appointment;
  };
  // Navigation checks need one nonempty canonical booking, not the seven-state board.
  if(navigation){
    const scheduled=await create('navigation',0);
    assert.equal(typeof scheduled.id,'string');assert.ok(scheduled.id);
    assert.equal(scheduled.merchantId,owner.merchant_id);assert.equal(scheduled.professionalId,owner.professionalId);
    assert.equal(scheduled.productId,owner.productId);assert.equal(scheduled.variantId,owner.variantId);
    assert.equal(scheduled.operationalStatus,'scheduled');assert.equal(Date.parse(scheduled.startsAt),Date.parse(date+'T11:00:00.000Z'));
    const finance=JSON.parse(await runtime.db.sql(`SELECT json_build_object('payments',coalesce((SELECT json_agg(json_build_object('merchantId',merchant_id,'appointmentId',appointment_id,'mode',mode,'status',status,'amountCents',amount_cents,'currency',currency,'paymentIntentId',payment_intent_id,'provider',provider,'providerPaymentId',provider_payment_id,'providerEvidence',provider_evidence,'receivedAt',received_at)) FROM appointment_payments WHERE merchant_id=${sql(owner.merchant_id)} AND appointment_id=${sql(scheduled.id)}),'[]'::json));`));
    assert.equal(Array.isArray(finance.payments),true);assert.equal(finance.payments.length,1);
    const payment=finance.payments[0];assert.equal(payment.merchantId,owner.merchant_id);assert.equal(payment.appointmentId,scheduled.id);
    assert.equal(payment.mode,'at_attendance');assert.equal(payment.status,'pending');assert.equal(payment.amountCents,5000);assert.equal(payment.currency,'BRL');
    assert.deepEqual([payment.paymentIntentId,payment.provider,payment.providerPaymentId,payment.providerEvidence,payment.receivedAt],[null,null,null,null,null]);
    owner.appointments.scheduled=scheduled.id;
    await history(owner,date,{navigationAppointmentId:scheduled.id});
    console.log('owned_board_case_precondition',JSON.stringify({freshMerchant:true,canonicalAppointmentAdmissions:1,canonicalBoardHttp:seedOrdinal,navigation:true,noQuotaReset:true}));
    return owner;
  }
  const boardIds={};
  await setPolicy('online');const pending=await create('pending',0);assert.equal(pending.operationalStatus,'pending');boardIds.pending=pending.id;
  await setPolicy('at_attendance');
  for(const [index,status]of ['scheduled','in_service','completed','no_show','cancelled'].entries()){
    let appointment=await create(status,index+1);const id=appointment.id;boardIds[status]=id;
    const transition=async action=>{const result=await request(root+'/'+id+'/transitions','POST',{commandId:randomUUID(),expectedVersion:appointment.version,action});appointment=result.appointment;};
    if(status==='in_service'||status==='completed')await transition('start_service');
    if(status==='completed')await transition('complete_service');
    if(status==='no_show')await transition('no_show');
    if(status==='cancelled'){const policies=await request(root+'/'+id+'/operation-policy');const cancelled=await request(root+'/'+id+'/cancel','POST',{commandId:randomUUID(),operatorRequestId:randomUUID(),expectedVersion:appointment.version,policyHash:policies.hash});appointment=cancelled.appointment;}
    assert.equal(appointment.operationalStatus,status);
    if(status==='scheduled'){const summary=await request(root+'/'+id+'/operation-summary'),balance=summary.localPayments.find(row=>row.canRecordReceipt);assert.ok(balance);await request(root+'/'+id+'/attendance-receipts','POST',{commandId:randomUUID(),paymentId:balance.paymentId,expectedPaymentVersion:balance.paymentVersion,amountCents:balance.remainingCents,currency:balance.currency,paymentMethod:'Pix presencial sintético'});}
  }
  const product=await request(`/merchants/${owner.merchant_id}/products`,'POST',{name:'Serviço secundário do quadro',type:'service',categoryId:owner.categoryId,metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:30,slots:[]}},variants:[{sku:'board-'+randomUUID(),basePriceInCents:7000,currency:'BRL'}]});
  const professional=await request(`/merchants/${owner.merchant_id}/service-professionals`,'POST',{publicName:'Bruno · quadro',timeZone:'America/Sao_Paulo',isPublished:true,productIds:[product.id]});
  const grade=await request(`/merchants/${owner.merchant_id}/service-professionals/${professional.id}/availability`,'PUT',{expectedVersion:professional.version,timeZone:'America/Sao_Paulo',rows:Array.from({length:7},(_,weekday)=>({weekday,startMinute:480,endMinute:1080}))});
  const second=await create('segundo serviço',6,{productId:product.id,variantId:product.variants[0].id,professionalId:professional.id,professionalVersion:grade.version});
      await history(owner,date,{boardIds,secondaryAppointmentId:second.id,secondaryProductId:product.id,secondaryProfessionalId:professional.id});
      console.log('owned_board_case_precondition',JSON.stringify({freshMerchant:true,canonicalAppointmentAdmissions:7,canonicalBoardHttp:seedOrdinal,navigation,noQuotaReset:true}));
      return owner;
    })());
    return boardCases.get(key);
  };
  journeys.boardLocal=caseKey=>boardCase(caseKey,false);
  journeys.boardNavigationLocal=caseKey=>boardCase(caseKey,true);
  return{metadata,journeys};
}

export function installAppointmentBoardFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const match=/^\/__service\/appointment-board\/([a-f0-9-]{36})(\/orders)?$/.exec(request.url??'');
    if(request.method!=='GET'||!match)return next();
    if(request.headers.host!=='127.0.0.1:5187'||request.headers['x-service-local-run-id']!==runtime.db.runId){response.statusCode=403;response.end('owned_board_run_required');return;}
    void(async()=>{
      const facts=prepared.metadata.get(match[1]),seed=prepared.journeys.fixtures.get(match[1]);
      if(!facts||!seed){response.statusCode=404;response.end('unknown_owned_board_fixture');return;}
      response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
      if(!match[2]){response.end(JSON.stringify(facts));return;}
      const raw=await runtime.db.sql(`SELECT json_build_object('runId',(SELECT run_id FROM synthetic_native_marker),'orders',coalesce((SELECT json_agg(row_to_json(o) ORDER BY o.id) FROM completed_orders o WHERE merchant_id=${sql(seed.merchant_id)}),'[]'::json),'sessions',coalesce((SELECT json_agg(row_to_json(s) ORDER BY s.id) FROM checkout_sessions s WHERE merchant_id=${sql(seed.merchant_id)} AND session_id LIKE 'board-history-%'),'[]'::json));`);
      const data=JSON.parse(raw);assert.equal(data.runId,runtime.db.runId);response.end(JSON.stringify(data));
    })().catch(()=>{response.statusCode=500;response.end('owned_board_fixture_failed');});
  });
}
