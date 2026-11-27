import assert from 'node:assert/strict';
import test from 'node:test';
import {assertServedObservationFacts} from '../../dashboard/e2e/service-served-artifact-observation.mjs';

const valid={kind:'served_artifact_observation',frontendId:'widget',sourceRevision:'a'.repeat(40),artifactSha256:'b'.repeat(64),
  releasePayloadSha256:'c'.repeat(64),observedOrigin:'http://127.0.0.1:5188',responseStatus:200,responseSha256:'d'.repeat(64),transport:'owned_http'};
test('release served observation accepts an actual loopback transport identity',()=>assert.doesNotThrow(()=>assertServedObservationFacts(valid)));
for(const patch of [{observedOrigin:'https://store.example.test'},{observedOrigin:'http://localhost:5188'},
  {observedOrigin:'http://127.0.0.1:80'},{responseStatus:404},{transport:'mock'},{frontendId:'other'},
  {sourceRevision:'ready'},{responseSha256:''},{artifactSha256:'assumed'},{releasePayloadSha256:'old'},{fixtureOnly:true}]){
  test('release served observation rejects unsupported evidence '+JSON.stringify(patch),()=>assert.throws(()=>assertServedObservationFacts({...valid,...patch})));
}
