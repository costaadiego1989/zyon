import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
/** Real synthetic preconditions, bounded by the existing global setup. */
export async function prepareAttendanceFixtures(runtime){
  const fixtures=new Map(),scenarios=new Map();
  const request=async(path,method='GET',body,auth)=>{
    const began=Date.now();
    const response=await fetch(runtime.apiOrigin+path,{method,signal:AbortSignal.timeout(10000),headers:{...(body===undefined?{}:{'content-type':'application/json','idempotency-key':randomUUID()}),...(auth?{authorization:'Bearer '+auth.access_token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    console.log('service_t75_seed_http',JSON.stringify({method,route:path.replace(/\/c[a-z0-9]{20,}(?=\/|$)/g,'/:id'),status:response.status,elapsedMs:Date.now()-began}));
    const value=await response.json();
    if(response.status!==(method==='POST'?201:200))throw Error('synthetic_attendance_api_failed:'+response.status);
    return value;
  };
  async function register(mode,label){
    const suffix=randomUUID(),email=`t75-${label}-${suffix}@example.test`,password='SyntheticPassword123!';
    const auth=await request('/auth/register','POST',{merchant_name:'Empresa sintética T75 '+label,email,password,business_mode:mode});
    const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${sql('attendance-'+suffix)},store_settings='{"registration_pending":false,"oauth_registration_pending":false,"plan_selection_pending":false}'::jsonb WHERE id=${sql(auth.merchant_id)};
      INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${sql(auth.merchant_id)},${sql(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
      INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES (${sql(auth.merchant_id)},'active','starter',now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status='active',plan_key='starter',current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();
      INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${sql(auth.merchant_id)},'[]'::jsonb,1,${sql(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`);
    // Persist the same existing checkout defaults declared complete in onboarding.
    await request('/checkout-settings','GET',undefined,auth);
    return{...auth,email,password,mode};
  }
  const owner=await register('services','services-owner'),products=await register('products','products-owner');
  const category=await request(`/merchants/${owner.merchant_id}/categories`,'POST',{name:'Atendimento local T75',slug:'atendimento-local-t75'},owner);
  const product=await request(`/merchants/${owner.merchant_id}/products`,'POST',{name:'Consulta local T75',type:'service',categoryId:category.id,
    metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:60,slots:[]}},variants:[{sku:'t75-'+randomUUID(),basePriceInCents:5000}]},owner);
  const professional=await request(`/merchants/${owner.merchant_id}/service-professionals`,'POST',{publicName:'Ana · Atendimento local',publicProfile:{description:'Profissional sintética de teste'},timeZone:'America/Sao_Paulo',isPublished:true,productIds:[product.id]},owner);
  const recurring=await request(`/merchants/${owner.merchant_id}/service-professionals/${professional.id}/availability`,'PUT',{expectedVersion:professional.version,timeZone:'America/Sao_Paulo',rows:[{weekday:1,startMinute:480,endMinute:720}]},owner);
  const exception=await request(`/merchants/${owner.merchant_id}/service-professionals/${professional.id}/availability-exceptions`,'POST',{expectedVersion:recurring.version,kind:'block',startsAt:'2027-01-04T12:00:00.000Z',endsAt:'2027-01-04T13:00:00.000Z',timeZone:'America/Sao_Paulo',reason:'Indisponibilidade sintética T75'},owner);
  await request('/merchants/me/service-business-policy','PUT',{expectedVersion:0,holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',admissionsEnabled:false},owner);
  const staff=await register('services','staff');
  // Same declared staff precondition as the existing authenticated operator fixture.
  await runtime.db.sql(`UPDATE merchant_users SET merchant_id=${sql(owner.merchant_id)},role='staff' WHERE id=${sql(staff.user_id)};
    UPDATE merchant_team_members SET merchant_id=${sql(owner.merchant_id)},role='STAFF' WHERE user_id=${sql(staff.user_id)};`);
  Object.assign(staff,await request('/auth/login','POST',{email:staff.email,password:staff.password}));
  for(const [scenario,auth,role]of [['services-owner',owner,'OWNER'],['products-owner',products,'OWNER'],['services-staff',staff,'STAFF']]){
    if(role==='STAFF'){
      const persisted=JSON.parse(await runtime.db.sql(`SELECT json_build_object('userId',id,'merchantId',merchant_id,'role',role) FROM merchant_users WHERE id=${sql(auth.user_id)};`));
      if(persisted.userId!==auth.user_id||persisted.merchantId!==owner.merchant_id||persisted.role!=='staff')throw Error('synthetic_attendance_staff_scope_required');
      const denied=await fetch(runtime.apiOrigin+'/merchants/me',{headers:{authorization:'Bearer '+auth.access_token},signal:AbortSignal.timeout(10000)});
      const denial=await denied.json();
      if(denied.status!==403||denial.code!=='staff_operation_not_permitted'||denial.detail!=='staff_operation_not_permitted')throw Error('synthetic_attendance_staff_profile_denial_required');
    }
    if(role!=='STAFF'){
      const raw=await request('/merchants/me','GET',undefined,auth),profile=raw.data??raw;
      if(profile.id!==auth.merchant_id||profile.businessMode!==auth.mode||profile.businessModeSelectionState!=='selected'||String(profile.role).toUpperCase()!==role)throw Error('synthetic_attendance_profile_required');
    }
    const fixtureId=randomUUID(),fixture={fixtureId,email:auth.email,password:auth.password,access_token:auth.access_token,merchant_id:auth.merchant_id,mode:auth.mode,role,
      professionalId:professional.id,professionalName:professional.publicName,professionalVersion:exception.version,categoryId:category.id,categoryName:category.name,foreignMerchantId:products.merchant_id};
    scenarios.set(scenario,fixture);fixtures.set(fixtureId,fixture);
  }
  // Policy cases opt in to a real isolated tenant; original named scenarios stay stable.
  const policyCases=new Map();
  const policyCaseOwner=caseKey=>{
    assert.equal(typeof caseKey,'string');assert.match(caseKey,/^[a-f0-9]{64}$/);
    if(!policyCases.has(caseKey))policyCases.set(caseKey,(async()=>{
      const auth=await register('services','policy-'+caseKey.slice(0,12));
      const category=await request(`/merchants/${auth.merchant_id}/categories`,'POST',{name:'Atendimento local T75',slug:'atendimento-local-t75'},auth);
      const product=await request(`/merchants/${auth.merchant_id}/products`,'POST',{name:'Consulta local T75',type:'service',categoryId:category.id,
        metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:60,slots:[]}},variants:[{sku:'t75-'+randomUUID(),basePriceInCents:5000}]},auth);
      const professional=await request(`/merchants/${auth.merchant_id}/service-professionals`,'POST',{publicName:'Ana · Atendimento local',publicProfile:{description:'Profissional sintética de teste'},timeZone:'America/Sao_Paulo',isPublished:true,productIds:[product.id]},auth);
      const recurring=await request(`/merchants/${auth.merchant_id}/service-professionals/${professional.id}/availability`,'PUT',{expectedVersion:professional.version,timeZone:'America/Sao_Paulo',rows:[{weekday:1,startMinute:480,endMinute:720}]},auth);
      const exception=await request(`/merchants/${auth.merchant_id}/service-professionals/${professional.id}/availability-exceptions`,'POST',{expectedVersion:recurring.version,kind:'block',startsAt:'2027-01-04T12:00:00.000Z',endsAt:'2027-01-04T13:00:00.000Z',timeZone:'America/Sao_Paulo',reason:'Indisponibilidade sintética T75'},auth);
      await request('/merchants/me/service-business-policy','PUT',{expectedVersion:0,holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',admissionsEnabled:false},auth);
      const raw=await request('/merchants/me','GET',undefined,auth),profile=raw.data??raw;
      if(profile.id!==auth.merchant_id||profile.businessMode!=='services'||profile.businessModeSelectionState!=='selected'||String(profile.role).toUpperCase()!=='OWNER')throw Error('synthetic_policy_case_profile_required');
      const fixtureId=randomUUID(),value={fixtureId,email:auth.email,password:auth.password,access_token:auth.access_token,merchant_id:auth.merchant_id,mode:auth.mode,role:'OWNER',
        professionalId:professional.id,professionalName:professional.publicName,professionalVersion:exception.version,categoryId:category.id,categoryName:category.name,foreignMerchantId:products.merchant_id};
      fixtures.set(fixtureId,value);
      console.log('service_policy_case_precondition',JSON.stringify({purpose:'policy-local',freshMerchant:true,canonicalPaymentMode:'at_attendance',holdEnabled:false,admissionsEnabled:false,noQuotaReset:true}));
      return value;
    })());
    return policyCases.get(caseKey);
  };
  return{scenarios,fixtures,policyCaseOwner};
}

export function installAttendanceFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const seed=/^\/__service\/attendance\/(services-owner|products-owner|services-staff)$/.exec(request.url??'');
    const snapshot=/^\/__service\/attendance\/([a-f0-9-]{36})\/snapshot$/.exec(request.url??'');
    if(!((seed&&request.method==='POST')||(snapshot&&request.method==='GET')))return next();
    void(async()=>{
      if(seed){let fixture=prepared.scenarios.get(seed[1]);
        if(request.headers['x-service-local-attendance-purpose']!==undefined){
          assert.equal(request.headers.host,'127.0.0.1:5187');assert.equal(request.headers['x-service-local-run-id'],runtime.db.runId);
          assert.equal(request.headers['x-service-local-attendance-purpose'],'policy-local');assert.equal(seed[1],'services-owner');
          fixture=await prepared.policyCaseOwner(request.headers['x-service-local-attendance-case']);
        }
        if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}response.setHeader('content-type','application/json');response.end(JSON.stringify(fixture));return;}
      const fixture=prepared.fixtures.get(snapshot[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      const merchant=sql(fixture.merchant_id);
      const value=await runtime.db.sql(`SELECT json_build_object(
        'professionals',coalesce((SELECT json_agg(json_build_object('id',id,'publicName',public_name,'timeZone',time_zone,'isActive',is_active,'isPublished',is_published,'version',version) ORDER BY id) FROM service_professionals WHERE merchant_id=${merchant}),'[]'::json),
        'links',coalesce((SELECT json_agg(json_build_object('professionalId',professional_id,'productId',product_id,'isActive',is_active,'version',version) ORDER BY id) FROM professional_services WHERE merchant_id=${merchant}),'[]'::json),
        'categories',coalesce((SELECT json_agg(json_build_object('id',id,'name',name,'isActive',is_active) ORDER BY id) FROM product_categories WHERE merchant_id=${merchant}),'[]'::json),
        'rows',coalesce((SELECT json_agg(json_build_object('professionalId',professional_id,'weekday',weekday,'startMinute',start_minute,'endMinute',end_minute,'timeZone',time_zone,'version',version) ORDER BY id) FROM professional_availability WHERE merchant_id=${merchant}),'[]'::json),
        'exceptions',coalesce((SELECT json_agg(json_build_object('professionalId',professional_id,'kind',kind,'startsAt',starts_at,'endsAt',ends_at,'timeZone',time_zone,'version',version) ORDER BY id) FROM availability_exceptions WHERE merchant_id=${merchant}),'[]'::json),
        'policy',(SELECT json_build_object('holdEnabled',hold_enabled,'holdMinutes',hold_minutes,'paymentMode',payment_mode,'admissionsEnabled',admissions_enabled,'version',version) FROM service_business_policies WHERE merchant_id=${merchant}),
        'appointments',(SELECT count(*) FROM service_appointments WHERE merchant_id=${merchant}),
        'users',(SELECT count(*) FROM merchant_users WHERE merchant_id=${merchant}));`);
      response.setHeader('content-type','application/json');response.end(JSON.stringify(JSON.parse(value)));
    })().catch(()=>{response.statusCode=500;response.end('synthetic_attendance_fixture_failed');});
  });
}
