import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
const day=(base,offset)=>new Date(Date.parse(base+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
/** Opt-in loopback fixture only. All appointments/financial changes use actual
 * API writers; SQL below declares account/customer preconditions or reads facts. */
function assertRestrictedStaffProfile(raw,auth,merchantId){
  const profile=raw.data??raw;
  assert.deepEqual(Object.keys(profile).sort(),['id','name','role','slug','userId'].sort());
  assert.equal(profile.id,merchantId);assert.equal(profile.userId,auth.user_id);assert.equal(profile.role,'staff');
  assert.equal(typeof profile.name,'string');assert.ok(profile.name.trim());assert.equal(typeof profile.slug,'string');assert.ok(profile.slug.trim());
}
export async function prepareAppointmentJourneyFixtures(runtime){
  const origin=new URL(runtime.apiOrigin);assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');
  const marker=JSON.parse(await runtime.db.sql(`SELECT json_build_object('runId',run_id) FROM synthetic_native_marker;`));assert.equal(marker.runId,runtime.db.runId);
  assert.equal(runtime.evidence().canonicalAppModule,true);assert.equal(runtime.evidence().authOverrides,false);assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().providerCalls,0);
  const scenarios=new Map(),fixtures=new Map(),inventory=[];
  const request=async(path,method='GET',body,auth,expected=method==='POST'?201:200)=>{
    const began=Date.now(),response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{...(auth?{authorization:'Bearer '+auth.access_token}:{}),...(body===undefined?{}:{'content-type':'application/json','idempotency-key':body.commandId??randomUUID()})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    inventory.push({method,path:path.split('?')[0].replace(/\/merchants\/(?!me(?:\/|$))[^/]+/g,'/merchants/:owned').replace(/\/service-professionals\/[^/]+/g,'/service-professionals/:owned'),status:response.status,elapsedMs:Date.now()-began,remaining:response.headers.get('x-ratelimit-remaining')});
    const value=await response.json();assert.equal(response.status,expected,'owned_journey_seed_http_status');return value;
  };
  async function declare(auth,plan='starter',extra={}){
    const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${sql('journey-'+randomUUID())},store_settings=coalesce(store_settings,'{}'::jsonb)||'{"registration_pending":false,"oauth_registration_pending":false,"plan_selection_pending":false}'::jsonb WHERE id=${sql(auth.merchant_id)};
      INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${sql(auth.merchant_id)},${sql(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
      INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES (${sql(auth.merchant_id)},'active',${sql(plan)},now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status='active',plan_key=EXCLUDED.plan_key,current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();
      INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${sql(auth.merchant_id)},'[]'::jsonb,1,${sql(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`);
    await request('/checkout-settings','GET',undefined,auth);Object.assign(auth,extra);
  }
  async function register(mode,label,plan='starter'){
    const email=`journey-${label}-${randomUUID()}@example.test`,password='SyntheticPassword123!',storeName='Empresa local '+label;
    const raw=await request('/auth/register','POST',{merchant_name:storeName,email,password,business_mode:mode});
    const auth={...raw,email,password,mode,role:'OWNER',storeName};await declare(auth,plan);
    const rawProfile=await request('/merchants/me','GET',undefined,auth),profile=rawProfile.data??rawProfile;
    assert.equal(profile.id,auth.merchant_id);assert.equal(profile.businessMode,mode);assert.equal(profile.businessModeSelectionState,'selected');assert.equal(profile.userId??profile.user_id,auth.user_id);
    return auth;
  }
  // Scale is an upfront capability precondition for real multi-store;
  // no denied company is upgraded to conceal an unsupported request.
  const owner=await register('services','servicos','scale'),online=await register('services','online'),products=await register('products','produtos'),staff=await register('services','staff'),review=await register('services','revisao'),expired=await register('services','assinatura');
  const baseDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10),toDate=day(baseDate,3);
  async function service(auth,label,paymentMode){
    const category=await request(`/merchants/${auth.merchant_id}/categories`,'POST',{name:'Atendimentos '+label},auth);
    const product=await request(`/merchants/${auth.merchant_id}/products`,'POST',{name:'Consulta local '+label,type:'service',categoryId:category.id,metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:30,slots:[]}},variants:[{sku:'journey-'+randomUUID(),basePriceInCents:5000,currency:'BRL'}]},auth);
    const professional=await request(`/merchants/${auth.merchant_id}/service-professionals`,'POST',{publicName:'Ana · '+label,timeZone:'America/Sao_Paulo',isPublished:true,productIds:[product.id]},auth);
    const grade=await request(`/merchants/${auth.merchant_id}/service-professionals/${professional.id}/availability`,'PUT',{expectedVersion:professional.version,timeZone:'America/Sao_Paulo',rows:Array.from({length:7},(_,weekday)=>({weekday,startMinute:480,endMinute:1080}))},auth);
    const policy=await request('/merchants/me/service-business-policy','PUT',{expectedVersion:0,paymentMode,holdEnabled:false,holdMinutes:null,admissionsEnabled:true},auth);
    assert.equal(policy.status,'configured');assert.equal(grade.timeZone,'America/Sao_Paulo');
    return{productId:product.id,productName:product.name,variantId:product.variants[0].id,professionalId:professional.id,professionalName:professional.publicName,professionalVersion:grade.version,categoryId:category.id,policyVersion:policy.version};
  }
  Object.assign(owner,await service(owner,'serviços','at_attendance'));Object.assign(online,await service(online,'online','online'));
  // The canonical store-policy writer shares these returns sources. It avoids
  // invoking the separate knowledge editor's lazy ONNX/model downloader.
  const savedPolicies=await request('/merchants/me/store-settings','PUT',{policies:{returns:'Atendimentos locais de teste. Cancelamento e remarcação são solicitações explícitas do operador. Qualquer análise financeira é separada; este texto não promete estorno.'}},owner);
  assert.ok(savedPolicies.policies?.returns?.includes('Cancelamento e remarcação'));
  const knownCustomerId='journey-known-'+randomUUID(),foreignCustomerId='journey-foreign-'+randomUUID();
  for(const [auth,buyer,name]of [[owner,knownCustomerId,'Cliente cadastrado local'],[products,foreignCustomerId,'Cliente privado de outra empresa']]){
    await runtime.db.sql(`INSERT INTO checkout_sessions(id,merchant_id,session_id,global_user_id,conversation_id,cart,customer,created_at,updated_at) VALUES (${sql(randomUUID())},${sql(auth.merchant_id)},${sql('session-'+buyer)},${sql(buyer)},${sql('conversation-'+buyer)},'{"items":[],"currency":"BRL","total":0}'::jsonb,${sql(JSON.stringify({fullName:name,phone:'+5521999990000'}))}::jsonb,now(),now());`);
  }
  // T80 preconditions are actual T31 admissions, not fake appointment/finance rows.
  owner.appointments={};
  for(const [index,label]of ['transition','cancel','reschedule-conflict','receipt','unknown','no-show'].entries()){
    const startsAt=day(baseDate,2)+`T${String(13+Math.floor(index/2)).padStart(2,'0')}:${index%2?'30':'00'}:00.000Z`;
    const body={commandId:randomUUID(),productId:owner.productId,variantId:owner.variantId,professionalId:owner.professionalId,expectedProfessionalVersion:owner.professionalVersion,expectedPolicyVersion:owner.policyVersion,startsAt,customer:{kind:'contact',name:'Cliente local '+label,email:'cliente@example.test'}};
    const result=await request(`/merchants/${owner.merchant_id}/service-appointments/manual`,'POST',body,owner);assert.equal(result.appointment.operationalStatus,'scheduled');owner.appointments[label]=result.appointment.id;
  }
  // One honest pagination precondition:26 actual canonical admissions over two
  // days. No SQL card/appointment fabrication, quota reset or setup retry.
  for(let index=0;index<26;index++){
    const minute=480+(index%20)*30,startsAt=day(baseDate,Math.floor(index/20))+`T${String(Math.floor(minute/60)+3).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00.000Z`;
    const result=await request(`/merchants/${owner.merchant_id}/service-appointments/manual`,'POST',{commandId:randomUUID(),productId:owner.productId,variantId:owner.variantId,professionalId:owner.professionalId,expectedProfessionalVersion:owner.professionalVersion,expectedPolicyVersion:owner.policyVersion,startsAt,customer:{kind:'contact',name:'Cliente página '+index,email:'pagina@example.test'}},owner);assert.equal(result.appointment.operationalStatus,'scheduled');
  }
  await runtime.db.sql(`UPDATE merchant_users SET merchant_id=${sql(owner.merchant_id)},role='staff' WHERE id=${sql(staff.user_id)};UPDATE merchant_team_members SET merchant_id=${sql(owner.merchant_id)},role='STAFF' WHERE user_id=${sql(staff.user_id)};
    UPDATE merchants SET business_mode_needs_review=true WHERE id=${sql(review.merchant_id)};
    UPDATE merchant_billing_subscriptions SET status='cancelled',current_period_end=now()-interval '2 days',trial_ends_at=now()-interval '2 days',updated_at=now() WHERE merchant_id=${sql(expired.merchant_id)};`);
  Object.assign(staff,await request('/auth/login','POST',{email:staff.email,password:staff.password}),{role:'STAFF'});
  const staffProfile=await request('/merchants/me','GET',undefined,staff,200);assertRestrictedStaffProfile(staffProfile,staff,owner.merchant_id);
  const reviewRaw=await request('/merchants/me','GET',undefined,review);assert.equal((reviewRaw.data??reviewRaw).businessModeSelectionState,'review_required');
  const expiredBilling=await request('/billing/subscription','GET',undefined,expired);assert.equal(expiredBilling.trial_expired,true);
  const child=await request('/merchants/me/stores','POST',{name:'Loja de produtos local'},owner);
  const childAuth=await request(`/merchants/me/stores/${child.id}/activate`,'POST',{},owner);
  assert.equal(childAuth.merchant_id,child.id);assert.equal(childAuth.user_id,owner.user_id);
  await declare(childAuth,'scale');
  await runtime.db.sql(`UPDATE merchants SET business_mode='products',business_mode_selected_at=now(),business_mode_needs_review=false WHERE id=${sql(child.id)};`);
  const childRaw=await request('/merchants/me','GET',undefined,childAuth),childProfile=childRaw.data??childRaw;assert.equal(childProfile.businessMode,'products');
  for(const [name,auth]of [['local',owner],['online',online],['products',products],['staff',staff],['review',review],['expired',expired]]){
    const value={...auth,fixtureId:randomUUID(),runId:runtime.db.runId,baseDate,toDate,operationsDate:day(baseDate,2),manualDate:day(baseDate,3),knownCustomerId,foreignCustomerId,foreignMerchantId:products.merchant_id,childStoreId:child.id,childStoreName:child.name};
    scenarios.set(name,value);fixtures.set(value.fixtureId,value);
  }
  // T79 cases require their own current merchant quota and their own empty
  // appointment baseline. T80/T103 seed admissions remain on the original owner.
  // Cache one preparation Promise per private case: no retry or quota reset.
  const manualCases=new Map();
  const manualLocal=caseKey=>{
    assert.equal(typeof caseKey,'string');assert.match(caseKey,/^[a-f0-9]{64}$/);
    if(!manualCases.has(caseKey))manualCases.set(caseKey,(async()=>{
      const began=inventory.length,auth=await register('services','manual-'+caseKey.slice(0,12),'scale');
      Object.assign(auth,await service(auth,'manual local','at_attendance'));
      await request('/merchants/me/store-settings','PUT',{policies:{returns:savedPolicies.policies.returns}},auth);
      const customerId='journey-known-'+randomUUID();
      await runtime.db.sql(`INSERT INTO checkout_sessions(id,merchant_id,session_id,global_user_id,conversation_id,cart,customer,created_at,updated_at) VALUES (${sql(randomUUID())},${sql(auth.merchant_id)},${sql('session-'+customerId)},${sql(customerId)},${sql('conversation-'+customerId)},'{"items":[],"currency":"BRL","total":0}'::jsonb,${sql(JSON.stringify({fullName:'Cliente cadastrado local',phone:'+5521999990000'}))}::jsonb,now(),now());`);
      const child=await request('/merchants/me/stores','POST',{name:'Loja de produtos local'},auth);
      const childAuth=await request(`/merchants/me/stores/${child.id}/activate`,'POST',{},auth);
      assert.equal(childAuth.merchant_id,child.id);assert.equal(childAuth.user_id,auth.user_id);
      await declare(childAuth,'scale');
      await runtime.db.sql(`UPDATE merchants SET business_mode='products',business_mode_selected_at=now(),business_mode_needs_review=false WHERE id=${sql(child.id)};`);
      const rawProfile=await request('/merchants/me','GET',undefined,childAuth);assert.equal((rawProfile.data??rawProfile).businessMode,'products');
      const value={...auth,appointments:{},fixtureId:randomUUID(),runId:runtime.db.runId,baseDate,toDate,operationsDate:day(baseDate,2),manualDate:day(baseDate,3),knownCustomerId:customerId,foreignCustomerId,foreignMerchantId:products.merchant_id,childStoreId:child.id,childStoreName:child.name};
      fixtures.set(value.fixtureId,value);
      console.log('service_appointment_journey_case_precondition',JSON.stringify({purpose:'manual-local',freshMerchant:true,canonicalAppointmentAdmissions:0,totalHttp:inventory.length-began,actualStatuses:inventory.slice(began).map(row=>row.status),noQuotaReset:true}));
      return value;
    })());
    return manualCases.get(caseKey);
  };
  // T80 operations need their named canonical appointments, not T103 pagination.
  // Each private case gets a real tenant and all six original API admissions.
  const operationsCases=new Map();
  const operationsLocal=caseKey=>{
    assert.equal(typeof caseKey,'string');assert.match(caseKey,/^[a-f0-9]{64}$/);
    if(!operationsCases.has(caseKey))operationsCases.set(caseKey,(async()=>{
      const began=inventory.length,auth=await register('services','operations-'+caseKey.slice(0,12),'scale');
      Object.assign(auth,await service(auth,'operacoes locais','at_attendance'));
      await request('/merchants/me/store-settings','PUT',{policies:{returns:savedPolicies.policies.returns}},auth);
      auth.appointments={};
      for(const [index,label]of ['transition','cancel','reschedule-conflict','receipt','unknown','no-show'].entries()){
        const startsAt=day(baseDate,2)+`T${String(13+Math.floor(index/2)).padStart(2,'0')}:${index%2?'30':'00'}:00.000Z`;
        const body={commandId:randomUUID(),productId:auth.productId,variantId:auth.variantId,professionalId:auth.professionalId,expectedProfessionalVersion:auth.professionalVersion,expectedPolicyVersion:auth.policyVersion,startsAt,customer:{kind:'contact',name:'Cliente local '+label,email:'cliente@example.test'}};
        const result=await request(`/merchants/${auth.merchant_id}/service-appointments/manual`,'POST',body,auth);assert.equal(result.appointment.operationalStatus,'scheduled');auth.appointments[label]=result.appointment.id;
      }
      const value={...auth,fixtureId:randomUUID(),runId:runtime.db.runId,baseDate,toDate,operationsDate:day(baseDate,2),manualDate:day(baseDate,3)};
      fixtures.set(value.fixtureId,value);
      console.log('service_appointment_journey_case_precondition',JSON.stringify({purpose:'operations-local',freshMerchant:true,canonicalAppointmentAdmissions:6,canonicalLabels:Object.keys(auth.appointments),totalHttp:inventory.length-began,actualStatuses:inventory.slice(began).map(row=>row.status),noQuotaReset:true}));
      return value;
    })());
    return operationsCases.get(caseKey);
  };
  // Route capability checks need independent authenticated tenants, not T103's32.
  const routesLocalCases=new Map(),routesStaffCases=new Map();
  const routesLocal=caseKey=>{
    assert.equal(typeof caseKey,'string');assert.match(caseKey,/^[a-f0-9]{64}$/);
    if(!routesLocalCases.has(caseKey))routesLocalCases.set(caseKey,(async()=>{
      const began=inventory.length,auth=await register('services','routes-local-'+caseKey.slice(0,12),'scale');
      Object.assign(auth,await service(auth,'rotas locais','at_attendance'));
      await request('/merchants/me/store-settings','PUT',{policies:{returns:savedPolicies.policies.returns}},auth);
      const manualDate=day(baseDate,3),commandId=randomUUID();
      const admitted=await request(`/merchants/${auth.merchant_id}/service-appointments/manual`,'POST',{commandId,
        productId:auth.productId,variantId:auth.variantId,professionalId:auth.professionalId,
        expectedProfessionalVersion:auth.professionalVersion,expectedPolicyVersion:auth.policyVersion,
        startsAt:manualDate+'T11:00:00.000Z',customer:{kind:'contact',name:'Cliente real da rota local',email:'rotas@example.test'}},auth,201);
      const scheduled=admitted.appointment;assert.equal(admitted.replayed,false);assert.equal(typeof scheduled.id,'string');assert.ok(scheduled.id);
      assert.equal(scheduled.merchantId,auth.merchant_id);assert.equal(scheduled.professionalId,auth.professionalId);
      assert.equal(scheduled.productId,auth.productId);assert.equal(scheduled.variantId,auth.variantId);assert.equal(scheduled.operationalStatus,'scheduled');
      assert.equal(Date.parse(scheduled.startsAt),Date.parse(manualDate+'T11:00:00.000Z'));
      const finance=JSON.parse(await runtime.db.sql(`SELECT json_build_object('payments',coalesce((SELECT json_agg(json_build_object('merchantId',merchant_id,'appointmentId',appointment_id,'mode',mode,'status',status,'amountCents',amount_cents,'currency',currency,'paymentIntentId',payment_intent_id,'provider',provider,'providerPaymentId',provider_payment_id,'providerEvidence',provider_evidence,'receivedAt',received_at)) FROM appointment_payments WHERE merchant_id=${sql(auth.merchant_id)} AND appointment_id=${sql(scheduled.id)}),'[]'::json));`));
      assert.equal(Array.isArray(finance.payments),true);assert.equal(finance.payments.length,1);
      const payment=finance.payments[0];assert.equal(payment.merchantId,auth.merchant_id);assert.equal(payment.appointmentId,scheduled.id);
      assert.equal(payment.mode,'at_attendance');assert.equal(payment.status,'pending');assert.equal(payment.amountCents,5000);assert.equal(payment.currency,'BRL');
      assert.deepEqual([payment.paymentIntentId,payment.provider,payment.providerPaymentId,payment.providerEvidence,payment.receivedAt],[null,null,null,null,null]);
      const child=await request('/merchants/me/stores','POST',{name:'Loja de produtos local'},auth);
      const childAuth=await request(`/merchants/me/stores/${child.id}/activate`,'POST',{},auth);
      assert.equal(childAuth.merchant_id,child.id);assert.equal(childAuth.user_id,auth.user_id);
      await declare(childAuth,'scale');
      await runtime.db.sql(`UPDATE merchants SET business_mode='products',business_mode_selected_at=now(),business_mode_needs_review=false WHERE id=${sql(child.id)};`);
      const rawProfile=await request('/merchants/me','GET',undefined,childAuth);assert.equal((rawProfile.data??rawProfile).businessMode,'products');
      const value={...auth,appointments:{scheduled:scheduled.id},fixtureId:randomUUID(),runId:runtime.db.runId,baseDate,toDate,operationsDate:day(baseDate,2),manualDate:day(baseDate,3),childStoreId:child.id,childStoreName:child.name};
      fixtures.set(value.fixtureId,value);
      console.log('service_appointment_journey_case_precondition',JSON.stringify({purpose:'routes-local',freshMerchant:true,canonicalAppointmentAdmissions:1,realChildActivation:true,totalHttp:inventory.length-began,actualStatuses:inventory.slice(began).map(row=>row.status),noQuotaReset:true}));
      return value;
    })());
    return routesLocalCases.get(caseKey);
  };
  const routesStaff=caseKey=>{
    assert.equal(typeof caseKey,'string');assert.match(caseKey,/^[a-f0-9]{64}$/);
    if(!routesStaffCases.has(caseKey))routesStaffCases.set(caseKey,(async()=>{
      const began=inventory.length,owner=await register('services','routes-owner-'+caseKey.slice(0,12),'scale'),staff=await register('services','routes-staff-'+caseKey.slice(0,12));
      const staffUserId=staff.user_id;
      await runtime.db.sql(`UPDATE merchant_users SET merchant_id=${sql(owner.merchant_id)},role='staff' WHERE id=${sql(staff.user_id)};UPDATE merchant_team_members SET merchant_id=${sql(owner.merchant_id)},role='STAFF' WHERE user_id=${sql(staff.user_id)};`);
      Object.assign(staff,await request('/auth/login','POST',{email:staff.email,password:staff.password}),{role:'STAFF'});
      assert.equal(staff.merchant_id,owner.merchant_id);assert.equal(staff.user_id,staffUserId);
      const profile=await request('/merchants/me','GET',undefined,staff,200);assertRestrictedStaffProfile(profile,staff,owner.merchant_id);
      const value={...staff,appointments:{},fixtureId:randomUUID(),runId:runtime.db.runId,baseDate,toDate,operationsDate:day(baseDate,2),manualDate:day(baseDate,3)};
      fixtures.set(value.fixtureId,value);
      console.log('service_appointment_journey_case_precondition',JSON.stringify({purpose:'routes-staff',freshMerchant:true,canonicalAppointmentAdmissions:0,realStaffLoginAndRestrictedProfile200:true,totalHttp:inventory.length-began,actualStatuses:inventory.slice(began).map(row=>row.status),noQuotaReset:true}));
      return value;
    })());
    return routesStaffCases.get(caseKey);
  };
  // Only the board module calls this existing-register/service base constructor.
  // It creates no appointments; board cases add exactly their seven real admissions.
  const boardBase=async(caseKey,navigation=false)=>{
    assert.equal(typeof caseKey,'string');assert.match(caseKey,/^[a-f0-9]{64}$/);assert.equal(typeof navigation,'boolean');
    const auth=await register('services','board-'+caseKey.slice(0,12),'scale');
    Object.assign(auth,await service(auth,'quadro local','at_attendance'));
    await request('/merchants/me/store-settings','PUT',{policies:{returns:savedPolicies.policies.returns}},auth);
    let childStoreId,childStoreName;
    if(navigation){
      const child=await request('/merchants/me/stores','POST',{name:'Loja de produtos local'},auth);
      const childAuth=await request(`/merchants/me/stores/${child.id}/activate`,'POST',{},auth);
      assert.equal(childAuth.merchant_id,child.id);assert.equal(childAuth.user_id,auth.user_id);
      await declare(childAuth,'scale');
      await runtime.db.sql(`UPDATE merchants SET business_mode='products',business_mode_selected_at=now(),business_mode_needs_review=false WHERE id=${sql(child.id)};`);
      const rawProfile=await request('/merchants/me','GET',undefined,childAuth);assert.equal((rawProfile.data??rawProfile).businessMode,'products');
      childStoreId=child.id;childStoreName=child.name;
    }
    const value={...auth,appointments:{},fixtureId:randomUUID(),runId:runtime.db.runId,baseDate,toDate,operationsDate:day(baseDate,2),manualDate:day(baseDate,3),...(navigation?{childStoreId,childStoreName}:{})};
    fixtures.set(value.fixtureId,value);return value;
  };
  console.log('service_appointment_journey_seed_inventory',JSON.stringify({registrations:6,canonicalAppointmentAdmissions:32,totalHttp:inventory.length,actualStatuses:inventory.map(row=>row.status),noQuotaReset:true}));
  return{scenarios,fixtures,inventory,manualLocal,operationsLocal,routesLocal,routesStaff,boardBase};
}

/** Private opt-in test-server reads; never installed in AppModule/production. */
export function installAppointmentJourneyFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const scenario=/^\/__service\/appointment-journeys\/(local|online|products|staff|review|expired)$/.exec(request.url??''),snapshot=/^\/__service\/appointment-journeys\/([a-f0-9-]{36})\/snapshot$/.exec(request.url??'');
    if(request.method!=='GET'||!scenario&&!snapshot)return next();
    if(request.headers.host!=='127.0.0.1:5187'||request.headers['x-service-local-run-id']!==runtime.db.runId){response.statusCode=403;response.end('owned_journey_run_required');return;}
    void(async()=>{
      let fixture=scenario?prepared.scenarios.get(scenario[1]):prepared.fixtures.get(snapshot[1]);
      if(scenario&&request.headers['x-service-local-journey-purpose']!==undefined){
        const purpose=request.headers['x-service-local-journey-purpose'];
        assert.ok(['manual-local','operations-local','routes-local','routes-staff','board-local','board-navigation-local'].includes(purpose));
        assert.equal(scenario[1],purpose==='routes-staff'?'staff':'local');
        const factory=purpose==='manual-local'?prepared.manualLocal:purpose==='operations-local'?prepared.operationsLocal:purpose==='routes-local'?prepared.routesLocal:purpose==='routes-staff'?prepared.routesStaff:purpose==='board-local'?prepared.boardLocal:prepared.boardNavigationLocal;
        assert.equal(typeof factory,'function','owned_journey_purpose_not_installed');
        fixture=await factory(request.headers['x-service-local-journey-case']);
      }
      if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
      if(scenario){response.end(JSON.stringify(fixture));return;}
      const merchant=sql(fixture.merchant_id),value=await runtime.db.sql(`SELECT json_build_object(
        'runId',(SELECT run_id FROM synthetic_native_marker),
        'professionals',coalesce((SELECT json_agg(json_build_object('id',id,'version',version,'timeZone',time_zone) ORDER BY id) FROM service_professionals WHERE merchant_id=${merchant}),'[]'::json),
        'exceptions',coalesce((SELECT json_agg(json_build_object('id',id,'professionalId',professional_id,'kind',kind,'startsAt',starts_at,'endsAt',ends_at,'timeZone',time_zone,'isActive',is_active,'version',version) ORDER BY id) FROM availability_exceptions WHERE merchant_id=${merchant}),'[]'::json),
        'appointments',coalesce((SELECT json_agg(json_build_object('id',id,'merchantId',merchant_id,'professionalId',professional_id,'productId',product_id,'variantId',variant_id,'version',version,'status',operational_status,'startsAt',starts_at,'endsAt',ends_at,'timeZone',time_zone,'priceInCents',price_in_cents,'currency',currency,'buyerGlobalUserId',buyer_global_user_id,'customer',customer_snapshot,'commandId',idempotency_key) ORDER BY id) FROM service_appointments WHERE merchant_id=${merchant}),'[]'::json),
        'payments',coalesce((SELECT json_agg(json_build_object('id',id,'appointmentId',appointment_id,'version',version,'mode',mode,'status',status,'amountCents',amount_cents,'currency',currency,'receivedAt',received_at,'providerBound',payment_intent_id IS NOT NULL OR provider IS NOT NULL OR provider_payment_id IS NOT NULL OR provider_evidence IS NOT NULL) ORDER BY id) FROM appointment_payments WHERE merchant_id=${merchant}),'[]'::json),
        'audits',coalesce((SELECT json_agg(json_build_object('id',id,'appointmentId',appointment_id,'commandId',command_id,'action',action,'version',version,'actorId',actor_id,'origin',origin) ORDER BY id) FROM appointment_audits WHERE merchant_id=${merchant}),'[]'::json),
        'receipts',coalesce((SELECT json_agg(json_build_object('id',id,'paymentId',appointment_payment_id,'amountCents',amount_cents,'currency',currency,'method',payment_method,'operatorId',operator_id,'commandId',idempotency_key) ORDER BY id) FROM attendance_receipts WHERE merchant_id=${merchant}),'[]'::json),
        'events',coalesce((SELECT json_agg(json_build_object('eventId',event_id,'appointmentId',correlation_id,'commandId',causation_id,'type',event_type,'producer',producer) ORDER BY event_id) FROM outbox_messages WHERE merchant_id=${merchant} AND producer IN ('service-booking','service-booking-private')),'[]'::json),
        'stock',coalesce((SELECT json_agg(json_build_object('id',s.id,'variantId',s.variant_id,'quantity',s.quantity,'reserved',s.reserved) ORDER BY s.id) FROM product_stock s JOIN product_variants v ON v.id=s.variant_id JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${merchant}),'[]'::json));`);
      const result=JSON.parse(value);assert.equal(result.runId,runtime.db.runId);response.end(JSON.stringify(result));
    })().catch(()=>{response.statusCode=500;response.end('owned_appointment_journey_fixture_failed');});
  });
}
