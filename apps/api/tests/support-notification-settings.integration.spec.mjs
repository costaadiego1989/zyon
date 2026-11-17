import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';
import {sqlText} from './service-company-http-fixture.mjs';
import {insert,at} from './service-migration-fixture.mjs';

const path='/support/notification-settings',phone='+12125550183';
test('HUM-09',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  try{
    const {request:rawRequest,register,json}=businessRagWriterHttp(runtime);
    const request=(route,body,token,method='PUT',headers={})=>rawRequest(route,body,token,method,
      route==='/support/settings'&&method==='PUT'?{'idempotency-key':randomUUID(),...headers}:headers);
    const owner=await register('private-alert-owner@example.test','services');
    const products=await register('private-alert-products@example.test','products');
    const foreign=await register('private-alert-foreign@example.test','products');
    const mid=sqlText(owner.merchant_id);
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_slug='private-alert-owner',
      store_settings='{"company":{"description":"Public business introduction","phone":"11999990101"}}'::jsonb WHERE id=${mid}`);
    const read=auth=>request(path,undefined,auth?.access_token,'GET');
    const save=(auth,fallbackPhone)=>request(path,{fallbackPhone},auth.access_token);
    const privateRow=auth=>json(`SELECT coalesce((SELECT to_jsonb(s) FROM support_notification_settings s WHERE merchant_id=${sqlText(auth.merchant_id)}),'null'::jsonb)`);
    const publicState=(auth=owner)=>{const id=sqlText(auth.merchant_id);return json(`SELECT jsonb_build_object(
      'merchant',(SELECT store_settings FROM merchants WHERE id=${id}),
      'faq',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM support_settings s WHERE merchant_id=${id}),
      'work',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]'::jsonb) FROM public_source_work w WHERE merchant_id=${id}),
      'chunks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM knowledge_chunks c WHERE merchant_id=${id}),
      'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',event_id,'type',event_type,'payload',payload) ORDER BY event_id),'[]'::jsonb)
        FROM outbox_messages WHERE merchant_id=${id} AND event_type IN ('support.faq_updated','public.source.changed')))`);};
    for(const auth of [owner,products,foreign]){
      const configured=await request('/merchants/me/store-settings',{company:{description:'Public synthetic preserved introduction'}},auth.access_token);
      assert.equal(configured.status,200);
      await runtime.db.sql(insert('knowledge_chunks',{id:'private-alert-preserved-'+auth.merchant_id,merchant_id:auth.merchant_id,
        source_type:'company',source_id:auth.merchant_id,content:'Public synthetic preserved introduction',embedding:'[]',updated_at:at}));
      const seeded=await publicState(auth);assert.ok(seeded.work.length>0);assert.ok(seeded.chunks.length>0);assert.equal(seeded.faq.length,0);
    }

    await t.test('absent setting does not infer a destination or create a public FAQ',async()=>{
      const before=await publicState(),result=await read(owner);
      assert.equal(result.status,200);assert.deepEqual(result.body,{channel:'whatsapp',fallbackPhone:null,version:0,updatedAt:null});
      assert.match(result.headers.get('cache-control'),/no-store/);
      assert.equal(await privateRow(owner),null);assert.deepEqual(await publicState(),before);
    });
    await t.test('owner save reload no-op and explicit clear preserve FAQ-less public state in both business modes',async()=>{
      for(const auth of [owner,products]){
        const before=await publicState(auth),otherBefore=await publicState(foreign),saved=await save(auth,phone);assert.equal(saved.status,200);
        assert.deepEqual(Object.keys(saved.body).sort(),['channel','fallbackPhone','updatedAt','version']);
        assert.equal(saved.body.channel,'whatsapp');assert.equal(saved.body.fallbackPhone,phone);assert.equal(saved.body.version,1);
        assert.ok(Number.isFinite(Date.parse(saved.body.updatedAt)));
        assert.deepEqual((await read(auth)).body,saved.body);const row=await privateRow(auth);
        assert.equal(row.merchant_id,auth.merchant_id);assert.equal(row.fallback_whatsapp,phone);assert.equal(row.version,1);
        assert.deepEqual((await save(auth,'+1 (212) 555-0183')).body,saved.body);
        assert.deepEqual(await privateRow(auth),row,'identical normalized configuration is not a new version');
        const cleared=await save(auth,null);assert.equal(cleared.status,200);assert.equal(cleared.body.fallbackPhone,null);assert.equal(cleared.body.version,2);
        assert.deepEqual((await read(auth)).body,cleared.body);assert.equal((await privateRow(auth)).fallback_whatsapp,null);
        assert.deepEqual(await publicState(auth),before);assert.deepEqual(await publicState(foreign),otherBefore);
      }
    });
    await t.test('invalid omission and foreign configuration cannot change state',async()=>{
      const before=await privateRow(owner),publicBefore=await publicState();
      for(const body of [{},{fallbackPhone:''},{fallbackPhone:'private@example.test'},{fallbackPhone:42},
        {fallbackPhone:'+00000000'},{fallbackPhone:'+1234567890123456'},{fallbackPhone:'1'.repeat(41)},
        {fallbackPhone:null,faqItems:[]}]){
        const result=await request(path,body,owner.access_token);assert.equal(result.status,400,JSON.stringify(result.body));
        assert.deepEqual(await privateRow(owner),before);assert.deepEqual(await publicState(),publicBefore);
      }
      const forged=await request(path,{fallbackPhone:phone,merchantId:foreign.merchant_id},owner.access_token);
      assert.equal(forged.status,403);assert.match(JSON.stringify(forged.body),/tenant_mismatch_body/);
      assert.deepEqual(await privateRow(owner),before);assert.equal(await privateRow(foreign),null);
      assert.equal((await request(path,{fallbackPhone:phone},undefined)).status,401);
      assert.equal((await read(undefined)).status,401);assert.deepEqual(await privateRow(owner),before);
    });
    await t.test('admin can configure while staff cannot read or mutate the private recipient',async()=>{
      for(const [role,expected] of [['admin',200],['staff',403]]){
        const email='private-alert-'+role+'@example.test',auth=await register(email,'services');
        assert.equal((await save(auth,phone)).status,200);const before=await privateRow(auth);
        await runtime.db.sql(`UPDATE merchant_users SET role=${sqlText(role)} WHERE id=${sqlText(auth.user_id)};
          UPDATE merchant_team_members SET role=${sqlText(role.toUpperCase())} WHERE user_id=${sqlText(auth.user_id)}`);
        const login=await request('/auth/login',{email,password:'SyntheticPassword123!'},undefined,'POST');assert.equal(login.status,201);
        const result=await request(path,{fallbackPhone:null},login.body.access_token);assert.equal(result.status,expected);
        assert.equal((await request(path,undefined,login.body.access_token,'GET')).status,expected);
        if(role==='staff')assert.deepEqual(await privateRow(auth),before);
        else{assert.equal(result.body.fallbackPhone,null);assert.equal((await privateRow(auth)).version,before.version+1);}
      }
    });
    await t.test('support-scoped service keys obey separate read and write permissions',async()=>{
      const {ApiKeyService}=await import('../dist/modules/integrations/domain/api-key.service.js');
      await runtime.db.sql(`INSERT INTO merchant_billing_subscriptions(merchant_id,status,plan_key,updated_at)
        VALUES(${mid},'active','growth',now()) ON CONFLICT(merchant_id)
        DO UPDATE SET status='active',plan_key='growth',stripe_price_id=NULL,updated_at=now()`);
      const makeKey=async scopes=>{
        const generated=new ApiKeyService().generate('test');
        await runtime.db.sql(`INSERT INTO merchant_api_keys(id,merchant_id,name,key_hash,key_prefix,scopes,environment,updated_at)
          VALUES(${sqlText(randomUUID())},${mid},'Synthetic private-support setting',${sqlText(generated.keyHash)},${sqlText(generated.keyPrefix)},
          ARRAY[${scopes.map(sqlText).join(',')}]::text[],'test',now())`);
        return generated.rawKey;
      };
      const reader=await makeKey(['support:read']),writer=await makeKey(['support:write']);const before=await privateRow(owner);
      assert.equal((await request(path,undefined,reader,'GET')).status,200);
      assert.equal((await request(path,{fallbackPhone:phone},reader)).status,403);assert.deepEqual(await privateRow(owner),before);
      assert.equal((await request(path,undefined,writer,'GET')).status,403);
      const result=await request(path,{fallbackPhone:phone},writer);assert.equal(result.status,200);assert.equal(result.body.fallbackPhone,phone);
    });
    await t.test('private saves do not churn FAQ version sources or chunks and FAQ save preserves private setting',async()=>{
      const faq=[{id:'public-faq',question:'What are the opening hours?',answer:'Public synthetic opening hours.'}];
      const faqResult=await request('/support/settings',{faqItems:faq},owner.access_token);assert.equal(faqResult.status,200);
      const before=await publicState();
      assert.equal(before.faq.length,1);assert.deepEqual(before.faq[0].faq_items,faq);
      assert.ok(before.work.length>0);assert.ok(before.chunks.length>0);
      assert.equal((await save(owner,'+12125550184')).status,200);assert.deepEqual(await publicState(),before);
      assert.equal((await save(owner,null)).status,200);assert.deepEqual(await publicState(),before);
      assert.equal((await save(owner,phone)).status,200);const privateBefore=await privateRow(owner);
      const updatedFaq=[{...faq[0],answer:'Updated public synthetic hours.'}];
      assert.equal((await request('/support/settings',{faqItems:updatedFaq},owner.access_token)).status,200);
      assert.deepEqual(await privateRow(owner),privateBefore);
      const [phoneSave,faqSave]=await Promise.all([
        save(owner,'+12125550185'),request('/support/settings',{faqItems:faq},owner.access_token),
      ]);
      assert.equal(phoneSave.status,200);assert.equal(faqSave.status,200);
      assert.equal((await read(owner)).body.fallbackPhone,'+12125550185');
      assert.deepEqual((await request('/support/settings',undefined,owner.access_token,'GET')).body.faqItems,faq);
    });
    await t.test('recipient remains outside public config sources chunks and audit metadata or another tenant',async()=>{
      const correlationId=randomUUID();
      assert.equal((await request(path,{fallbackPhone:phone},owner.access_token,'PUT',{'x-correlation-id':correlationId})).status,200);
      const publicBefore=await publicState();
      const config=await request('/storefront/private-alert-owner/config',undefined,undefined,'GET');assert.equal(config.status,200);
      assert.equal(config.body.storeSettings.company.phone,'11999990101');assert.equal(JSON.stringify(config.body).includes(phone),false);
      assert.equal(JSON.stringify(publicBefore).includes(phone),false);
      assert.equal((await read(foreign)).status,200);assert.equal((await read(foreign)).body.fallbackPhone,null);
      assert.equal(await privateRow(foreign),null);assert.equal((await privateRow(owner)).fallback_whatsapp,phone);
      let records=[];const auditDeadline=Date.now()+5000;
      do{
        records=await json(`SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM merchant_audit_events a
          WHERE merchant_id=${mid} AND correlation_id=${sqlText(correlationId)}`);
        if(records.length===0)await pause(10);
      }while(records.length===0&&Date.now()<auditDeadline);
      assert.equal(records.length,1,'the actual mutation audit must persist before checking its privacy');
      assert.equal(records[0].resource_type,'support_notification_settings');assert.equal(records[0].actor_id,owner.user_id);
      assert.equal(records[0].action,'http.put');assert.equal(records[0].outcome,'success');assert.equal(records[0].metadata.statusCode,200);
      assert.equal(JSON.stringify(records[0].metadata).includes(phone),false);
      const audit=await runtime.db.sql(`SELECT coalesce(jsonb_agg(metadata),'[]'::jsonb)::text FROM merchant_audit_events WHERE merchant_id=${mid}`);
      assert.equal(audit.includes(phone),false);assert.deepEqual(await publicState(),publicBefore);
    });
    await t.test('dedicated storage enforces merchant ownership and normalized positive-version configuration',async()=>{
      const before=await privateRow(owner),publicBefore=await publicState();
      await assert.rejects(runtime.db.sql(`INSERT INTO support_notification_settings(merchant_id,fallback_whatsapp,updated_at)
        VALUES('nonexistent-private-alert-merchant',NULL,now())`),/support_notification_settings_merchant_id_fkey/);
      await assert.rejects(runtime.db.sql(`UPDATE support_notification_settings SET version=0 WHERE merchant_id=${mid}`),/support_notification_settings_version_check/);
      await assert.rejects(runtime.db.sql(`UPDATE support_notification_settings SET fallback_whatsapp='not-a-phone' WHERE merchant_id=${mid}`),/support_notification_settings_phone_check/);
      assert.deepEqual(await privateRow(owner),before);assert.deepEqual(await publicState(),publicBefore);
    });
    await t.test('private write failure rolls back configuration without changing public source state',async()=>{
      const before=await privateRow(owner),publicBefore=await publicState();
      await runtime.db.sql(`CREATE FUNCTION synthetic_private_alert_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic_private_alert_failure'; END $$;
        CREATE TRIGGER synthetic_private_alert_failure BEFORE INSERT OR UPDATE ON support_notification_settings
        FOR EACH ROW EXECUTE FUNCTION synthetic_private_alert_failure();`);
      try{assert.equal((await save(owner,'+12125550189')).status,500);}
      finally{await runtime.db.sql('DROP TRIGGER synthetic_private_alert_failure ON support_notification_settings; DROP FUNCTION synthetic_private_alert_failure();');}
      assert.deepEqual(await privateRow(owner),before);assert.deepEqual(await publicState(),publicBefore);
    });
    // BEGIN T99 incremental HTTP children: unexecuted source proposal.
    await t.test('same-recipient concurrent saves serialize first creation and different replacements without public or foreign writes',async()=>{
      const auth=await register('private-alert-race-'+randomUUID()+'@example.test','services');
      assert.equal((await request('/merchants/me/store-settings',{company:{description:'Public synthetic race preservation'}},auth.access_token)).status,200);
      await runtime.db.sql(insert('knowledge_chunks',{id:'private-alert-race-preserved-'+auth.merchant_id,merchant_id:auth.merchant_id,
        source_type:'company',source_id:auth.merchant_id,content:'Public synthetic race preservation',embedding:'[]',updated_at:at}));
      const publicBefore=await publicState(auth),foreignPublicBefore=await publicState(foreign),foreignBefore=await privateRow(foreign),ownerBefore=await privateRow(owner);
      assert.ok(publicBefore.work.length>0);assert.ok(publicBefore.chunks.length>0);assert.equal(await privateRow(auth),null);
      const first=await Promise.all([save(auth,'+12125550186'),save(auth,'+1 (212) 555-0186')]);
      for(const result of first)assert.equal(result.status,200);
      assert.deepEqual(first[0].body,first[1].body);assert.equal(first[0].body.fallbackPhone,'+12125550186');assert.equal(first[0].body.version,1);
      assert.ok(Number.isFinite(Date.parse(first[0].body.updatedAt)));
      const firstRow=await privateRow(auth),count=await json(`SELECT count(*)::int FROM support_notification_settings WHERE merchant_id=${sqlText(auth.merchant_id)}`);
      assert.equal(count,1);assert.equal(firstRow.fallback_whatsapp,'+12125550186');assert.equal(firstRow.version,1);
      assert.equal(Date.parse(firstRow.updated_at),Date.parse(first[0].body.updatedAt));
      const recipients=['+12125550187','+12125550188'],changed=await Promise.all(recipients.map(recipient=>save(auth,recipient)));
      for(let index=0;index<changed.length;index++){
        assert.equal(changed[index].status,200);assert.equal(changed[index].body.fallbackPhone,recipients[index]);
        assert.ok(Number.isFinite(Date.parse(changed[index].body.updatedAt)));
      }
      assert.deepEqual(changed.map(result=>result.body.version).sort((a,b)=>a-b),[2,3]);
      const latest=changed.find(result=>result.body.version===3);assert.ok(latest);
      assert.deepEqual((await read(auth)).body,latest.body);
      const lastRow=await privateRow(auth);assert.equal(lastRow.version,3);assert.equal(lastRow.fallback_whatsapp,latest.body.fallbackPhone);
      assert.equal(Date.parse(lastRow.updated_at),Date.parse(latest.body.updatedAt));
      assert.deepEqual(await publicState(auth),publicBefore);assert.deepEqual(await publicState(foreign),foreignPublicBefore);
      assert.deepEqual(await privateRow(foreign),foreignBefore);assert.deepEqual(await privateRow(owner),ownerBefore);
    });
    await t.test('a non-null replacement increments one version and timestamp while equivalent formatting is a stored no-op',async()=>{
      const publicBefore=await publicState(products),foreignPublicBefore=await publicState(foreign),foreignBefore=await privateRow(foreign),ownerBefore=await privateRow(owner);
      const first=await save(products,'+12125550180');assert.equal(first.status,200);
      const before=await privateRow(products),beforeTime=Date.parse(before.updated_at);assert.ok(Number.isFinite(beforeTime));
      assert.equal(first.body.version,before.version);assert.equal(Date.parse(first.body.updatedAt),beforeTime);
      // Observe real clock progress before the write; never change an app/DB clock.
      const clockDeadline=Date.now()+5000;
      while(Date.now()<=beforeTime&&Date.now()<clockDeadline)await pause(1);
      assert.ok(Date.now()>beforeTime,'real_clock_progress_required_before_replacement');
      const changed=await save(products,'+1 (212) 555-0181');assert.equal(changed.status,200);
      assert.equal(changed.body.fallbackPhone,'+12125550181');assert.equal(changed.body.version,before.version+1);
      assert.ok(Date.parse(changed.body.updatedAt)>beforeTime);
      const stored=await privateRow(products);assert.equal(stored.version,before.version+1);assert.equal(stored.fallback_whatsapp,'+12125550181');
      assert.equal(Date.parse(stored.updated_at),Date.parse(changed.body.updatedAt));
      const unchanged=await save(products,'+1 212 555 0181');assert.equal(unchanged.status,200);
      assert.deepEqual(unchanged.body,changed.body);assert.deepEqual(await privateRow(products),stored);
      assert.deepEqual((await read(products)).body,changed.body);
      assert.deepEqual(await publicState(products),publicBefore);assert.deepEqual(await publicState(foreign),foreignPublicBefore);
      assert.deepEqual(await privateRow(foreign),foreignBefore);assert.deepEqual(await privateRow(owner),ownerBefore);
    });
    await t.test('a real failed private write records one recipient-free failed audit and preserves private public and foreign state',async()=>{
      const before=await privateRow(owner),publicBefore=await publicState(),foreignBefore=await privateRow(foreign),foreignPublicBefore=await publicState(foreign);
      const correlationId=randomUUID(),attemptedPhone='+12125550182';
      await runtime.db.sql(`CREATE FUNCTION synthetic_private_alert_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic_private_alert_audit_failure'; END $$;
        CREATE TRIGGER synthetic_private_alert_audit_failure BEFORE INSERT OR UPDATE ON support_notification_settings
        FOR EACH ROW EXECUTE FUNCTION synthetic_private_alert_audit_failure();`);
      try{
        const failed=await request(path,{fallbackPhone:attemptedPhone},owner.access_token,'PUT',{'x-correlation-id':correlationId});
        assert.equal(failed.status,500);
      }finally{
        await runtime.db.sql('DROP TRIGGER synthetic_private_alert_audit_failure ON support_notification_settings; DROP FUNCTION synthetic_private_alert_audit_failure();');
      }
      assert.deepEqual(await privateRow(owner),before);assert.deepEqual(await publicState(),publicBefore);
      let records=[];const auditDeadline=Date.now()+5000;
      do{
        records=await json(`SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM merchant_audit_events a
          WHERE merchant_id=${mid} AND correlation_id=${sqlText(correlationId)}`);
        if(records.length===0)await pause(10);
      }while(records.length===0&&Date.now()<auditDeadline);
      assert.equal(records.length,1,'the actual failed mutation audit must persist before checking its privacy');
      const audit=records[0];assert.equal(audit.merchant_id,owner.merchant_id);assert.equal(audit.correlation_id,correlationId);
      assert.equal(audit.resource_type,'support_notification_settings');assert.equal(audit.actor_id,owner.user_id);
      assert.equal(audit.action,'http.put');assert.equal(audit.outcome,'failed');assert.equal(audit.metadata.statusCode,500);
      const serialized=JSON.stringify(audit.metadata);
      for(const recipient of [attemptedPhone,before?.fallback_whatsapp])if(typeof recipient==='string'){
        assert.equal(serialized.includes(recipient),false);assert.equal(serialized.includes(recipient.replace(/\D/g,'')),false);
      }
      assert.deepEqual(await privateRow(owner),before);assert.deepEqual(await publicState(),publicBefore);
      assert.deepEqual(await privateRow(foreign),foreignBefore);assert.deepEqual(await publicState(foreign),foreignPublicBefore);
    });
    // END T99 incremental HTTP children.
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
