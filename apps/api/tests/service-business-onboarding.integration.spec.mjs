import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

const password='SyntheticPassword123!';
const sqlText=value=>"'"+String(value).replaceAll("'","''")+"'";
test('T8',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  try{
    const request=async(path,body,token,method='POST')=>{
      const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,body:await response.json()};
    };
    const register=async(email,mode)=>{
      const response=await request('/auth/register',{merchant_name:'Synthetic '+email,email,password,business_mode:mode});
      assert.equal(response.status,201,JSON.stringify(response.body));return response.body;
    };
    const state=async id=>JSON.parse(await runtime.db.sql(`SELECT jsonb_build_object('mode',business_mode,'selected',business_mode_selected_at IS NOT NULL,'settings',store_settings) FROM merchants WHERE id=${sqlText(id)}`));
    await t.test('invalid and absent selection cannot create partial account records',async()=>{
      for(const mode of [undefined,null,'both','service',1]){
        const response=await request('/auth/register',{merchant_name:'Synthetic invalid',email:'invalid@example.test',password,business_mode:mode});
        assert.equal(response.status,400);assert.match(JSON.stringify(response.body),/business_mode_required/);
      }
      assert.equal(await runtime.db.sql("SELECT count(*) FROM merchant_users WHERE email='invalid@example.test'"),'0');
    });
    for(const mode of ['products','services'])await t.test('HTTP signup and new login preserve '+mode,async()=>{
      const email=mode+'@example.test',auth=await register(email,mode),stored=await state(auth.merchant_id);
      assert.equal(stored.mode,mode);assert.equal(stored.selected,true);
      assert.equal(await runtime.db.sql(`SELECT count(*) FROM service_business_policies WHERE merchant_id=${sqlText(auth.merchant_id)}`),'0');
      const login=await request('/auth/login',{email,password});assert.equal(login.status,201);assert.equal(login.body.merchant_id,auth.merchant_id);
      const duplicate=await request('/auth/register',{merchant_name:'Synthetic duplicate',email,password,business_mode:mode==='products'?'services':'products'});
      assert.equal(duplicate.status,409);assert.deepEqual(await state(auth.merchant_id),stored);
    });
    await t.test('canonical OAuth preliminary persistence can complete with an explicit choice',async()=>{
      const {PrismaClient}=await import('@prisma/client');
      const {PrismaAuthRepository}=await import('../dist/modules/auth/infrastructure/prisma-auth.repository.js');
      const {PasswordHasher}=await import('../dist/modules/auth/domain/services/password-hasher.service.js');
      const prisma=new PrismaClient({datasources:{db:{url:runtime.db.prismaUrl}}});
      let oauth;
      try{
        oauth=await new PrismaAuthRepository(prisma).createMerchantWithOAuthOwner({merchantId:'synthetic-oauth',merchantName:'Synthetic OAuth',
          email:'oauth@example.test',oauthProvider:'google',oauthProviderId:'synthetic-provider-id'});
        const stored=await state(oauth.merchant.id);assert.equal(stored.mode,'products');assert.equal(stored.selected,false);
        assert.equal(stored.settings.oauth_registration_pending,true);
        // Add a local linked password credential for real HTTP authentication;
        // this does not claim a Google token exchange or provider acceptance.
        await prisma.merchantUser.update({where:{id:oauth.user.id},data:{passwordHash:await new PasswordHasher().hash(password)}});
      }finally{await prisma.$disconnect();}
      const login=await request('/auth/login',{email:'oauth@example.test',password});assert.equal(login.status,201);
      const complete=await request('/merchants/me/store-settings',{business_mode:'services',company:{description:'Synthetic OAuth service'},oauth_registration_pending:false},login.body.access_token,'PUT');
      assert.equal(complete.status,200,JSON.stringify(complete));
      const stored=await state(oauth.merchant.id);assert.equal(stored.mode,'services');assert.equal(stored.selected,true);
      assert.equal(stored.settings.oauth_registration_pending,false);assert.equal(stored.settings.company.description,'Synthetic OAuth service');
    });
    const pending=await register('pending@example.test','products');
    // Fixture for the persisted preliminary OAuth state. Provider authorization
    // is not exercised or claimed; authentication remains a real issued session.
    await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,store_settings='{"registration_pending":true,"oauth_registration_pending":true}'::jsonb WHERE id=${sqlText(pending.merchant_id)};`);
    await t.test('pending company-data completion requires selection then persists once',async()=>{
      const before=await state(pending.merchant_id);
      const absent=await request('/merchants/me/store-settings',{registration_pending:false,oauth_registration_pending:false},pending.access_token,'PUT');
      assert.equal(absent.status,400);assert.deepEqual(await state(pending.merchant_id),before);
      const complete=await request('/merchants/me/store-settings',{business_mode:'services',company:{description:'Synthetic selected service'},oauth_registration_pending:false},pending.access_token,'PUT');
      assert.equal(complete.status,200,JSON.stringify(complete.body));
      const selected=await state(pending.merchant_id);assert.equal(selected.mode,'services');assert.equal(selected.selected,true);
      assert.equal(selected.settings.company.description,'Synthetic selected service');
      assert.equal(selected.settings.oauth_registration_pending,false);assert.equal(Object.hasOwn(selected.settings,'business_mode'),false);
      const retry=await request('/merchants/me/store-settings',{business_mode:'services'},pending.access_token,'PUT');assert.equal(retry.status,200);
      const forged=await request('/merchants/me/store-settings',{business_mode:'products',registration_pending:true,oauth_registration_pending:true,company:{description:'Must roll back'}},pending.access_token,'PUT');
      assert.equal(forged.status,409);assert.deepEqual(await state(pending.merchant_id),selected);
    });
    await t.test('non-pending legacy account cannot forge initial selection',async()=>{
      const auth=await register('legacy@example.test','products');
      await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,store_settings='{}'::jsonb WHERE id=${sqlText(auth.merchant_id)}`);
      const before=await state(auth.merchant_id),response=await request('/merchants/me/store-settings',{business_mode:'services',registration_pending:true,oauth_registration_pending:true},auth.access_token,'PUT');
      assert.equal(response.status,409);assert.deepEqual(await state(auth.merchant_id),before);
    });
    await t.test('pending state cannot override incompatible existing offers or payment attempts',async()=>{
      for(const [name,mode,productType]of [['physical','services','physical'],['service','products','service']]){
        const auth=await register('conflict-'+name+'@example.test','products');
        await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,store_settings='{"registration_pending":true}'::jsonb WHERE id=${sqlText(auth.merchant_id)};
          INSERT INTO products(id,merchant_id,name,type,updated_at) VALUES (${sqlText('conflict-'+name)},${sqlText(auth.merchant_id)},'Synthetic conflict',${sqlText(productType)},now());`);
        const before=await state(auth.merchant_id),response=await request('/merchants/me/store-settings',{business_mode:mode,company:{description:'Must roll back'}},auth.access_token,'PUT');
        assert.equal(response.status,409);assert.deepEqual(await state(auth.merchant_id),before);
        assert.equal(await runtime.db.sql(`SELECT count(*) FROM products WHERE id=${sqlText('conflict-'+name)} AND merchant_id=${sqlText(auth.merchant_id)}`),'1');
      }
      const auth=await register('pending-payment@example.test','products');
      await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,store_settings='{"registration_pending":true}'::jsonb WHERE id=${sqlText(auth.merchant_id)};
        INSERT INTO payment_intents(id,merchant_id,session_id,idempotency_key,amount_cents,currency,method,status,updated_at)
        VALUES ('synthetic-pending-intent',${sqlText(auth.merchant_id)},'synthetic-session','synthetic-pending-intent',300,'BRL','pix','pending',now());`);
      const before=await state(auth.merchant_id),response=await request('/merchants/me/store-settings',{business_mode:'services'},auth.access_token,'PUT');
      assert.equal(response.status,409);assert.deepEqual(await state(auth.merchant_id),before);
      assert.equal(await runtime.db.sql("SELECT status FROM payment_intents WHERE id='synthetic-pending-intent'"),'pending');
    });
    await t.test('concurrent different initial selections commit one coherent result',async()=>{
      const auth=await register('race@example.test','products');
      await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,store_settings='{"registration_pending":true}'::jsonb WHERE id=${sqlText(auth.merchant_id)}`);
      const results=await Promise.all(['products','services'].map(mode=>request('/merchants/me/store-settings',{business_mode:mode,company:{description:mode}},auth.access_token,'PUT')));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const stored=await state(auth.merchant_id);assert.equal(stored.selected,true);assert.equal(stored.settings.company.description,stored.mode);
    });
    await t.test('foreign and unauthenticated settings requests cannot select a mode',async()=>{
      const stranger=await register('stranger@example.test','products'),before=await state(pending.merchant_id);
      const foreign=await request('/merchants/'+pending.merchant_id+'/store-settings',{business_mode:'products'},stranger.access_token,'PUT');
      assert.ok([400,403].includes(foreign.status),JSON.stringify(foreign));assert.deepEqual(await state(pending.merchant_id),before);
      const anonymous=await request('/merchants/me/store-settings',{business_mode:'services'},undefined,'PUT');assert.equal(anonymous.status,401);
    });
    await t.test('equivalent explicit-tenant writer enforces the same single selection',async()=>{
      const auth=await register('alternate@example.test','products');
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',business_mode_selected_at=NULL,store_settings='{"registration_pending":true}'::jsonb WHERE id=${sqlText(auth.merchant_id)}`);
      const path='/merchants/'+auth.merchant_id+'/store-settings',before=await state(auth.merchant_id);
      const invalid=await request(path,{business_mode:'both',company:{description:'Must roll back'}},auth.access_token,'PUT');
      assert.equal(invalid.status,400,JSON.stringify(invalid));assert.deepEqual(await state(auth.merchant_id),before);
      const valid=await request(path,{business_mode:'services',company:{description:'Synthetic alternate'}},auth.access_token,'PUT');
      assert.equal(valid.status,200,JSON.stringify(valid));const selected=await state(auth.merchant_id);
      assert.equal(selected.mode,'services');assert.equal(selected.selected,true);
      assert.equal(Object.hasOwn(selected.settings,'business_mode'),false);
      const forged=await request(path,{business_mode:'products',registration_pending:true,oauth_registration_pending:true},auth.access_token,'PUT');
      assert.equal(forged.status,409);assert.deepEqual(await state(auth.merchant_id),selected);
    });
    await t.test('staff cannot select a mode or alter pending company data',async()=>{
      const auth=await register('staff@example.test','products');
      await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,store_settings='{"registration_pending":true}'::jsonb WHERE id=${sqlText(auth.merchant_id)};
        UPDATE merchant_users SET role='staff' WHERE id=${sqlText(auth.user_id)};
        UPDATE merchant_team_members SET role='STAFF' WHERE user_id=${sqlText(auth.user_id)};`);
      const login=await request('/auth/login',{email:'staff@example.test',password});assert.equal(login.status,201);
      const before=await state(auth.merchant_id),response=await request('/merchants/me/store-settings',{business_mode:'services',company:{description:'Must not change'}},login.body.access_token,'PUT');
      assert.equal(response.status,403);assert.deepEqual(await state(auth.merchant_id),before);
    });
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
