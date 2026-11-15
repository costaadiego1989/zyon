import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {companyHttpFixture,sqlText} from './service-company-http-fixture.mjs';
import {insert,at,baselineSnapshot} from './service-migration-fixture.mjs';
import {createOwnedStorefrontHtml} from './service-storefront-html.mjs';

test('T96',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  let prisma,html;
  try{
    prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
    const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
    const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
    const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
    const tenant=new TenantContextService(),sources=new PrismaPublicBusinessSources(registerTenantMiddleware(prisma,tenant),tenant);
    const read=auth=>tenant.run({merchantId:auth.merchant_id,userId:'synthetic-public-reader',role:'system'},()=>sources.read(auth.merchant_id,'company',auth.merchant_id));
    const {request:rawRequest,register:rawRegister,json}=companyHttpFixture(runtime),resumeAt=new Map(),audits=[];
    const owners=new Map();
    const register=async(email,mode)=>{const auth=await rawRegister(email,mode);owners.set(auth.access_token,auth);return auth;};
    const request=async(path,body,token,method='PUT',headers={})=>{
      const delay=(resumeAt.get(token)??0)-Date.now();
      if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      const response=await rawRequest(path,body,token,method,headers);
      const remaining=Number(response.headers.get('x-ratelimit-remaining')),reset=Number(response.headers.get('x-ratelimit-reset'));
      if(token&&Number.isFinite(remaining)&&remaining<=5&&Number.isFinite(reset)&&reset>0)resumeAt.set(token,reset*1000+50);
      const actor=owners.get(token),ownPath=actor&&(path==='/merchants/me/store-settings'||path==='/merchants/'+actor.merchant_id+'/store-settings'||path==='/settings/store'||path==='/merchants/me/business-mode');
      if(method==='PUT'&&ownPath&&[200,400,500].includes(response.status)){
        const correlation=response.headers.get('x-correlation-id');assert.ok(correlation);
        const canonicalPath=path==='/merchants/'+actor.merchant_id+'/store-settings'?'/merchants/:mid/store-settings':path;
        audits.push({auth:actor,path:canonicalPath,status:response.status,correlation});
      }
      return response;
    };
    let key=0;
    const paths=auth=>['/merchants/me/store-settings','/merchants/'+auth.merchant_id+'/store-settings','/settings/store'];
    const alias=path=>path==='/settings/store';
    const get=async(auth,path)=>{
      const response=await request(path,undefined,auth.access_token,'GET');assert.equal(response.status,200,JSON.stringify(response.body));
      return{response,data:response.body.data??response.body};
    };
    const put=async(auth,path,body)=>{
      const headers=alias(path)?{'if-match':(await get(auth,path)).response.headers.get('etag'),'idempotency-key':'synthetic-service-names-'+(++key)}:{};
      return request(path,body,auth.access_token,'PUT',headers);
    };
    const namesFrom=(path,data)=>alias(path)?data.company.service_names:data.company.serviceNames;
    const snapshot=auth=>json(`SELECT jsonb_build_object('merchant',(SELECT to_jsonb(m) FROM merchants m WHERE id=${sqlText(auth.merchant_id)}),'policy',(SELECT to_jsonb(p) FROM service_business_policies p WHERE merchant_id=${sqlText(auth.merchant_id)}),'work',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]'::jsonb) FROM public_source_work w WHERE merchant_id=${sqlText(auth.merchant_id)}),'chunks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM knowledge_chunks c WHERE merchant_id=${sqlText(auth.merchant_id)}))`);
    const settings=auth=>json(`SELECT store_settings FROM merchants WHERE id=${sqlText(auth.merchant_id)}`);
    const seedChunk=async(auth,id)=>runtime.db.sql(insert('knowledge_chunks',{id,merchant_id:auth.merchant_id,source_type:'company',source_id:auth.merchant_id,content:'Superseded synthetic service names',embedding:'[]',updated_at:at}));
    const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const owner=await register('names-private-login-canary@example.test','services'),id=sqlText(owner.merchant_id);
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_settings='{"company":{"description":"Public introduction","phone":"11999999999","address":{"city":"Public city"}},"policies":{"terms":"Public terms"},"unrelated":{"keep":"preserved"}}'::jsonb WHERE id=${id}`);
    const foreign=await register('names-foreign@example.test','services');
    for(const [chunk,merchant,sourceType,sourceId] of [['names-protected-policy',owner.merchant_id,'policy','terms'],['names-protected-other',owner.merchant_id,'company','another-company'],['names-protected-foreign',foreign.merchant_id,'company',foreign.merchant_id]])
      await runtime.db.sql(insert('knowledge_chunks',{id:chunk,merchant_id:merchant,source_type:sourceType,source_id:sourceId,content:'Synthetic preserved source',embedding:'[]',updated_at:at}));
    const protectedChunks=()=>runtime.db.sql("SELECT jsonb_agg(to_jsonb(c) ORDER BY id)::text FROM knowledge_chunks c WHERE id LIKE 'names-protected-%'");
    const chunksBefore=await protectedChunks();
    // Preserve an independent product purchase through every service-name write.
    await runtime.db.sql(insert('merchants',{id:'base-products',name:'Preserved product merchant',updated_at:at})+
      insert('products',{id:'base-physical',merchant_id:'base-products',name:'Preserved product',type:'physical',updated_at:at})+
      insert('product_variants',{id:'base-variant',product_id:'base-physical',sku:'BASE-PHYSICAL',updated_at:at})+
      insert('product_stock',{id:'base-stock',variant_id:'base-variant',quantity:8,reserved:2,updated_at:at})+
      insert('product_prices',{id:'base-price',variant_id:'base-variant',base_price_in_cents:2500,updated_at:at})+
      insert('checkout_sessions',{id:'base-checkout',merchant_id:'base-products',session_id:'base-session',global_user_id:'base-buyer',conversation_id:'base-conversation',cart:{items:[{sku:'BASE-PHYSICAL',quantity:2,price:25}],total:50},created_at:at,updated_at:at})+
      insert('completed_orders',{id:'base-order',merchant_id:'base-products',session_id:'base-session',external_order_id:'synthetic-base-order',order_total:50,currency:'BRL',shipping_cents:0,completed_at:at})+
      insert('payment_intents',{id:'base-payment',merchant_id:'base-products',session_id:'base-session',idempotency_key:'base-payment',amount_cents:5000,approved_amount_cents:5000,currency:'BRL',method:'pix',status:'approved',provider_payment_id:'synthetic-base-payment',updated_at:at}));
    const commerceBefore=await baselineSnapshot(runtime.db);
    const hundred=Array.from({length:100},(_,index)=>String(index).padStart(3,'0')+'a'.repeat(157));
    for(const path of paths(owner)){
      await t.test('ONB-06 validates malformed names, duplicates and limits without partial writes via '+path,async()=>{
        const before=await snapshot(owner);
        for(const serviceNames of [null,{},'Consulta',true,[7],[null],[''],['  '],['a'.repeat(161)],[...hundred,'Extra'],['Consulta',' consulta '],['A','Ａ']]){
          const response=await put(owner,path,{company:{serviceNames,phone:'Must roll back'}});
          assert.equal(response.status,400,JSON.stringify(response.body));assert.deepEqual(await snapshot(owner),before);
        }
      });
      await t.test('ONB-06 canonical roundtrip, trim, max, omission, clear and actual RAG source via '+path,async()=>{
        assert.equal((await put(owner,path,{company:{serviceNames:hundred}})).status,200);
        assert.deepEqual(namesFrom(path,(await get(owner,path)).data),hundred);
        const oldSource=await read(owner),stale='names-stale-'+(++key);await seedChunk(owner,stale);
        const value=['Public consultation '+key,'Public follow-up '+key];
        const response=await put(owner,path,{company:{serviceNames:value.map(name=>'  '+name+'  ')}});assert.equal(response.status,200,JSON.stringify(response.body));
        assert.deepEqual(namesFrom(path,response.body.data??response.body),value);
        assert.deepEqual(namesFrom(path,(await get(owner,path)).data),value);
        const stored=await settings(owner);assert.deepEqual(stored.company.serviceNames,value);assert.equal(stored.company.phone,'11999999999');assert.equal(stored.policies.terms,'Public terms');assert.equal(stored.unrelated.keep,'preserved');
        assert.equal(await runtime.db.sql(`SELECT count(*) FROM knowledge_chunks WHERE id=${sqlText(stale)}`),'0');assert.equal(await protectedChunks(),chunksBefore);
        const source=await read(owner);assert.deepEqual(source.publicData.serviceNames,value);assert.notEqual(source.sourceHash,oldSource.sourceHash);assert.ok(source.text.includes(value[0]));assert.equal(JSON.stringify(source).includes('names-private-login-canary'),false);
        const work=(await snapshot(owner)).work,latest=work.find(row=>row.source_hash===hash({description:'Public introduction',phone:'11999999999',serviceNames:value,address:{city:'Public city'}}));
        assert.ok(latest);assert.equal(latest.status,'pending');assert.equal(latest.source_type,'company');assert.equal(latest.source_id,owner.merchant_id);assert.ok(latest.source_version);
        assert.equal((await put(owner,path,{company:{serviceNames:value}})).status,200);assert.equal((await snapshot(owner)).work.length,work.length);
        assert.equal((await put(owner,path,{company:{address:{city:'Public city'}}})).status,200);assert.deepEqual((await settings(owner)).company.serviceNames,value);
        assert.equal((await put(owner,path,{company:{serviceNames:[]}})).status,200);assert.deepEqual(namesFrom(path,(await get(owner,path)).data),[]);assert.deepEqual((await settings(owner)).company.serviceNames,[]);
        assert.equal(Object.hasOwn((await read(owner)).publicData,'serviceNames'),false);
      });
      await t.test('ONB-06 outbox failure rolls back names and unrelated fields via '+path,async()=>{
        const before=await snapshot(owner);
        await runtime.db.sql("CREATE FUNCTION synthetic_names_work_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_names_work_failure'; END $$;CREATE TRIGGER synthetic_names_work_failure BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION synthetic_names_work_failure();");
        try{assert.equal((await put(owner,path,{company:{serviceNames:['Must roll back'],phone:'Must roll back'}})).status,500);}
        finally{await runtime.db.sql('DROP TRIGGER synthetic_names_work_failure ON public_source_work;DROP FUNCTION synthetic_names_work_failure();');}
        assert.deepEqual(await snapshot(owner),before);
      });
    }
    await t.test('ONB-06 invalidation failure rolls back names and the newly inserted work',async()=>{
      await seedChunk(owner,'names-delete-failure');const before=await snapshot(owner);
      await runtime.db.sql("CREATE FUNCTION synthetic_names_chunk_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='names-delete-failure' THEN RAISE EXCEPTION 'synthetic_names_chunk_failure'; END IF; RETURN OLD; END $$;CREATE TRIGGER synthetic_names_chunk_failure BEFORE DELETE ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION synthetic_names_chunk_failure();");
      try{assert.equal((await put(owner,paths(owner)[0],{company:{serviceNames:['Rollback after work insertion']}})).status,500);}
      finally{await runtime.db.sql('DROP TRIGGER synthetic_names_chunk_failure ON knowledge_chunks;DROP FUNCTION synthetic_names_chunk_failure();');}
      assert.deepEqual(await snapshot(owner),before);
    });
    await t.test('ONB-06 anonymous foreign and staff writes retain canonical source and commerce',async()=>{
      const before=await snapshot(owner);
      assert.equal((await request(paths(owner)[0],{company:{serviceNames:['Anonymous']}},undefined)).status,401);
      const denied=await request(paths(owner)[1],{company:{serviceNames:['Foreign']}},foreign.access_token);assert.ok([400,403].includes(denied.status));
      const staff=await register('names-staff@example.test','services');
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY' WHERE id=${sqlText(staff.merchant_id)};UPDATE merchant_users SET role='staff' WHERE id=${sqlText(staff.user_id)};UPDATE merchant_team_members SET role='STAFF' WHERE user_id=${sqlText(staff.user_id)}`);
      const login=await request('/auth/login',{email:'names-staff@example.test',password:'SyntheticPassword123!'},undefined,'POST');assert.equal(login.status,201);
      const staffBefore=await snapshot(staff);
      for(const path of paths(staff))assert.equal((await request(path,{company:{serviceNames:['Staff']}},login.body.access_token)).status,403);
      assert.deepEqual(await snapshot(staff),staffBefore);assert.deepEqual(await snapshot(owner),before);
    });
    await t.test('ONB-06 product mode hides historical names in every presentation and rejects explicit writes',async()=>{
      const product=await register('names-products@example.test','products'),productId=sqlText(product.merchant_id);
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug='synthetic-product-names',store_settings='{"company":{"description":"Product introduction","serviceNames":["Historical consultation"]},"policies":{"terms":"Product terms"}}'::jsonb WHERE id=${productId}`);
      const before=await snapshot(product);
      for(const path of paths(product)){
        assert.equal(namesFrom(path,(await get(product,path)).data),undefined);
        for(const serviceNames of [['Forbidden service'],[]]){assert.equal((await put(product,path,{company:{serviceNames}})).status,403);assert.deepEqual(await snapshot(product),before);}
      }
      const publicResponse=await request('/storefront/synthetic-product-names/config',undefined,undefined,'GET');assert.equal(publicResponse.status,200);assert.equal(Object.hasOwn(publicResponse.body.storeSettings.company,'serviceNames'),false);assert.equal(publicResponse.body.storeSettings.policies.terms,'Product terms');
      assert.equal(Object.hasOwn((await read(product)).publicData,'serviceNames'),false);assert.deepEqual((await settings(product)).company.serviceNames,['Historical consultation']);
      // An unrelated patch cannot echo historical service names in its PUT response.
      const response=await put(product,paths(product)[1],{company:{description:'Updated product introduction'}});assert.equal(response.status,200);assert.equal(Object.hasOwn(response.body.company,'serviceNames'),false);assert.deepEqual((await settings(product)).company.serviceNames,['Historical consultation']);
    });
    for(const routeIndex of [0,1,2])await t.test('ONB-06 writer observes canonical mode after waiting for merchant lock on route '+routeIndex,async()=>{
      const auth=await register('names-lock-'+routeIndex+'@example.test','services');await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY' WHERE id=${sqlText(auth.merchant_id)}`);
      const path=paths(auth)[routeIndex],headers=alias(path)?{'if-match':(await get(auth,path)).response.headers.get('etag'),'idempotency-key':'synthetic-names-lock-'+routeIndex}:{};
      let signalLocked,release,holderPid;const locked=new Promise(resolve=>signalLocked=resolve),finish=new Promise(resolve=>release=resolve);
      const holder=prisma.$transaction(async tx=>{
        // Permit the alias's real idempotency FK KEY SHARE before observing
        // the writer. NO KEY UPDATE still conflicts with its required FOR
        // UPDATE; no idempotency/provider/repository guard is replaced.
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${auth.merchant_id} FOR NO KEY UPDATE`;
        [{pid:holderPid}]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        await tx.merchant.update({where:{id:auth.merchant_id},data:{businessMode:'products'}});signalLocked();await finish;
      },{timeout:15_000});
      let writing;
      try{
        await Promise.race([locked,holder]);writing=request(path,{company:{serviceNames:['Must not race into products']}},auth.access_token,'PUT',headers);
        let blocked=false;
        for(let attempt=0;attempt<30;attempt++){
          assert.ok(Number.isSafeInteger(holderPid));
          const waiting=await runtime.db.sql(`SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%SELECT id FROM merchants%FOR UPDATE%' AND pg_blocking_pids(pid) @> ARRAY[${holderPid}]::integer[]`);
          if(Number(waiting)>0){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,50));
        }
        assert.equal(blocked,true,'Writer must acquire merchant lock before observing the mode');release();await holder;
        assert.equal((await writing).status,403);assert.equal(await runtime.db.sql(`SELECT business_mode FROM merchants WHERE id=${sqlText(auth.merchant_id)}`),'products');assert.equal(Object.hasOwn((await settings(auth)).company??{},'serviceNames'),false);assert.equal((await snapshot(auth)).work.length,0);
      }finally{release();await Promise.allSettled([holder,...(writing?[writing]:[])]);}
    });
    await t.test('ONB-06 mode change atomically withdraws current names while preserving JSON and actual public HTML',async()=>{
      const auth=await register('names-public-html@example.test','services'),merchant=sqlText(auth.merchant_id),value=['PUBLIC-HTML-SERVICE-ONE','PUBLIC-HTML-SERVICE-TWO'];
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug='synthetic-public-service-names',store_settings='{"company":{"description":"Public company introduction","phone":"11999999999"},"policies":{"terms":"Public terms"}}'::jsonb WHERE id=${merchant}`);
      assert.equal((await put(auth,paths(auth)[0],{company:{serviceNames:value}})).status,200);
      await runtime.db.sql(insert('service_business_policies',{merchant_id:auth.merchant_id,hold_enabled:false,payment_mode:'online',admissions_enabled:true,version:1,configured_at:at,updated_at:at}));
      await seedChunk(auth,'names-before-mode-change');const before=await snapshot(auth),beforeSource=await read(auth);
      const configPath='/storefront/synthetic-public-service-names/config';
      const publicBefore=await request(configPath,undefined,undefined,'GET');assert.equal(publicBefore.status,200);assert.deepEqual(publicBefore.body.storeSettings.company.serviceNames,value);
      html=await createOwnedStorefrontHtml(runtime);
      const htmlUrl=html.origin+'/store/synthetic-public-service-names';
      const htmlBefore=await fetch(htmlUrl,{redirect:'error',signal:AbortSignal.timeout(30_000)});assert.equal(htmlBefore.status,200);const first=await htmlBefore.text();assert.ok(first.includes(value[0]),'Actual Next HTML must provide a positive control before withdrawal');
      await runtime.db.sql("CREATE FUNCTION synthetic_names_mode_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_names_mode_failure'; END $$;CREATE TRIGGER synthetic_names_mode_failure BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION synthetic_names_mode_failure();");
      try{assert.equal((await request('/merchants/me/business-mode',{businessMode:'products',expectedBusinessMode:'services'},auth.access_token)).status,500);}
      finally{await runtime.db.sql('DROP TRIGGER synthetic_names_mode_failure ON public_source_work;DROP FUNCTION synthetic_names_mode_failure();');}
      assert.deepEqual(await snapshot(auth),before);assert.equal((await read(auth)).sourceHash,beforeSource.sourceHash);
      assert.equal((await request('/merchants/me/business-mode',{businessMode:'products',expectedBusinessMode:'services'},auth.access_token)).status,200);
      const after=await snapshot(auth);assert.equal(after.merchant.business_mode,'products');assert.deepEqual(after.merchant.store_settings,before.merchant.store_settings);assert.equal(after.policy.admissions_enabled,false);assert.equal(after.policy.version,2);assert.equal(after.work.length,before.work.length+1);assert.equal(after.chunks.length,0);
      const publicAfter=await request(configPath,undefined,undefined,'GET');assert.equal(publicAfter.status,200);assert.equal(Object.hasOwn(publicAfter.body.storeSettings.company,'serviceNames'),false);assert.equal(publicAfter.body.storeSettings.company.description,'Public company introduction');assert.equal(publicAfter.body.storeSettings.policies.terms,'Public terms');
      const htmlAfter=await fetch(htmlUrl,{redirect:'error',signal:AbortSignal.timeout(30_000)});assert.equal(htmlAfter.status,200);const second=await htmlAfter.text();assert.ok(second.includes('Empresa Sint'));for(const name of value)assert.equal(second.includes(name),false,'Same warmed public URL must withdraw service names immediately');
      for(const path of paths(auth))assert.equal(namesFrom(path,(await get(auth,path)).data),undefined);
      const afterSource=await read(auth);assert.notEqual(afterSource.sourceHash,beforeSource.sourceHash);assert.equal(Object.hasOwn(afterSource.publicData,'serviceNames'),false);for(const name of value)assert.equal(afterSource.text.includes(name),false);assert.deepEqual((await settings(auth)).company.serviceNames,value);
      assert.equal(await runtime.db.sql(`SELECT count(*) FROM products WHERE merchant_id=${merchant}`),'0');assert.equal(await runtime.db.sql(`SELECT count(*) FROM service_appointments WHERE merchant_id=${merchant}`),'0');assert.equal(JSON.stringify(afterSource).includes('names-public-html@example.test'),false);
      await html.close();html=undefined;
    });
    assert.deepEqual(await baselineSnapshot(runtime.db),commerceBefore);assert.equal(await protectedChunks(),chunksBefore);
    // Settle and verify the real asynchronous HTTP audit before closing the app.
    // Domain rollback snapshots deliberately exclude this legitimate HTTP log.
    for(const {auth,path,status,correlation} of audits){
      let persisted=[];
      for(let attempt=0;attempt<20;attempt++){
        persisted=await json(`SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'outcome',outcome,'actor',actor_id,'merchant',merchant_id,'method',metadata->>'method','path',metadata->>'path','status',metadata->'statusCode')),'[]'::jsonb) FROM merchant_audit_events WHERE correlation_id=${sqlText(correlation)} AND action='http.put'`);
        if(persisted.length)break;await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.deepEqual(persisted,[{action:'http.put',outcome:status<400?'success':'failed',actor:auth.user_id,merchant:auth.merchant_id,method:'PUT',path,status}]);
    }
    assert.equal(runtime.evidence().canonicalAppModule,true);assert.equal(runtime.evidence().repositoryOverrides,false);assert.equal(runtime.evidence().providerCalls,0);
  }finally{if(html)await html.close();if(prisma)await prisma.$disconnect();await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
