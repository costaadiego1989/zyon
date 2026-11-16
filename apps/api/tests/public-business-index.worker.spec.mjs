import assert from 'node:assert/strict';
import test from 'node:test';
import {PublicBusinessIndexWorker} from '../src/modules/graph-rag/application/public-business-index.worker.js';

const version='public-v1:00000000000000000001';
const original={merchantId:'merchant-a',id:'work-1',leaseToken:'lease-original',sourceType:'company',sourceId:'merchant-a',
  sourceVersion:version,sourceHash:'a'.repeat(64),publicationState:'published'};
const source=()=>({merchantId:'merchant-a',sourceType:'company',sourceId:'merchant-a',sourceVersion:'opaque-canonical-snapshot',sourceHash:original.sourceHash,
  publicationState:'published',text:'Public introduction',publicData:{description:'Public introduction',list:['Original']}});
const prepared=()=>({merchantId:'merchant-a',sourceType:'company',sourceId:'merchant-a',sourceHash:original.sourceHash,publicRevision:1,
  active:true,modelId:'explicit-model-abi',dimensions:384,chunks:[{content:'Original chunk',embedding:[1,0]}]});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(overrides={}){
  const calls=[],failed=[],claimed=[{...original}],snapshot=source(),projection=prepared();
  const queue={claimNext:async merchant=>{calls.push('claim');assert.equal(merchant,'merchant-a');return claimed.shift()??null;},
    normalizeMarker:async claim=>{calls.push('normalize');assert.equal(claim.leaseToken,'lease-original');return'normalized';},
    loadSnapshot:async()=>{calls.push('snapshot');return{status:'ready',source:snapshot};},
    failConditional:async(claim,code)=>{calls.push('fail');failed.push({claim,code});return true;},...overrides.queue};
  const projections={prepare:async()=>{calls.push('prepare');return{status:'prepared',projection};},
    submit:async()=>{calls.push('graph');return{status:'applied'};},...overrides.projections};
  const admission={commit:async(_claim,_source,_prepared,submit)=>{calls.push('admit');await submit();calls.push('sql-and-complete');return'completed';},...overrides.admission};
  const worker=new PublicBusinessIndexWorker(queue,projections,admission,overrides.enabledFor??(merchant=>merchant==='merchant-a'));
  return{worker,queue,projections,admission,calls,failed,claimed,snapshot,projection};
}

for(const marker of ['550e8400-e29b-41d4-a716-446655440000','publication-dirty-v1:550e8400-e29b-41d4-a716-446655440000'])
  test('T66 opaque '+marker.split(':')[0]+' normalizes without snapshot embedding or graph in that claim',async()=>{
    const f=fixture();f.claimed[0].sourceVersion=marker;
    const result=await f.worker.runMerchant('merchant-a',1);
    assert.equal(result.normalized,1);assert.equal(result.completed,0);assert.deepEqual(f.calls,['claim','normalize']);
  });
test('T66 malformed canonical version fails safely instead of being projected or reinterpreted as a legacy marker',async()=>{
  const f=fixture();f.claimed[0].sourceVersion='public-v1:1';
  const result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.failed,1);assert.equal(f.failed[0].code,'invalid_source');assert.deepEqual(f.calls,['claim','fail']);
});
test('T66 canonical success performs final admission before graph and completes only after SQL',async()=>{
  const f=fixture();const result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.completed,1);assert.equal(result.failed,0);
  assert.deepEqual(f.calls,['claim','snapshot','prepare','admit','graph','sql-and-complete']);
});
test('T66 mutable claim and source cannot replace the original snapshot after asynchronous preparation',async()=>{
  const entered=defer(),release=defer();let originalClaim,admittedSource;
  const f=fixture({projections:{prepare:async value=>{assert.equal(Object.isFrozen(value.publicData.list),true);entered.resolve();await release.promise;return{status:'prepared',projection:prepared()};}},
    admission:{commit:async(claim,value,_projection,submit)=>{originalClaim=claim;admittedSource=value;await submit();return'completed';}}});
  const claimReference=f.claimed[0],running=f.worker.runMerchant('merchant-a',1);await entered.promise;
  claimReference.leaseToken='replaced-token';f.snapshot.text='Changed during model work';f.snapshot.publicData.list[0]='Changed';
  release.resolve();assert.equal((await running).completed,1);
  assert.equal(originalClaim.leaseToken,'lease-original');assert.equal(admittedSource.text,'Public introduction');
  assert.deepEqual(admittedSource.publicData.list,['Original']);assert.ok(Object.isFrozen(originalClaim));assert.ok(Object.isFrozen(admittedSource));
});
for(const status of ['superseded','lease_lost'])test('T66 '+status+' before preparation does not run embeddings or publish',async()=>{
  const f=fixture({queue:{loadSnapshot:async()=>({status})}}),result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result[status==='superseded'?'superseded':'leaseLost'],1);
  assert.equal(result.completed,0);assert.deepEqual(f.calls,['claim']);
});
test('T66 changed source identity or public fingerprint is refused before preparation',async()=>{
  const f=fixture();f.snapshot.sourceHash='b'.repeat(64);const result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.failed,1);assert.equal(f.failed[0].code,'invalid_source');assert.deepEqual(f.calls,['claim','snapshot','fail']);
});
test('T66 unavailable embedding receives only a safe durable failure code',async()=>{
  const f=fixture({projections:{prepare:async()=>({status:'unavailable',reason:'embedding_unavailable'})}}),result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.failed,1);assert.equal(f.failed[0].code,'embedding_unavailable');assert.equal(f.calls.includes('admit'),false);
});
test('T66 prepared projection cannot substitute another identity revision or fingerprint',async()=>{
  const f=fixture();f.projection.publicRevision=2;const result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.failed,1);assert.equal(f.failed[0].code,'invalid_source');assert.equal(f.calls.includes('graph'),false);
});
for(const status of ['ignored','unavailable'])test('T66 graph '+status+' cannot advance SQL or completed state',async()=>{
  const f=fixture({projections:{submit:async()=>{f.calls.push('graph');return{status};}}}),result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.completed,0);assert.equal(result.failed,1);assert.equal(f.failed[0].code,'graph_unavailable');
  assert.equal(f.calls.includes('sql-and-complete'),false);assert.equal(f.calls.filter(call=>call==='graph').length,1);
});
test('T66 SQL failure after graph submission remains failed and never resubmits inside that claim',async()=>{
  const f=fixture({admission:{commit:async(_claim,_source,_projection,submit)=>{await submit();throw new Error('private-sql-canary');}}});
  const result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.completed,0);assert.equal(result.failed,1);assert.equal(f.failed[0].code,'canonical_unavailable');
  assert.equal(f.calls.filter(call=>call==='graph').length,1);assert.equal(JSON.stringify(result).includes('private-sql-canary'),false);
});
test('T66 final admission lease loss submits no graph and acknowledges no replacement owner',async()=>{
  const f=fixture({admission:{commit:async()=> 'lease_lost'}}),result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.leaseLost,1);assert.equal(result.completed,0);assert.equal(f.calls.includes('graph'),false);assert.equal(f.failed.length,0);
});
test('T66 final admission must actually await an applied graph submission before reporting completed',async()=>{
  const f=fixture({admission:{commit:async()=> 'completed'}}),result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.completed,0);assert.equal(result.failed,1);assert.equal(f.failed[0].code,'canonical_unavailable');
});
test('T66 duplicate graph callback is refused rather than starting a second submission',async()=>{
  const f=fixture({admission:{commit:async(_claim,_source,_projection,submit)=>{await submit();await submit();return'completed';}}});
  const result=await f.worker.runMerchant('merchant-a',1);assert.equal(result.completed,0);assert.equal(result.failed,1);
  assert.equal(f.calls.filter(call=>call==='graph').length,1);
});
test('T66 a durable failure write outage does not expose error text or claim more work',async()=>{
  const f=fixture({queue:{failConditional:async()=>{throw new Error('private-db-canary');}},projections:{prepare:async()=>{throw new Error('private-model-canary');}}});
  f.claimed.push({...original,id:'work-2'});const result=await f.worker.runMerchant('merchant-a',2);
  assert.equal(result.failed,1);assert.equal(result.claimed,1);assert.equal(JSON.stringify(result).includes('private-'),false);
});
test('T66 foreign claim never grants authority to touch that tenant through a failure or publish port',async()=>{
  const f=fixture();f.claimed[0].merchantId='merchant-b';const result=await f.worker.runMerchant('merchant-a',1);
  assert.equal(result.failed,1);assert.deepEqual(f.calls,['claim']);assert.equal(f.failed.length,0);
});
test('T66 a batch is bounded to ten claims and disabled tenants never claim',async()=>{
  const f=fixture();f.claimed.push(...Array.from({length:14},(_,index)=>({...original,id:'work-'+(index+2)})));
  assert.equal((await f.worker.runMerchant('merchant-a')).claimed,10);assert.equal(f.claimed.length,5);
  for(const limit of [0,11,NaN,1.5])assert.throws(()=>f.worker.runMerchant('merchant-a',limit));
  const disabled=fixture({enabledFor:()=>false});assert.equal((await disabled.worker.runMerchant('merchant-a')).claimed,0);assert.deepEqual(disabled.calls,[]);
});
test('T66 concurrent runs for one merchant share one in-flight batch',async()=>{
  const entered=defer(),release=defer();const f=fixture({projections:{prepare:async()=>{entered.resolve();await release.promise;return{status:'prepared',projection:prepared()};}}});
  const first=f.worker.runMerchant('merchant-a',1);await entered.promise;const second=f.worker.runMerchant('merchant-a',1);
  assert.equal(first,second);release.resolve();assert.equal((await second).claimed,1);assert.equal(f.calls.filter(call=>call==='claim').length,1);
});
test('T66 stop during preparation drains that promise and starts no graph or later claim',async()=>{
  const entered=defer(),release=defer();const f=fixture({projections:{prepare:async()=>{entered.resolve();await release.promise;return{status:'prepared',projection:prepared()};}}});
  const running=f.worker.runMerchant('merchant-a',2);await entered.promise;let drained=false;
  const stopped=f.worker.stop().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);
  release.resolve();const result=await running;await stopped;
  assert.equal(result.deferred,1);assert.equal(result.completed,0);assert.equal(f.calls.includes('graph'),false);assert.equal(f.failed.length,0);
  assert.equal((await f.worker.runMerchant('merchant-a')).claimed,0);
});
test('T66 stop after final admission starts waits for its graph SQL completion and starts no next claim',async()=>{
  const entered=defer(),release=defer();const f=fixture({projections:{submit:async()=>{f.calls.push('graph');entered.resolve();await release.promise;return{status:'applied'};}}});
  f.claimed.push({...original,id:'work-2'});const running=f.worker.runMerchant('merchant-a',2);await entered.promise;let drained=false;
  const stopped=f.worker.stop().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);
  release.resolve();const result=await running;await stopped;
  assert.equal(result.completed,1);assert.equal(f.claimed.length,1);assert.equal(f.calls.filter(call=>call==='claim').length,1);
});
test('T66 marker normalization errors fail only the original lease without embedding',async()=>{
  const f=fixture({queue:{normalizeMarker:async()=>{throw new Error('private-marker-canary');}}});f.claimed[0].sourceVersion='legacy-opaque';
  const result=await f.worker.runMerchant('merchant-a',1);assert.equal(result.failed,1);assert.equal(f.failed[0].code,'canonical_unavailable');
  assert.equal(f.calls.includes('prepare'),false);assert.equal(f.failed[0].claim.leaseToken,'lease-original');
});
test('T66 stop during a pending claim drains it without beginning normalization or preparation',async()=>{
  const entered=defer(),release=defer();const f=fixture({queue:{claimNext:async()=>{entered.resolve();await release.promise;return{...original};}}});
  const running=f.worker.runMerchant('merchant-a',1);await entered.promise;let drained=false;
  const stopped=f.worker.stop().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);
  release.resolve();const result=await running;await stopped;
  assert.equal(result.claimed,1);assert.equal(result.deferred,1);assert.equal(result.completed,0);assert.deepEqual(f.calls,[]);
});
test('T66 prepared bytes and model metadata remain the captured object after admission awaits',async()=>{
  const entered=defer(),release=defer();let submitted;
  const f=fixture({admission:{commit:async(_claim,_source,_prepared,submit)=>{entered.resolve();await release.promise;await submit();return'completed';}},
    projections:{submit:async value=>{submitted=value;return{status:'applied'};}}});
  const running=f.worker.runMerchant('merchant-a',1);await entered.promise;
  f.projection.chunks[0].content='Changed outside worker';f.projection.dimensions=999;release.resolve();
  assert.equal((await running).completed,1);assert.equal(submitted.dimensions,384);assert.equal(submitted.chunks[0].content,'Original chunk');
  assert.ok(Object.isFrozen(submitted.chunks[0]));
});
test('T66 conditional failure losing its lease cannot acknowledge the replacement',async()=>{
  const f=fixture({queue:{failConditional:async()=>false},projections:{prepare:async()=>({status:'unavailable',reason:'embedding_unavailable'})}});
  const result=await f.worker.runMerchant('merchant-a',1);assert.equal(result.leaseLost,1);assert.equal(result.failed,0);assert.equal(result.completed,0);
});
test('T66 queue outage ends the batch with a safe code and no forged claim failure write',async()=>{
  const f=fixture({queue:{claimNext:async()=>{throw new Error('private-queue-canary');}}}),result=await f.worker.runMerchant('merchant-a',10);
  assert.equal(result.failed,1);assert.equal(result.claimed,0);assert.equal(result.lastFailureCode,'canonical_unavailable');
  assert.deepEqual(f.calls,[]);assert.equal(f.failed.length,0);assert.equal(JSON.stringify(result).includes('private-queue-canary'),false);
});
test('T66 a later retry after graph-only success retains the same revision and hash',async()=>{
  let attempts=0;const submissions=[];
  const f=fixture({admission:{commit:async(_claim,_source,_projection,submit)=>{await submit();if(++attempts===1)throw new Error('SQL not committed');return'completed';}},
    projections:{submit:async value=>{submissions.push([value.publicRevision,value.sourceHash]);return{status:'applied'};}}});
  assert.equal((await f.worker.runMerchant('merchant-a',1)).failed,1);
  f.claimed.push({...original,leaseToken:'fresh-claim-same-work'});
  assert.equal((await f.worker.runMerchant('merchant-a',1)).completed,1);
  assert.deepEqual(submissions,[[1,original.sourceHash],[1,original.sourceHash]]);
});
