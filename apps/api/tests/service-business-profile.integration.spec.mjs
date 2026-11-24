import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {insert} from './service-migration-fixture.mjs';

const password='SyntheticPassword123!';
const sqlText=value=>"'"+String(value).replaceAll("'","''")+"'";
test('T9',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true,serviceReleaseFixture:'matching'});
  try{
    const request=async(path,body,token,method='POST')=>{
      const response=await fetch(runtime.apiOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,body:await response.json()};
    };
    const register=async(email,mode)=>{
      const response=await request('/auth/register',{merchant_name:'Synthetic profile '+mode,email,password,business_mode:mode});
      assert.equal(response.status,201,JSON.stringify(response));return response.body;
    };
    const profile=async token=>{const response=await request('/merchants/me',undefined,token,'GET');assert.equal(response.status,200,JSON.stringify(response));return response.body;};
    const product=await register('profile-products@example.test','products');
    await t.test('product fields survive reload and new login with additive capabilities',async()=>{
      await runtime.db.sql(`UPDATE merchants SET store_category='electronics',budget_mode_enabled=true,store_settings='{"company":{"description":"Synthetic retained company"}}'::jsonb,
        melhor_envio_access_token='private-profile-canary',melhor_envio_refresh_token='private-profile-canary' WHERE id=${sqlText(product.merchant_id)}`);
      const before=await profile(product.access_token);
      const login=await request('/auth/login',{email:'profile-products@example.test',password});assert.equal(login.status,201);
      const after=await profile(login.body.access_token);
      for(const field of ['id','name','slug','storeCategory','plan','budgetModeEnabled','storeSettings','theme','role','userId'])assert.deepEqual(after[field],before[field],field);
      assert.equal(after.id,product.merchant_id);assert.equal(after.role,'owner');assert.equal(after.storeCategory,'electronics');
      assert.equal(after.budgetModeEnabled,true);assert.equal(after.storeSettings.company.description,'Synthetic retained company');
      assert.equal(after.businessMode,'products');assert.equal(after.businessModeSelectionState,'selected');
      assert.equal(after.policyVersion,null);assert.equal(after.servicePolicy,null);assert.equal(after.servicePolicyStatus,'unconfigured');
      assert.deepEqual(after.capabilities,{products:true,serviceAdministration:false,serviceBooking:false,reconcileExisting:true});
      assert.equal(JSON.stringify(after).includes('private-profile-canary'),false);
      assert.equal(Object.hasOwn(after,'businessModeSelectedAt'),false);
    });
    const service=await register('profile-services@example.test','services');
    await t.test('service policy version is canonical and admissions remain independent',async()=>{
      const unconfigured=await profile(service.access_token);assert.equal(unconfigured.businessMode,'services');
      assert.equal(unconfigured.capabilities.serviceAdministration,true);assert.equal(unconfigured.capabilities.serviceBooking,false);
      assert.equal(unconfigured.bookingBlockReason,'policy_not_configured');
      await runtime.db.sql(insert('service_business_policies',{merchant_id:service.merchant_id,admissions_enabled:true,hold_enabled:false,payment_mode:'at_attendance',version:3,configured_at:'2030-01-01T00:00:00Z',updated_at:'2030-01-01T00:00:00Z'}));
      const login=await request('/auth/login',{email:'profile-services@example.test',password});assert.equal(login.status,201);
      const configured=await profile(login.body.access_token);assert.equal(configured.policyVersion,3);
      assert.deepEqual(configured.servicePolicy,{holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',admissionsEnabled:true});
      assert.equal(configured.capabilities.serviceBooking,true);assert.equal(configured.bookingBlockReason,null);
      await runtime.db.sql(`UPDATE service_business_policies SET admissions_enabled=false WHERE merchant_id=${sqlText(service.merchant_id)}`);
      const disabled=await profile(login.body.access_token);assert.equal(disabled.policyVersion,3);
      assert.equal(disabled.servicePolicy.admissionsEnabled,false);assert.equal(disabled.capabilities.serviceBooking,false);
      assert.equal(disabled.capabilities.reconcileExisting,true);assert.equal(disabled.bookingBlockReason,'admissions_disabled');
    });
    await t.test('role and plan remain separate from business mode',async()=>{
      await runtime.db.sql(`UPDATE merchants SET plan='STORE_ONLY',store_category='electronics' WHERE id=${sqlText(service.merchant_id)};
        UPDATE merchant_users SET role='admin' WHERE id=${sqlText(service.user_id)};
        UPDATE merchant_team_members SET role='ADMIN' WHERE user_id=${sqlText(service.user_id)};`);
      const login=await request('/auth/login',{email:'profile-services@example.test',password});assert.equal(login.status,201);
      const after=await profile(login.body.access_token);assert.equal(after.role,'admin');assert.equal(after.plan,'STORE_ONLY');
      assert.equal(after.businessMode,'services');assert.equal(after.capabilities.products,false);assert.equal(after.capabilities.serviceAdministration,true);
    });
    await t.test('legacy service evidence is read from actual offers and reservations',async()=>{
      await runtime.db.sql(`UPDATE merchants SET business_mode_selected_at=NULL,business_mode_needs_review=false WHERE id=${sqlText(product.merchant_id)};`);
      let legacy=await profile(product.access_token);assert.equal(legacy.businessModeSelectionState,'legacy');assert.equal(legacy.capabilities.products,true);
      await runtime.db.sql(insert('products',{id:'profile-legacy-service',merchant_id:product.merchant_id,name:'Synthetic legacy service',type:'service',updated_at:'2030-01-01T00:00:00Z'}));
      legacy=await profile(product.access_token);assert.equal(legacy.businessModeSelectionState,'review_required');assert.equal(legacy.bookingBlockReason,'classification_required');
      await runtime.db.sql("DELETE FROM products WHERE id='profile-legacy-service';"+
        insert('checkout_sessions',{id:'profile-legacy-checkout',merchant_id:product.merchant_id,session_id:'profile-legacy-session',global_user_id:'synthetic-profile-buyer',conversation_id:'synthetic-profile-conversation',cart:{items:[]},created_at:'2030-01-01T00:00:00Z',updated_at:'2030-01-01T00:00:00Z'})+
        insert('completed_orders',{id:'profile-legacy-order',merchant_id:product.merchant_id,session_id:'profile-legacy-session',external_order_id:'synthetic-profile-order',order_total:1,currency:'BRL',completed_at:'2030-01-01T00:00:00Z'})+
        insert('service_reservations',{id:'profile-legacy-reservation',merchant_id:product.merchant_id,order_id:'profile-legacy-order',unit_id:'profile-legacy-unit',resource_id:'legacy-explicit-resource',starts_at:'2030-01-02T10:00:00Z',ends_at:'2030-01-02T10:30:00Z',status:'reserved'}));
      legacy=await profile(product.access_token);assert.equal(legacy.businessModeSelectionState,'review_required');
      assert.equal(legacy.capabilities.serviceBooking,false);assert.equal(legacy.capabilities.reconcileExisting,true);
    });
    await t.test('authenticated profile cannot select a foreign tenant',async()=>{
      const response=await request('/merchants/me?merchant_id='+service.merchant_id,undefined,product.access_token,'GET');
      assert.ok([400,403].includes(response.status),JSON.stringify(response));
      const anonymous=await request('/merchants/me',undefined,undefined,'GET');assert.equal(anonymous.status,401);
      assert.equal((await profile(product.access_token)).id,product.merchant_id);
    });
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
