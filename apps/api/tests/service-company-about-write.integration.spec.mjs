import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {companyHttpFixture,sqlText} from './service-company-http-fixture.mjs';
import {insert,at} from './service-migration-fixture.mjs';

test('T13',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  try{
    const {request:rawRequest,register,json}=companyHttpFixture(runtime),resumeAt=new Map();
    // One tenant is deliberately exercised through all equivalent routes. Pace
    // that fixture using the unchanged real quota headers; never retry429 or
    // alter/reset the rate-limit store to turn a failed assertion green.
    const request=async(path,body,token,method='PUT',headers={})=>{
      const delay=(resumeAt.get(token)??0)-Date.now();
      if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      const response=await rawRequest(path,body,token,method,headers);
      const remaining=Number(response.headers.get('x-ratelimit-remaining')),reset=Number(response.headers.get('x-ratelimit-reset'));
      if(token&&Number.isFinite(remaining)&&remaining<=5&&Number.isFinite(reset)&&reset>0)resumeAt.set(token,reset*1000+50);
      return response;
    };
    const auth=await register('about-writer@example.test','products'),id=sqlText(auth.merchant_id);
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_settings='{"company":{"description":"Introdução anterior","email":"public@example.test","address":{"street":"Rua anterior","city":"Cidade"}},"policies":{"terms":"Termos anteriores"},"unrelated":{"concurrent":"preservado"}}'::jsonb WHERE id=${id}`);
    const snapshot=()=>json(`SELECT jsonb_build_object('settings',(SELECT store_settings FROM merchants WHERE id=${id}),'work',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]'::jsonb) FROM public_source_work w WHERE merchant_id=${id}),'chunks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM knowledge_chunks c WHERE merchant_id=${id}))`);
    const protectedOwner=await register('about-protected-chunks@example.test','products');
    for(const [chunk,merchant,sourceType,sourceId] of [['about-own-policy',auth.merchant_id,'policy','terms'],['about-own-other-source',auth.merchant_id,'company','another-source'],['about-foreign-company',protectedOwner.merchant_id,'company',protectedOwner.merchant_id]]){
      await runtime.db.sql(insert('knowledge_chunks',{id:chunk,merchant_id:merchant,source_type:sourceType,source_id:sourceId,content:'Public synthetic preserved source',embedding:'[]',updated_at:at}));
    }
    const protectedSnapshot=()=>runtime.db.sql("SELECT jsonb_agg(to_jsonb(c) ORDER BY id)::text FROM knowledge_chunks c WHERE id IN ('about-own-policy','about-own-other-source','about-foreign-company')");
    const protectedBefore=await protectedSnapshot();
    let key=0;
    for(const path of ['/merchants/me/store-settings','/merchants/'+auth.merchant_id+'/store-settings','/settings/store']){
      const put=async body=>{
        const headers=path==='/settings/store'?{'if-match':(await request(path,undefined,auth.access_token,'GET')).headers.get('etag'),'idempotency-key':'synthetic-about-'+(++key)}:{};
        const response=await request(path,body,auth.access_token,'PUT',headers);
        if(path==='/settings/store'&&response.status===200){
          const reopened=await request(path,undefined,auth.access_token,'GET');assert.equal(reopened.status,200);
          assert.equal(response.headers.get('etag'),reopened.headers.get('etag'),'Saved alias ETag must describe the same canonical presentation as GET');
        }
        return response;
      };
      await t.test('ONB-05 validates string/limit/object without partial writes via '+path,async()=>{
        const before=await snapshot();
        for(const description of [null,{},[],false,17,'a'.repeat(1201)]){
          const response=await put({company:{description,phone:'Must roll back'}});assert.equal(response.status,400,JSON.stringify(response));
          assert.deepEqual(await snapshot(),before);
        }
        for(const company of [null,[],false,'not-an-object']){
          assert.equal((await put({company})).status,400);assert.deepEqual(await snapshot(),before);
        }
      });
      await t.test('ONB-05 canonical merge, max length, omission and clear via '+path,async()=>{
        assert.equal((await put({company:{description:'a'.repeat(1200)}})).status,200);
        assert.equal(await runtime.db.sql(`SELECT store_settings->'company'->>'description' FROM merchants WHERE id=${id}`),'a'.repeat(1200));
        const staleChunk='about-stale-'+(++key);
        await runtime.db.sql(insert('knowledge_chunks',{id:staleChunk,merchant_id:auth.merchant_id,source_type:'company',source_id:auth.merchant_id,content:'Superseded public introduction',embedding:'[]',updated_at:at}));
        assert.equal((await put({company:{description:'  Apresentação pública sintética  ',address:{number:'25'}}})).status,200);
        assert.equal(await runtime.db.sql(`SELECT count(*) FROM knowledge_chunks WHERE id=${sqlText(staleChunk)}`),'0');
        assert.equal(await protectedSnapshot(),protectedBefore,'Other sources and tenants retain their chunks');
        const after=await snapshot();
        assert.equal(after.settings.company.description,'Apresentação pública sintética');assert.equal(after.settings.company.email,'public@example.test');
        assert.deepEqual(after.settings.company.address,{street:'Rua anterior',city:'Cidade',number:'25'});
        assert.equal(after.settings.policies.terms,'Termos anteriores');assert.equal(after.settings.unrelated.concurrent,'preservado');
        const count=after.work.length;assert.ok(count>0);const last=after.work.find(w=>w.source_type==='company');
        assert.equal(last.merchant_id,auth.merchant_id);assert.equal(last.source_id,auth.merchant_id);assert.equal(last.status,'pending');assert.equal(last.publication_state,'published');
        assert.match(last.source_hash,/^[a-f0-9]{64}$/);assert.ok(last.source_version);
        assert.equal((await put({company:{description:'Apresentação pública sintética'}})).status,200);assert.equal((await snapshot()).work.length,count);
        assert.equal((await put({company:{phone:'11999999999'}})).status,200);assert.equal((await snapshot()).settings.company.description,'Apresentação pública sintética');
        assert.equal((await put({company:{description:''}})).status,200);assert.equal((await snapshot()).settings.company.description,'');
      });
      await t.test('RAG-11 outbox failure atomically rolls back the public source and other fields via '+path,async()=>{
        const before=await snapshot();
        await runtime.db.sql(`CREATE FUNCTION synthetic_company_work_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_company_work_failure'; END $$;CREATE TRIGGER synthetic_company_work_failure BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION synthetic_company_work_failure();`);
        try{assert.equal((await put({company:{description:'Must roll back',phone:'00000000000'},social:{instagram:'Must roll back'}})).status,500);}
        finally{await runtime.db.sql('DROP TRIGGER synthetic_company_work_failure ON public_source_work;DROP FUNCTION synthetic_company_work_failure();');}
        assert.deepEqual(await snapshot(),before);
      });
    }
    await t.test('RAG-11 chunk invalidation failure rolls back canonical settings and newly queued work',async()=>{
      await runtime.db.sql(insert('knowledge_chunks',{id:'about-delete-failure',merchant_id:auth.merchant_id,source_type:'company',source_id:auth.merchant_id,content:'Public synthetic prior introduction',embedding:'[]',updated_at:at}));
      const before=await snapshot();
      await runtime.db.sql(`CREATE FUNCTION synthetic_company_chunk_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='about-delete-failure' THEN RAISE EXCEPTION 'synthetic_company_chunk_failure'; END IF; RETURN OLD; END $$;CREATE TRIGGER synthetic_company_chunk_failure BEFORE DELETE ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION synthetic_company_chunk_failure();`);
      try{assert.equal((await request('/merchants/me/store-settings',{company:{description:'Must atomically roll back after work insertion'}},auth.access_token)).status,500);}
      finally{await runtime.db.sql('DROP TRIGGER synthetic_company_chunk_failure ON knowledge_chunks;DROP FUNCTION synthetic_company_chunk_failure();');}
      assert.deepEqual(await snapshot(),before);assert.equal(await protectedSnapshot(),protectedBefore);
    });
    await t.test('ATEND-08 foreign and anonymous writers cannot change company data',async()=>{
      const stranger=await register('about-stranger@example.test','products'),before=await snapshot();
      const foreign=await request('/merchants/'+auth.merchant_id+'/store-settings',{company:{description:'foreign'}},stranger.access_token);
      assert.ok([400,403].includes(foreign.status),JSON.stringify(foreign));
      assert.equal((await request('/merchants/me/store-settings',{company:{description:'anonymous'}},undefined)).status,401);
      assert.deepEqual(await snapshot(),before);
    });
    for(const entry of ['/merchants/me/store-settings','explicit','/settings/store'])await t.test('RAG-11 canonical public source never copies private login via '+entry,async()=>{
      const owner=await register('about-private-login-canary-'+(++key)+'@example.test','products'),merchant=sqlText(owner.merchant_id);
      const path=entry==='explicit'?'/merchants/'+owner.merchant_id+'/store-settings':entry;
      const write=async body=>{
        const headers=path==='/settings/store'?{'if-match':(await request(path,undefined,owner.access_token,'GET')).headers.get('etag'),'idempotency-key':'synthetic-private-source-'+(++key)}:{};
        return request(path,body,owner.access_token,'PUT',headers);
      };
      await runtime.db.sql(`UPDATE merchants SET store_settings='{"company":{"description":"Apresentação inicial"}}'::jsonb WHERE id=${merchant}`);
      const description='Apresentação pública atualizada';
      const saved=await write({company:{description}});assert.equal(saved.status,200);
      assert.equal(await runtime.db.sql(`SELECT store_settings->'company' ? 'email' FROM merchants WHERE id=${merchant}`),'f');
      const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const privateAbsentHash=hash({description});
      const before=await json(`SELECT jsonb_agg(source_hash ORDER BY source_hash) FROM public_source_work WHERE merchant_id=${merchant} AND source_type='company'`);
      assert.deepEqual(before,[privateAbsentHash]);
      const email='public-business@example.test';
      assert.equal((await write({company:{email}})).status,200);
      assert.equal(await runtime.db.sql(`SELECT store_settings->'company'->>'email' FROM merchants WHERE id=${merchant}`),email);
      const after=await json(`SELECT jsonb_agg(source_hash ORDER BY source_hash) FROM public_source_work WHERE merchant_id=${merchant} AND source_type='company'`);
      assert.deepEqual(after,[privateAbsentHash,hash({description,email})].sort());
    });
    await t.test('RAG-11 removing the last public company field queues withdrawal without copying private login',async()=>{
      const owner=await register('about-withdraw-login-canary@example.test','products'),merchant=sqlText(owner.merchant_id);
      await runtime.db.sql(`UPDATE merchants SET store_settings='{"company":{"description":"Only public introduction"}}'::jsonb WHERE id=${merchant}`);
      assert.equal((await request('/merchants/me/store-settings',{company:{description:''}},owner.access_token)).status,200);
      assert.equal(await runtime.db.sql(`SELECT store_settings->'company'->>'description' FROM merchants WHERE id=${merchant}`),'');
      assert.equal(await runtime.db.sql(`SELECT store_settings->'company' ? 'email' FROM merchants WHERE id=${merchant}`),'f');
      const work=await json(`SELECT jsonb_agg(jsonb_build_object('state',publication_state,'hash',source_hash,'status',status)) FROM public_source_work WHERE merchant_id=${merchant} AND source_type='company'`);
      assert.deepEqual(work,[{state:'withdrawn',hash:createHash('sha256').update('{}').digest('hex'),status:'pending'}]);
    });
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
