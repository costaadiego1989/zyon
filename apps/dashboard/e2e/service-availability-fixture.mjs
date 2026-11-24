import {randomUUID} from 'node:crypto';
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";

/** Declared LOCAL preconditions only. Appointment SQL is a seed, never T41 proof. */
export async function prepareAvailabilityFixtures(runtime){
  const inventory=[],fixtures=new Map(),scenarios=new Map(),tenants=new Map();
  async function request(path,method='GET',body,auth,expected=method==='POST'?201:200){
    const began=Date.now(),response=await fetch(runtime.apiOrigin+path,{method,signal:AbortSignal.timeout(10000),headers:{...(auth?{authorization:'Bearer '+auth.access_token}:{}),...(body===undefined?{}:{'content-type':'application/json','idempotency-key':randomUUID()})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const url=new URL(path,runtime.apiOrigin),row={actor:auth?.actor??'anonymous-ip',tenant:auth?(tenants.get(auth.merchant_id)??'owned-tenant'):'anonymous-ip',method,path:url.pathname.replace(/\/merchants\/(?!me(?:\/|$))[^/]+/g,'/merchants/:owned').replace(/\/service-professionals\/[^/]+/g,'/service-professionals/:owned'),status:response.status,elapsedMs:Date.now()-began,limit:response.headers.get('x-ratelimit-limit'),remaining:response.headers.get('x-ratelimit-remaining')};
    inventory.push(row);console.log('service_t78_seed_http',JSON.stringify(row));
    const value=await response.json();if(response.status!==expected)throw Error('synthetic_availability_api_failed:'+response.status);return value;
  }
  async function register(mode,actor){
    const suffix=randomUUID(),email=`t78-${actor}-${suffix}@example.test`,password='SyntheticPassword123!';
    const raw=await request('/auth/register','POST',{merchant_name:'Empresa sintética T78 '+actor,email,password,business_mode:mode}),auth={...raw,email,password,mode,role:'OWNER',actor};tenants.set(auth.merchant_id,actor);
    const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
    // Existing T75/T106 declared onboarding/Starter/offline preconditions, no quota change.
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${sql('availability-'+suffix)},store_settings='{"registration_pending":false,"oauth_registration_pending":false,"plan_selection_pending":false}'::jsonb WHERE id=${sql(auth.merchant_id)};
      INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${sql(auth.merchant_id)},${sql(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
      INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES (${sql(auth.merchant_id)},'active','starter',now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status='active',plan_key='starter',current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();
      INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${sql(auth.merchant_id)},'[]'::jsonb,1,${sql(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`);
    await request('/checkout-settings','GET',undefined,auth);
    const rawProfile=await request('/merchants/me','GET',undefined,auth),profile=rawProfile.data??rawProfile;
    if(profile.id!==auth.merchant_id||profile.businessMode!==mode||profile.businessModeSelectionState!=='selected'||String(profile.role).toUpperCase()!=='OWNER'||(profile.userId??profile.user_id)!==auth.user_id)throw Error('synthetic_availability_profile_required');
    return auth;
  }
  const catalog=await register('services','catalog-owner'),recurring=await register('services','recurring-owner'),exceptions=await register('services','exception-owner'),conflict=await register('services','conflict-owner'),products=await register('products','products-owner'),staff=await register('services','staff');
  async function setupService(auth,name,timeZone,historical=false){
    const metadata={serviceType:'presencial',notes:'Registros preservados T78',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:30,slots:historical?[{id:'historical-'+randomUUID(),date:'2030-02-04',startTime:'10:30'}]:[]}};
    const product=await request(`/merchants/${auth.merchant_id}/products`,'POST',{name,type:'service',metadata,variants:[{sku:'t78-'+randomUUID(),basePriceInCents:5000}]},auth);
    const professional=await request(`/merchants/${auth.merchant_id}/service-professionals`,'POST',{publicName:'Ana · '+name,publicProfile:{description:'Profissional sintética local T78'},timeZone,isPublished:true,productIds:[product.id]},auth);
    const policy=await request('/merchants/me/service-business-policy','PUT',{expectedVersion:0,holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',admissionsEnabled:true},auth);
    if(policy.status!=='configured'||policy.version!==1)throw Error('synthetic_availability_policy_required');
    const grade=await request(`/merchants/${auth.merchant_id}/service-professionals/${professional.id}/availability`,'PUT',{expectedVersion:professional.version,timeZone,rows:[{weekday:1,startMinute:480,endMinute:720}]},auth);
    if(grade.professionalId!==professional.id||grade.version!==professional.version+1||grade.timeZone!==timeZone||grade.rows.length!==1)throw Error('synthetic_availability_grade_required');
    return{product,professional:{...professional,version:grade.version},policy,grade,metadata};
  }
  const historical=await setupService(catalog,'Serviço histórico T78','America/Sao_Paulo',true),weekly=await setupService(recurring,'Grade e fuso T78','America/Sao_Paulo'),exceptionData=await setupService(exceptions,'Avulso e bloqueio T78','America/Sao_Paulo'),conflictData=await setupService(conflict,'Conflito preservado T78','America/Sao_Paulo');
  const seededBlock=await request(`/merchants/${conflict.merchant_id}/service-professionals/${conflictData.professional.id}/availability-exceptions`,'POST',{expectedVersion:conflictData.professional.version,kind:'block',startsAt:'2030-02-04T13:00:00.000Z',endsAt:'2030-02-04T13:30:00.000Z',timeZone:'America/Sao_Paulo',reason:'Bloqueio sintético anterior T78'},conflict);
  conflictData.professional.version=seededBlock.version;
  // Explicit confirmed-appointment SEED in the owned database, no API41/UI booking claim.
  const appointmentId=randomUUID(),variantId=conflictData.product.variants[0].id;
  await runtime.db.sql(`INSERT INTO service_appointments(id,merchant_id,professional_id,product_id,variant_id,customer_snapshot,starts_at,ends_at,time_zone,duration_minutes,price_in_cents,currency,policy_version,policy_snapshot,origin,operational_status,version,idempotency_key,request_fingerprint,confirmed_at,created_at,updated_at) VALUES (
    ${sql(appointmentId)},${sql(conflict.merchant_id)},${sql(conflictData.professional.id)},${sql(conflictData.product.id)},${sql(variantId)},'{"name":"Cliente sintético local T78"}'::jsonb,'2030-02-04T14:00:00.000Z','2030-02-04T14:30:00.000Z','America/Manaus',30,5000,'BRL',${conflictData.policy.version},${sql(JSON.stringify(conflictData.policy.policy))}::jsonb,'manual','scheduled',1,${sql('seed-t78-'+appointmentId)},${sql('declared-local-seed-'+appointmentId)},now(),now(),now());`);
  const seededAppointment=JSON.parse(await runtime.db.sql(`SELECT json_build_object('id',id,'merchantId',merchant_id,'professionalId',professional_id,'operationalStatus',operational_status,'confirmedAt',confirmed_at) FROM service_appointments WHERE id=${sql(appointmentId)} AND merchant_id=${sql(conflict.merchant_id)};`));
  if(seededAppointment.id!==appointmentId||seededAppointment.professionalId!==conflictData.professional.id||seededAppointment.operationalStatus!=='scheduled'||!seededAppointment.confirmedAt)throw Error('synthetic_availability_declared_appointment_required');
  // Same explicit Staff role precondition used by T18/T75/T106; fresh real login follows.
  await runtime.db.sql(`UPDATE merchant_users SET merchant_id=${sql(conflict.merchant_id)},role='staff' WHERE id=${sql(staff.user_id)};UPDATE merchant_team_members SET merchant_id=${sql(conflict.merchant_id)},role='STAFF' WHERE user_id=${sql(staff.user_id)};`);
  Object.assign(staff,await request('/auth/login','POST',{email:staff.email,password:staff.password}),{role:'STAFF'});
  const persistedStaff=JSON.parse(await runtime.db.sql(`SELECT json_build_object('id',id,'merchantId',merchant_id,'role',role) FROM merchant_users WHERE id=${sql(staff.user_id)};`));
  if(persistedStaff.id!==staff.user_id||persistedStaff.merchantId!==conflict.merchant_id||persistedStaff.role!=='staff'||staff.merchant_id!==conflict.merchant_id)throw Error('synthetic_availability_staff_scope_required');
  const denied=await request('/merchants/me','GET',undefined,staff,403);if(denied.code!=='staff_operation_not_permitted'||denied.detail!=='staff_operation_not_permitted')throw Error('synthetic_availability_staff_profile_denial_required');
  function save(name,auth,extra={}){const value={fixtureId:randomUUID(),email:auth.email,password:auth.password,access_token:auth.access_token,merchant_id:auth.merchant_id,user_id:auth.user_id,mode:auth.mode,role:auth.role,actor:auth.actor,tenantActor:tenants.get(auth.merchant_id),...extra};fixtures.set(value.fixtureId,value);scenarios.set(name,value);}
  const coordinates=value=>({productId:value.product.id,productName:value.product.name,variantId:value.product.variants[0].id,professionalId:value.professional.id,professionalName:value.professional.publicName,professionalVersion:value.professional.version,policyVersion:value.policy.version});
  save('catalog',catalog,{...coordinates(historical),originalMetadata:historical.metadata,foreignProfessionalId:conflictData.professional.id});save('recurring',recurring,coordinates(weekly));save('exceptions',exceptions,coordinates(exceptionData));save('conflict',conflict,{...coordinates(conflictData),appointmentSeed:{id:appointmentId,kind:'declared_sql_seed_not_T41'},seededBlockId:seededBlock.exception.id});save('products',products);save('staff',staff,coordinates(conflictData));
  const count=key=>Object.fromEntries([...new Set(inventory.map(row=>row[key]))].map(value=>[value,inventory.filter(row=>row[key]===value).length]));console.log('service_t78_seed_inventory',JSON.stringify({countsByActor:count('actor'),countsByTenant:count('tenant'),total:inventory.length,appointmentSeedOnly:true,noQuotaResetOrWait:true}));
  return{fixtures,scenarios,inventory};
}
export function installAvailabilityFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const seed=/^\/__service\/availability\/(catalog|recurring|exceptions|conflict|products|staff)$/.exec(request.url??''),snapshot=/^\/__service\/availability\/([a-f0-9-]{36})\/snapshot$/.exec(request.url??'');
    if(!((seed&&request.method==='POST')||(snapshot&&request.method==='GET')))return next();
    void(async()=>{
      if(seed){const fixture=prepared.scenarios.get(seed[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}response.setHeader('content-type','application/json');response.end(JSON.stringify(fixture));return;}
      const fixture=prepared.fixtures.get(snapshot[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      const merchant=sql(fixture.merchant_id),value=await runtime.db.sql(`SELECT jsonb_build_object(
        'professionals',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM service_professionals p WHERE merchant_id=${merchant}),'[]'::jsonb),
        'links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM professional_services l WHERE merchant_id=${merchant}),'[]'::jsonb),
        'products',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM products p WHERE merchant_id=${merchant}),'[]'::jsonb),
        'variants',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${merchant}),'[]'::jsonb),
        'prices',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM product_prices v JOIN product_variants r ON r.id=v.variant_id JOIN products p ON p.id=r.product_id WHERE p.merchant_id=${merchant}),'[]'::jsonb),
        'rows',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM professional_availability a WHERE merchant_id=${merchant}),'[]'::jsonb),
        'exceptions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM availability_exceptions e WHERE merchant_id=${merchant}),'[]'::jsonb),
        'appointments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM service_appointments a WHERE merchant_id=${merchant}),'[]'::jsonb),
        'payments',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM appointment_payments p WHERE merchant_id=${merchant}),'[]'::jsonb),
        'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'merchantId',merchant_id,'role',role) ORDER BY id) FROM merchant_users WHERE merchant_id=${merchant}),'[]'::jsonb),
        'policy',(SELECT to_jsonb(p) FROM service_business_policies p WHERE merchant_id=${merchant}));`);
      response.setHeader('content-type','application/json');response.end(JSON.stringify(JSON.parse(value)));
    })().catch(()=>{response.statusCode=500;response.end('synthetic_availability_fixture_failed');});
  });
}
