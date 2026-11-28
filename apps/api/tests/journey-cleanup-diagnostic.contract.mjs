import assert from 'node:assert/strict';
import test from 'node:test';
import {journeyCleanupDiagnostic} from './journey-cleanup-diagnostic.mjs';

test('known close assertion adds only its static check and assertion identifiers',()=>{
  const error=new Error('journey_owned_redis_ended_without_open_socket_required\nactual: private-value');error.code='ERR_ASSERTION';
  assert.deepEqual(journeyCleanupDiagnostic(error),{checkCode:'journey_owned_redis_ended_without_open_socket_required',assertionCode:'ERR_ASSERTION'});
});
test('phone, email, credentials and unknown prefixed values are never diagnostic identifiers',()=>{
  for(const message of['5511998000001','private@example.test','Bearer synthetic-private-token','journey_5511998000001','construction_private_user','journey_owned_redis_disconnect_failed_suffix']){
    const error=new Error(message);error.code='ERR_ASSERTION:private';assert.deepEqual(journeyCleanupDiagnostic(error),{});
  }
  const error=new Error('construction_redis_socket_identity_required:{"phone":"5511998000001","email":"private@example.test","token":"synthetic-private-token"}');
  const result=journeyCleanupDiagnostic(error);assert.deepEqual(result,{checkCode:'construction_redis_socket_identity_required'});
  assert.doesNotMatch(JSON.stringify(result),/5511998000001|private@example|synthetic-private-token/);
});
test('arbitrary message and code getters cannot run during cleanup diagnosis',()=>{
  let reads=0;const error={get message(){reads++;return'construction_redis_socket_identity_required';},get code(){reads++;return'ERR_ASSERTION';}};
  assert.deepEqual(journeyCleanupDiagnostic(error),{});assert.equal(reads,0);
});
