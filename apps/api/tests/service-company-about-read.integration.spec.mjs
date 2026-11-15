import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {companyHttpFixture,sqlText} from './service-company-http-fixture.mjs';

test('T14',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  try{
    const {request,register}=companyHttpFixture(runtime),auth=await register('private-login-canary@example.test','products'),id=sqlText(auth.merchant_id);
    await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_settings='{"company":{"cnpj":"123","address":{"city":"Cidade","privateNote":"PRIVATE_CANARY"},"credentials":{"token":"PRIVATE_CANARY"}},"social":{"instagram":"https://example.test/empresa"},"policies":{"terms":"Termos públicos"}}'::jsonb WHERE id=${id}`);
    let key=0;
    for(const path of ['/merchants/me/store-settings','/merchants/'+auth.merchant_id+'/store-settings','/settings/store']){
      const get=async()=>{const response=await request(path,undefined,auth.access_token,'GET');assert.equal(response.status,200);return {response,data:response.body.data??response.body};};
      const put=async description=>{
        const headers=path==='/settings/store'?{'if-match':(await get()).response.headers.get('etag'),'idempotency-key':'synthetic-read-'+(++key)}:{};
        const response=await request(path,{company:{description}},auth.access_token,'PUT',headers);assert.equal(response.status,200,JSON.stringify(response));return response.body.data??response.body;
      };
      await t.test('RAG-11 no private owner-email fallback or nested canaries via '+path,async()=>{
        const {data}=await get();assert.ok(data.company);
        assert.equal(data.company.email??null,null);assert.equal(JSON.stringify(data).includes('private-login-canary'),false);
        assert.equal(JSON.stringify(data).includes('PRIVATE_CANARY'),false);assert.equal(data.company.cnpj,'123');
        assert.equal(data.company.address.city,'Cidade');assert.equal(data.social.instagram,'https://example.test/empresa');
        assert.equal(data.policies.terms,'Termos públicos');
      });
      await t.test('ONB-05 save, reopen, merge omission and explicit clear via '+path,async()=>{
        assert.equal((await put('Empresa pública sintética')).company.description,'Empresa pública sintética');
        assert.equal((await get()).data.company.description,'Empresa pública sintética');
        assert.equal((await put('')).company.description,'');assert.equal((await get()).data.company.description,'');
        assert.equal(await runtime.db.sql(`SELECT store_settings->'company'->>'description' FROM merchants WHERE id=${id}`),'');
      });
    }
    await t.test('RAG-11 explicit persisted public contacts remain in every company response',async()=>{
      const email='public-business-contact@example.test',phone='11999999999';
      await runtime.db.sql(`UPDATE merchants SET store_settings=jsonb_set(store_settings,'{company}',(store_settings->'company')||'{"email":"public-business-contact@example.test","phone":"11999999999"}'::jsonb) WHERE id=${id}`);
      for(const path of ['/merchants/me/store-settings','/merchants/'+auth.merchant_id+'/store-settings','/settings/store']){
        const response=await request(path,undefined,auth.access_token,'GET');assert.equal(response.status,200);
        const data=response.body.data??response.body;
        assert.equal(data.company.email,email);assert.equal(data.company.phone,phone);assert.equal(data.company.cnpj,'123');
        assert.equal(JSON.stringify(data).includes('private-login-canary'),false);assert.equal(JSON.stringify(data).includes('PRIVATE_CANARY'),false);
      }
    });
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
