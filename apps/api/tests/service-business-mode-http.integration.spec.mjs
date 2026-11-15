import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {companyHttpFixture,sqlText} from './service-company-http-fixture.mjs';
import {insert,appointment,at} from './service-migration-fixture.mjs';

test('T12',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  try{
    const {request,register,json}=companyHttpFixture(runtime),path='/merchants/me/business-mode';
    const sendChange=async(auth,body)=>{
      const response=await request(path,body,auth.access_token);
      const correlation=response.headers.get('x-correlation-id');assert.ok(correlation);
      let audits=[];
      // The canonical HTTP audit is asynchronous. Observe its actual persisted
      // result before comparing transaction state or closing the owned app.
      for(let attempt=0;attempt<20;attempt++){
        audits=await json(`SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'outcome',outcome,'actorType',actor_type,'actorId',actor_id,'merchantId',merchant_id,'method',metadata->>'method','path',metadata->>'path','status',metadata->'statusCode') ORDER BY id),'[]'::jsonb) FROM merchant_audit_events WHERE merchant_id=${sqlText(auth.merchant_id)} AND correlation_id=${sqlText(correlation)} AND action='http.put'`);
        if(audits.length)break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.deepEqual(audits,[{action:'http.put',outcome:response.status<400?'success':'failed',actorType:'human',actorId:auth.user_id,merchantId:auth.merchant_id,method:'PUT',path,status:response.status}]);
      return response;
    };
    const change=(auth,businessMode,expectedBusinessMode)=>sendChange(auth,{businessMode,expectedBusinessMode});
    const snapshot=auth=>json(`SELECT jsonb_build_object('merchant',(SELECT to_jsonb(m) FROM merchants m WHERE id=${sqlText(auth.merchant_id)}),'policy',(SELECT to_jsonb(p) FROM service_business_policies p WHERE merchant_id=${sqlText(auth.merchant_id)}),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM merchant_audit_events a WHERE merchant_id=${sqlText(auth.merchant_id)} AND NOT coalesce(action='http.put' AND outcome='failed' AND actor_type='human' AND actor_id=${sqlText(auth.user_id)} AND metadata->>'method'='PUT' AND metadata->>'path'=${sqlText(path)} AND metadata->>'statusCode' IN ('400','409','500'),false)))`);
    for(const type of ['physical','digital','food','service'])await t.test('ONB-04 active '+type+' offer blocks incompatible change',async()=>{
      const current=type==='service'?'services':'products',auth=await register('mode-'+type+'@example.test',current);
      await runtime.db.sql(insert('products',{id:'mode-'+type,merchant_id:auth.merchant_id,name:'Oferta Sintética',type,updated_at:at}));
      const before=await snapshot(auth),response=await change(auth,current==='services'?'products':'services',current);
      assert.equal(response.status,409,JSON.stringify(response));assert.match(JSON.stringify(response.body),/business_mode_conflict/);
      assert.deepEqual(await snapshot(auth),before);assert.equal(await runtime.db.sql(`SELECT type FROM products WHERE id=${sqlText('mode-'+type)}`),type);
    });
    await t.test('ONB-04 ongoing appointments cannot be converted or deleted',async()=>{
      const auth=await register('mode-appointment@example.test','services');
      await runtime.db.sql(insert('products',{id:'mode-service-inactive',merchant_id:auth.merchant_id,name:'Serviço Sintético',type:'service',is_active:false,updated_at:at})+
        insert('product_variants',{id:'mode-variant',product_id:'mode-service-inactive',sku:'MODE-SERVICE',updated_at:at})+
        insert('service_professionals',{id:'mode-professional',merchant_id:auth.merchant_id,public_name:'Profissional Sintético',time_zone:'UTC',updated_at:at})+
        insert('professional_services',{id:'mode-link',merchant_id:auth.merchant_id,professional_id:'mode-professional',product_id:'mode-service-inactive',updated_at:at})+
        insert('service_appointments',appointment('mode-appointment',{merchant_id:auth.merchant_id,professional_id:'mode-professional',product_id:'mode-service-inactive',variant_id:'mode-variant',operational_status:'scheduled',confirmed_at:at})));
      const before=await snapshot(auth),appointmentBefore=await runtime.db.sql("SELECT row_to_json(a)::text FROM service_appointments a WHERE id='mode-appointment'");
      assert.equal((await change(auth,'products','services')).status,409);assert.deepEqual(await snapshot(auth),before);
      assert.equal(await runtime.db.sql("SELECT row_to_json(a)::text FROM service_appointments a WHERE id='mode-appointment'"),appointmentBefore);
    });
    await t.test('REG-04 completed cancelled and no-show history survives a valid mode change',async()=>{
      const auth=await register('mode-history@example.test','services');
      await runtime.db.sql(insert('products',{id:'mode-historic-service',merchant_id:auth.merchant_id,name:'Histórico Sintético',type:'service',is_active:false,updated_at:at})+
        insert('product_variants',{id:'mode-historic-variant',product_id:'mode-historic-service',sku:'MODE-HISTORY',updated_at:at})+
        insert('service_professionals',{id:'mode-historic-professional',merchant_id:auth.merchant_id,public_name:'Histórico Sintético',time_zone:'UTC',updated_at:at})+
        insert('professional_services',{id:'mode-historic-link',merchant_id:auth.merchant_id,professional_id:'mode-historic-professional',product_id:'mode-historic-service',updated_at:at}));
      for(const [index,status]of ['completed','cancelled','no_show'].entries())await runtime.db.sql(insert('service_appointments',appointment('mode-history-'+status,{
        merchant_id:auth.merchant_id,professional_id:'mode-historic-professional',product_id:'mode-historic-service',variant_id:'mode-historic-variant',
        starts_at:`2030-01-0${index+3}T10:00:00Z`,ends_at:`2030-01-0${index+3}T10:30:00Z`,operational_status:status,confirmed_at:at,
        ...(status==='completed'?{started_at:at,completed_at:at}:status==='cancelled'?{cancelled_at:at}:{no_show_at:at}),
      })));
      const before=await runtime.db.sql(`SELECT jsonb_agg(to_jsonb(a) ORDER BY id)::text FROM service_appointments a WHERE merchant_id=${sqlText(auth.merchant_id)}`);
      assert.equal((await change(auth,'products','services')).status,200);
      assert.equal(await runtime.db.sql(`SELECT jsonb_agg(to_jsonb(a) ORDER BY id)::text FROM service_appointments a WHERE merchant_id=${sqlText(auth.merchant_id)}`),before);
    });
    await t.test('REG-04 unclassified reserved legacy appointment blocks products until explicitly closed',async()=>{
      const auth=await register('mode-legacy-booking@example.test','services');
      await runtime.db.sql(insert('checkout_sessions',{id:'mode-legacy-checkout',merchant_id:auth.merchant_id,session_id:'mode-legacy-checkout',global_user_id:'synthetic-legacy-buyer',conversation_id:'mode-legacy-conversation',cart:{items:[],total:50},created_at:at,updated_at:at})+
        insert('completed_orders',{id:'mode-legacy-order',merchant_id:auth.merchant_id,session_id:'mode-legacy-checkout',external_order_id:'synthetic-legacy-order',order_total:50,currency:'BRL',shipping_cents:0,completed_at:at,fulfillment_json:{status:'scheduled',synthetic:true}})+
        insert('service_reservations',{id:'mode-legacy-reservation',merchant_id:auth.merchant_id,order_id:'mode-legacy-order',unit_id:'mode-legacy-unit',resource_id:'mode-legacy-variant',starts_at:'2030-01-05T10:00:00Z',ends_at:'2030-01-05T10:30:00Z',status:'reserved'}));
      const before=await snapshot(auth),reservation=await runtime.db.sql("SELECT row_to_json(r)::text FROM service_reservations r WHERE id='mode-legacy-reservation'");
      assert.equal((await change(auth,'products','services')).status,409);assert.deepEqual(await snapshot(auth),before);
      assert.equal(await runtime.db.sql("SELECT row_to_json(r)::text FROM service_reservations r WHERE id='mode-legacy-reservation'"),reservation);
      await runtime.db.sql("UPDATE service_reservations SET status='cancelled' WHERE id='mode-legacy-reservation'");
      const closed=await runtime.db.sql("SELECT row_to_json(r)::text FROM service_reservations r WHERE id='mode-legacy-reservation'");
      assert.equal((await change(auth,'products','services')).status,200);
      assert.equal(await runtime.db.sql("SELECT row_to_json(r)::text FROM service_reservations r WHERE id='mode-legacy-reservation'"),closed);
      assert.equal(await runtime.db.sql("SELECT count(*) FROM completed_orders WHERE id='mode-legacy-order'"),'1');
      await runtime.db.sql("UPDATE service_reservations SET status='reserved' WHERE id='mode-legacy-reservation'");
      const historical=await runtime.db.sql("SELECT row_to_json(r)::text FROM service_reservations r WHERE id='mode-legacy-reservation'");
      for(const status of ['cancelled','refunded','returned','failed']){
        await runtime.db.sql(`UPDATE completed_orders SET status=${sqlText(status)} WHERE id='mode-legacy-order'`);
        assert.equal((await change(auth,'services','products')).status,200);
        assert.equal((await change(auth,'products','services')).status,200,'A closed order cannot keep legacy capacity active: '+status);
        assert.equal(await runtime.db.sql("SELECT row_to_json(r)::text FROM service_reservations r WHERE id='mode-legacy-reservation'"),historical);
        assert.equal(await runtime.db.sql("SELECT status FROM completed_orders WHERE id='mode-legacy-order'"),status);
      }
    });
    for(const status of ['pending','requires_action'])await t.test('REG-04 '+status+' payment stays canonical and blocks change',async()=>{
      const auth=await register('mode-'+status+'@example.test','products');
      await runtime.db.sql(insert('payment_intents',{id:'mode-intent-'+status,merchant_id:auth.merchant_id,session_id:'mode-session',idempotency_key:'mode-intent-'+status,amount_cents:700,currency:'BRL',method:'pix',status,updated_at:at}));
      const before=await snapshot(auth);assert.equal((await change(auth,'services','products')).status,409);assert.deepEqual(await snapshot(auth),before);
      assert.equal(await runtime.db.sql(`SELECT status FROM payment_intents WHERE id=${sqlText('mode-intent-'+status)}`),status);
    });
    await t.test('REG-04 a canonical active checkout blocks change until explicit buyer abandonment',async()=>{
      const auth=await register('mode-checkout@example.test','products');
      await runtime.db.sql(insert('checkout_sessions',{id:'mode-checkout',merchant_id:auth.merchant_id,session_id:'mode-checkout',global_user_id:'synthetic-buyer',conversation_id:'mode-conversation',cart:{items:[{variantId:'snapshot-food',quantity:1}],total:7},created_at:at,updated_at:at}));
      const before=await snapshot(auth);assert.equal((await change(auth,'services','products')).status,409);assert.deepEqual(await snapshot(auth),before);
      await runtime.db.sql(insert('checkout_events',{id:'mode-idle-event',merchant_id:auth.merchant_id,session_id:'mode-checkout',event_name:'checkout_abandoned',metadata:{reason:'idle'},occurred_at:at}));
      assert.equal((await change(auth,'services','products')).status,409);
      await runtime.db.sql(insert('checkout_events',{id:'mode-explicit-event',merchant_id:auth.merchant_id,session_id:'mode-checkout',event_name:'checkout_abandoned',metadata:{reason:'buyer_initiated'},occurred_at:at}));
      assert.equal((await change(auth,'services','products')).status,200);
      assert.equal(await runtime.db.sql("SELECT cart->'items'->0->>'variantId' FROM checkout_sessions WHERE id='mode-checkout'"),'snapshot-food');
    });
    await t.test('REG-04 nonexpired storefront cart blocks change and expiry leaves the historical cart intact',async()=>{
      const auth=await register('mode-cart@example.test','products');
      await runtime.db.sql(insert('storefront_carts',{id:'mode-cart',merchant_id:auth.merchant_id,session_id:'mode-cart',items:[{variantId:'snapshot-product',quantity:1}],updated_at:at,expires_at:'2036-01-01T00:00:00Z'}));
      const before=await snapshot(auth);assert.equal((await change(auth,'services','products')).status,409);assert.deepEqual(await snapshot(auth),before);
      await runtime.db.sql("UPDATE storefront_carts SET expires_at='2000-01-01T00:00:00Z' WHERE id='mode-cart'");
      assert.equal((await change(auth,'services','products')).status,200);assert.equal(await runtime.db.sql("SELECT count(*) FROM storefront_carts WHERE id='mode-cart'"),'1');
    });
    await t.test('ONB-04 valid transition audits actor, retains terminal finance and disables new admissions',async()=>{
      const auth=await register('mode-valid@example.test','services');
      await runtime.db.sql(insert('service_business_policies',{merchant_id:auth.merchant_id,hold_enabled:false,payment_mode:'online',admissions_enabled:true,version:2,configured_at:at,updated_at:at})+
        insert('payment_intents',{id:'mode-terminal-intent',merchant_id:auth.merchant_id,session_id:'mode-terminal',idempotency_key:'mode-terminal-intent',amount_cents:700,currency:'BRL',method:'pix',status:'approved',provider_payment_id:'synthetic-psp-reference',updated_at:at}));
      const response=await change(auth,'products','services');assert.equal(response.status,200,JSON.stringify(response));
      assert.deepEqual(response.body,{businessMode:'products',businessModeSelectionState:'selected'});
      const policy=await json(`SELECT jsonb_build_object('version',version,'admissions',admissions_enabled,'paymentMode',payment_mode) FROM service_business_policies WHERE merchant_id=${sqlText(auth.merchant_id)}`);
      assert.deepEqual(policy,{version:3,admissions:false,paymentMode:'online'});
      const audit=await json(`SELECT jsonb_build_object('actor',actor_id,'metadata',metadata) FROM merchant_audit_events WHERE merchant_id=${sqlText(auth.merchant_id)} AND action='business_mode.changed'`);
      assert.deepEqual(audit,{actor:auth.user_id,metadata:{before:'services',after:'products',reviewResolved:false}});
      assert.equal(await runtime.db.sql("SELECT status||':'||provider_payment_id FROM payment_intents WHERE id='mode-terminal-intent'"),'approved:synthetic-psp-reference');
      assert.equal((await change(auth,'services','services')).status,409);
    });
    await t.test('REG-04 merchant lock makes a concurrent catalog writer visible before mode changes',async()=>{
      const auth=await register('mode-lock@example.test','products');
      const {PrismaClient}=await import('@prisma/client'),prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
      let signalLocked,release;const locked=new Promise(resolve=>signalLocked=resolve),finish=new Promise(resolve=>release=resolve);
      const writer=prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${auth.merchant_id} FOR UPDATE`;
        await tx.product.create({data:{id:'mode-racing-food',merchantId:auth.merchant_id,name:'Food Sintético',type:'food'}});
        signalLocked();await finish;
      },{timeout:15_000});
      let changing;
      try{
        await Promise.race([locked,writer]);changing=change(auth,'services','products');
        let blocked=false;
        for(let attempt=0;attempt<30;attempt++){
          const waiting=await runtime.db.sql("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%SELECT id FROM merchants%FOR UPDATE%'");
          if(Number(waiting)>0){blocked=true;break;}
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        assert.equal(blocked,true,'Mode change must wait on the merchant lock before reading mutable catalog facts');
        release();await writer;
        assert.equal((await changing).status,409);assert.equal(await runtime.db.sql(`SELECT business_mode FROM merchants WHERE id=${sqlText(auth.merchant_id)}`),'products');
        assert.equal(await runtime.db.sql("SELECT type FROM products WHERE id='mode-racing-food'"),'food');
      }finally{release();await Promise.allSettled([writer,...(changing?[changing]:[])]);await prisma.$disconnect();}
    });
    await t.test('ONB-04 audit failure rolls back mode, admission state and audit',async()=>{
      const auth=await register('mode-rollback@example.test','services');
      await runtime.db.sql(insert('service_business_policies',{merchant_id:auth.merchant_id,hold_enabled:false,payment_mode:'online',admissions_enabled:true,version:2,configured_at:at,updated_at:at}));
      const before=await snapshot(auth);
      await runtime.db.sql(`CREATE FUNCTION synthetic_mode_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='business_mode.changed' THEN RAISE EXCEPTION 'synthetic_mode_audit_failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER synthetic_mode_audit_failure BEFORE INSERT ON merchant_audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_mode_audit_failure();`);
      try{assert.equal((await change(auth,'products','services')).status,500);}
      finally{await runtime.db.sql('DROP TRIGGER synthetic_mode_audit_failure ON merchant_audit_events;DROP FUNCTION synthetic_mode_audit_failure();');}
      assert.deepEqual(await snapshot(auth),before);
    });
    await t.test('ATEND-08 rejects unauthenticated and foreign mode updates',async()=>{
      const auth=await register('mode-foreign@example.test','products'),before=await snapshot(auth);
      assert.equal((await request(path,{businessMode:'services',expectedBusinessMode:'products'},undefined)).status,401);
      assert.equal((await request(path,{businessMode:'services',expectedBusinessMode:'products',merchantId:'foreign'},auth.access_token)).status,403);
      assert.deepEqual(await snapshot(auth),before);
    });
    await t.test('ATEND-08 staff cannot change mode and invalid bodies retain merchant policy and finance',async()=>{
      const auth=await register('mode-invalid@example.test','services');
      await runtime.db.sql(insert('service_business_policies',{merchant_id:auth.merchant_id,hold_enabled:false,payment_mode:'online',admissions_enabled:true,version:2,configured_at:at,updated_at:at})+
        insert('payment_intents',{id:'mode-invalid-intent',merchant_id:auth.merchant_id,session_id:'mode-invalid-session',idempotency_key:'mode-invalid-intent',amount_cents:700,currency:'BRL',method:'pix',status:'approved',provider_payment_id:'synthetic-mode-invalid',updated_at:at}));
      const before=await snapshot(auth),financeBefore=await runtime.db.sql("SELECT row_to_json(p)::text FROM payment_intents p WHERE id='mode-invalid-intent'");
      for(const body of [{businessMode:'products'},{businessMode:'invalid',expectedBusinessMode:'services'},{businessMode:'products',expectedBusinessMode:7},{}]){
        assert.equal((await sendChange(auth,body)).status,400,JSON.stringify(body));
        assert.deepEqual(await snapshot(auth),before);
        assert.equal(await runtime.db.sql("SELECT row_to_json(p)::text FROM payment_intents p WHERE id='mode-invalid-intent'"),financeBefore);
      }
      await runtime.db.sql(`UPDATE merchant_users SET role='staff' WHERE id=${sqlText(auth.user_id)};UPDATE merchant_team_members SET role='STAFF' WHERE user_id=${sqlText(auth.user_id)}`);
      const login=await request('/auth/login',{email:'mode-invalid@example.test',password:'SyntheticPassword123!'},undefined,'POST');assert.equal(login.status,201);
      // AuthGuard denies staff before assigning tenantPrincipal, so the audit
      // interceptor is not entered. Require that exact guard failure as well.
      const denied=await request(path,{businessMode:'products',expectedBusinessMode:'services'},login.body.access_token);
      assert.equal(denied.status,403);assert.match(JSON.stringify(denied.body),/staff_operation_not_permitted/);
      const correlation=denied.headers.get('x-correlation-id');assert.ok(correlation);
      assert.equal(await runtime.db.sql(`SELECT count(*) FROM merchant_audit_events WHERE correlation_id=${sqlText(correlation)}`),'0');
      assert.deepEqual(await snapshot(auth),before);
      assert.equal(await runtime.db.sql("SELECT row_to_json(p)::text FROM payment_intents p WHERE id='mode-invalid-intent'"),financeBefore);
    });
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
