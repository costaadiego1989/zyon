import {randomUUID} from 'node:crypto';

const sql=value=>"'"+String(value).replaceAll("'","''")+"'";

/** T106 declared local preconditions. Every professional/link seed uses the real API. */
export async function prepareCatalogProfessionalFixtures(runtime){
  const inventory=[],actors=new Map(),fixtures=new Map(),scenarios=new Map();
  const request=async(path,method='GET',body,auth,expected=method==='POST'?201:200)=>{
    const began=Date.now();
    const response=await fetch(runtime.apiOrigin+path,{method,signal:AbortSignal.timeout(10000),headers:{
      ...(auth?{authorization:'Bearer '+auth.access_token}:{}),...(body===undefined?{}:{'content-type':'application/json','idempotency-key':randomUUID()})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const url=new URL(path,runtime.apiOrigin);
    const observation={actor:auth?(actors.get(auth.merchant_id)??'owned-tenant'):'anonymous-ip',method,
      path:url.pathname.replace(/\/merchants\/(?!me(?:\/|$))[^/]+/g,'/merchants/:owned').replace(/\/service-professionals\/[^/]+/g,'/service-professionals/:owned'),limit:url.searchParams.get('limit'),hasCursor:url.searchParams.has('cursor'),
      status:response.status,elapsedMs:Date.now()-began};
    inventory.push(observation);console.log('service_t106_seed_http',JSON.stringify(observation));
    const value=await response.json();
    if(response.status!==expected)throw Error('synthetic_catalog_professional_api_failed:'+response.status);
    return value;
  };
  async function register(mode,label){
    const suffix=randomUUID(),email=`t106-${label}-${suffix}@example.test`,password='SyntheticPassword123!';
    const auth=await request('/auth/register','POST',{merchant_name:'Empresa sintética T106 '+label,email,password,business_mode:mode});
    actors.set(auth.merchant_id,label);
    const steps=Object.fromEntries(['account','checkout_config','whatsapp','ai_engine'].map(key=>[key,{status:'completed',completedAt:new Date().toISOString()}]));
    // Declared onboarding, Starter subscription and offline AI preconditions, as T75/T76.
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug=${sql('links-'+suffix)},store_settings='{"registration_pending":false,"oauth_registration_pending":false,"plan_selection_pending":false}'::jsonb WHERE id=${sql(auth.merchant_id)};
      INSERT INTO merchant_onboarding_states(merchant_id,steps,updated_at) VALUES (${sql(auth.merchant_id)},${sql(JSON.stringify(steps))}::jsonb,now()) ON CONFLICT(merchant_id) DO UPDATE SET steps=EXCLUDED.steps,updated_at=now();
      INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,current_period_end,trial_ends_at,updated_at) VALUES (${sql(auth.merchant_id)},'active','starter',now()+interval '30 days',NULL,now()) ON CONFLICT(merchant_id) DO UPDATE SET status='active',plan_key='starter',current_period_end=EXCLUDED.current_period_end,trial_ends_at=NULL,updated_at=now();
      INSERT INTO ai_governance_policies(merchant_id,grants,version,updated_by,updated_at) VALUES (${sql(auth.merchant_id)},'[]'::jsonb,1,${sql(auth.user_id)},now()) ON CONFLICT(merchant_id) DO UPDATE SET grants=EXCLUDED.grants,updated_by=EXCLUDED.updated_by,updated_at=now();`);
    await request('/checkout-settings','GET',undefined,auth);
    const raw=await request('/merchants/me','GET',undefined,auth),profile=raw.data??raw;
    if(profile.id!==auth.merchant_id||profile.businessMode!==mode||profile.businessModeSelectionState!=='selected'||String(profile.role).toUpperCase()!=='OWNER'
      ||(profile.userId??profile.user_id)!==auth.user_id)throw Error('synthetic_catalog_professional_profile_required');
    return{...auth,email,password,mode,role:'OWNER'};
  }
  const offer=(auth,name)=>request(`/merchants/${auth.merchant_id}/products`,'POST',{name,type:'service',metadata:{serviceType:'presencial'},variants:[{sku:'t106-'+randomUUID(),basePriceInCents:2500}]},auth);
  const professional=(auth,name,productIds)=>request(`/merchants/${auth.merchant_id}/service-professionals`,'POST',{publicName:name,publicProfile:{description:'Perfil sintético local'},timeZone:'America/Sao_Paulo',isPublished:false,productIds},auth);
  const owner=await register('services','create-owner'),pagination=await register('services','pagination-owner'),partial=await register('services','partial-owner'),products=await register('products','products-owner'),staff=await register('services','staff');

  const other=await offer(owner,'Outro serviço preservado T106'),first=await professional(owner,'Ana · Vínculos T106',[other.id]);
  await request(`/merchants/${owner.merchant_id}/service-professionals/${first.id}/availability`,'PUT',{expectedVersion:first.version,timeZone:'America/Sao_Paulo',rows:[{weekday:1,startMinute:480,endMinute:720}]},owner);

  const paginatedTarget=await offer(pagination,'Serviço da segunda página T106'),paginatedOther=await offer(pagination,'Outro vínculo da segunda página T106');
  for(let index=1;index<=26;index++)await professional(pagination,`Profissional de paginação ${String(index).padStart(2,'0')} T106`,[paginatedOther.id]);
  const firstPage=await request(`/merchants/${pagination.merchant_id}/service-professionals?limit=25`,'GET',undefined,pagination);
  if(firstPage.items?.length!==25||typeof firstPage.nextCursor!=='string'||!firstPage.nextCursor)throw Error('synthetic_catalog_professional_page2_required');
  const secondPage=await request(`/merchants/${pagination.merchant_id}/service-professionals?limit=25&cursor=${encodeURIComponent(firstPage.nextCursor)}`,'GET',undefined,pagination);
  if(secondPage.items?.length!==1||secondPage.nextCursor!==null)throw Error('synthetic_catalog_professional_complete_page_required');
  const page2Professional=secondPage.items[0];
  if(!page2Professional.services?.some(link=>link.productId===paginatedOther.id))throw Error('synthetic_catalog_professional_other_link_required');

  const partialTarget=await offer(partial,'Serviço parcial T106'),retained=await offer(partial,'Vínculo original T106'),concurrent=await offer(partial,'Vínculo concorrente T106');
  for(const name of ['Bruna','Caio','Dora'])await professional(partial,name+' · Parcial T106',[retained.id]);
  const ordered=await request(`/merchants/${partial.merchant_id}/service-professionals?limit=25`,'GET',undefined,partial);
  if(ordered.items?.length!==3||ordered.nextCursor!==null)throw Error('synthetic_catalog_professional_partial_rows_required');

  // Same explicit role declaration proven in T18/T75. Staff shares partial tenant,
  // independently of the create/reopen tenant's legitimate request bucket.
  await runtime.db.sql(`UPDATE merchant_users SET merchant_id=${sql(partial.merchant_id)},role='staff' WHERE id=${sql(staff.user_id)};
    UPDATE merchant_team_members SET merchant_id=${sql(partial.merchant_id)},role='STAFF' WHERE user_id=${sql(staff.user_id)};`);
  const staffAuth=await request('/auth/login','POST',{email:staff.email,password:staff.password});
  Object.assign(staff,staffAuth,{role:'STAFF'});
  const scope=JSON.parse(await runtime.db.sql(`SELECT json_build_object('userId',id,'merchantId',merchant_id,'role',role) FROM merchant_users WHERE id=${sql(staff.user_id)};`));
  if(scope.userId!==staff.user_id||scope.merchantId!==partial.merchant_id||scope.role!=='staff')throw Error('synthetic_catalog_professional_staff_scope_required');
  const denied=await request('/merchants/me','GET',undefined,staff,403);
  if(denied.code!=='staff_operation_not_permitted'||denied.detail!=='staff_operation_not_permitted')throw Error('synthetic_catalog_professional_staff_denial_required');

  function save(name,auth,extra={}){
    const value={fixtureId:randomUUID(),email:auth.email,password:auth.password,access_token:auth.access_token,merchant_id:auth.merchant_id,mode:auth.mode,role:auth.role,...extra};
    fixtures.set(value.fixtureId,value);scenarios.set(name,value);return value;
  }
  save('create',owner,{otherProductId:other.id,professionalId:first.id,professionalName:first.publicName,foreignProfessionalId:ordered.items[0].id,foreignMerchantId:partial.merchant_id});
  save('pagination',pagination,{productId:paginatedTarget.id,productName:paginatedTarget.name,otherProductId:paginatedOther.id,page2Professional});
  save('partial',partial,{productId:partialTarget.id,productName:partialTarget.name,retainedProductId:retained.id,concurrentProductId:concurrent.id,orderedProfessionals:ordered.items});
  save('products',products);save('staff',staff,{productId:partialTarget.id,professionalId:ordered.items[0].id});
  const summary=Object.fromEntries([...new Set(inventory.map(row=>row.actor))].map(actor=>[actor,inventory.filter(row=>row.actor===actor).length]));
  console.log('service_t106_seed_inventory',JSON.stringify({countsByActor:summary,professionalSeedsViaAPI:30,noQuotaResetOrWait:true}));
  return{fixtures,scenarios,inventory};
}

export function installCatalogProfessionalFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const seed=/^\/__service\/catalog-professionals\/(create|pagination|partial|products|staff)$/.exec(request.url??'');
    const snapshot=/^\/__service\/catalog-professionals\/([a-f0-9-]{36})\/snapshot$/.exec(request.url??'');
    if(!((seed&&request.method==='POST')||(snapshot&&request.method==='GET')))return next();
    void(async()=>{
      if(seed){const fixture=prepared.scenarios.get(seed[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}response.setHeader('content-type','application/json');response.end(JSON.stringify(fixture));return;}
      const fixture=prepared.fixtures.get(snapshot[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      const merchant=sql(fixture.merchant_id);
      const value=await runtime.db.sql(`SELECT jsonb_build_object(
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
    })().catch(()=>{response.statusCode=500;response.end('synthetic_catalog_professional_fixture_failed');});
  });
}
