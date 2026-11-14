import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {companyHttpFixture,sqlText} from './service-company-http-fixture.mjs';

test('T11',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const runtime=await createServiceTestRuntime({local:true});
  try{
    const {request,register,json}=companyHttpFixture(runtime),auth=await register('policy@example.test');
    const path='/merchants/me/service-business-policy',own=sqlText(auth.merchant_id);
    const snapshot=()=>json(`SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM service_business_policies p WHERE merchant_id=${own}`);
    await t.test('ONB-03 unconfigured has no implicit hold/payment or admission',async()=>{
      const response=await request(path,undefined,auth.access_token,'GET');assert.equal(response.status,200);
      assert.deepEqual(response.body,{status:'unconfigured',version:0,policy:null});assert.deepEqual(await snapshot(),[]);
    });
    await t.test('ONB-03 invalid inputs preserve both policy and audit',async()=>{
      const before=await snapshot();
      for(const body of [{}, {expectedVersion:0,holdEnabled:true,holdMinutes:0,paymentMode:'online'},
        {expectedVersion:-1,holdEnabled:false,paymentMode:'online'}, {expectedVersion:'0',holdEnabled:false,paymentMode:'online'},
        {expectedVersion:2147483647,holdEnabled:false,paymentMode:'online'},
        {expectedVersion:0,holdEnabled:false,paymentMode:'later'}, {expectedVersion:0,holdEnabled:'false',paymentMode:'online'},
        {expectedVersion:0,holdEnabled:false,paymentMode:'online',admissionsEnabled:1},
        {expectedVersion:0,holdEnabled:false,paymentMode:'online',merchantId:'foreign'}]){
        const response=await request(path,body,auth.access_token);assert.ok([400,403].includes(response.status),JSON.stringify(response));
      }
      assert.deepEqual(await snapshot(),before);
      assert.equal(await runtime.db.sql(`SELECT count(*) FROM merchant_audit_events WHERE merchant_id=${own} AND action='service_policy.updated'`),'0');
    });
    let version=0;
    for(const holdEnabled of [false,true])for(const paymentMode of ['online','at_attendance'])await t.test('ONB-03 persists '+holdEnabled+'/'+paymentMode,async()=>{
      const response=await request(path,{expectedVersion:version,holdEnabled,holdMinutes:9,paymentMode,admissionsEnabled:true},auth.access_token);
      assert.equal(response.status,200,JSON.stringify(response));version++;
      assert.deepEqual(response.body,{status:'configured',version,policy:{holdEnabled,holdMinutes:holdEnabled?9:null,paymentMode,admissionsEnabled:true}});
      const stored=await json(`SELECT jsonb_build_object('version',version,'holdEnabled',hold_enabled,'holdMinutes',hold_minutes,'paymentMode',payment_mode,'admissionsEnabled',admissions_enabled,'configured',configured_at IS NOT NULL) FROM service_business_policies WHERE merchant_id=${own}`);
      assert.deepEqual(stored,{...response.body.policy,version,configured:true});
      const profile=await request('/merchants/me',undefined,auth.access_token,'GET');assert.equal(profile.body.policyVersion,version);
      assert.equal(profile.body.capabilities.serviceBooking,true);
    });
    await t.test('EDGE-02 stale version and racing writers cannot overwrite the winner',async()=>{
      const before=await snapshot(),body={expectedVersion:version-1,holdEnabled:false,paymentMode:'online'};
      assert.equal((await request(path,body,auth.access_token)).status,409);assert.deepEqual(await snapshot(),before);
      const results=await Promise.all(['online','at_attendance'].map(paymentMode=>request(path,{expectedVersion:version,holdEnabled:false,paymentMode},auth.access_token)));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);version++;
      const winner=results.find(r=>r.status===200).body;
      const reopened=await request(path,undefined,auth.access_token,'GET');assert.deepEqual(reopened.body,winner);
      assert.equal(winner.version,version);assert.equal(winner.policy.admissionsEnabled,false);
    });
    await t.test('ATEND-08 anonymous, staff and foreign identities cannot configure another business',async()=>{
      const before=await snapshot(),foreign=await register('foreign-policy@example.test');
      assert.equal((await request(path,{expectedVersion:0,holdEnabled:false,paymentMode:'online',merchant_id:auth.merchant_id},foreign.access_token)).status,403);
      assert.equal((await request(path,undefined,undefined,'GET')).status,401);
      await runtime.db.sql(`UPDATE merchant_users SET role='staff' WHERE id=${sqlText(foreign.user_id)};UPDATE merchant_team_members SET role='STAFF' WHERE user_id=${sqlText(foreign.user_id)}`);
      const login=await request('/auth/login',{email:'foreign-policy@example.test',password:'SyntheticPassword123!'},undefined,'POST');assert.equal(login.status,201);
      assert.equal((await request(path,{expectedVersion:0,holdEnabled:false,paymentMode:'online'},login.body.access_token)).status,403);
      assert.deepEqual(await snapshot(),before);
      assert.equal(await runtime.db.sql(`SELECT count(*) FROM service_business_policies WHERE merchant_id=${sqlText(foreign.merchant_id)}`),'0');
    });
    await t.test('ONB-02 products and classification-pending services remain blocked',async()=>{
      for(const [email,mode,review]of [['products-policy@example.test','products',false],['review-policy@example.test','services',true]]){
        const other=await register(email,mode);
        if(review)await runtime.db.sql(`UPDATE merchants SET business_mode_needs_review=true WHERE id=${sqlText(other.merchant_id)}`);
        for(const method of ['GET','PUT'])assert.equal((await request(path,method==='GET'?undefined:{expectedVersion:0,holdEnabled:false,paymentMode:'online'},other.access_token,method)).status,403);
        assert.equal(await runtime.db.sql(`SELECT count(*) FROM service_business_policies WHERE merchant_id=${sqlText(other.merchant_id)}`),'0');
      }
    });
    await t.test('failed audit rolls back the policy and its version',async()=>{
      const before=await snapshot();
      await runtime.db.sql(`CREATE FUNCTION synthetic_policy_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='service_policy.updated' THEN RAISE EXCEPTION 'synthetic_policy_audit_failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER synthetic_policy_audit_failure BEFORE INSERT ON merchant_audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_policy_audit_failure();`);
      try{assert.equal((await request(path,{expectedVersion:version,holdEnabled:true,holdMinutes:4,paymentMode:'online'},auth.access_token)).status,500);}
      finally{await runtime.db.sql('DROP TRIGGER synthetic_policy_audit_failure ON merchant_audit_events;DROP FUNCTION synthetic_policy_audit_failure();');}
      assert.deepEqual(await snapshot(),before);
    });
    assert.equal(runtime.evidence().providerCalls,0);
  }finally{await runtime.close();}
  assert.deepEqual(runtime.cleanupEvidence(),{appClosed:true,remainingContainers:0,remainingBridgeSockets:0});
});
