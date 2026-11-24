import assert from 'node:assert/strict';
export const BUYER_STOREFRONT_ORIGIN='http://127.0.0.1:5188';
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function artifact(value){assert.ok(exact(value,['buildId','manifestSha256','publicApiBaseUrl'])
  &&typeof value.buildId==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value.buildId)
  &&/^[a-f0-9]{64}$/.test(value.manifestSha256)&&value.publicApiBaseUrl==='/api/v1','buyer_storefront_artifact_required');return{...value};}
export function buyerStorefrontInit(value,runId){
  assert.ok(exact(value,['type','runId','apiOrigin','credential','artifact'])&&value.type==='buyer_storefront_init'
    &&/^[a-f0-9-]{36}$/.test(runId)&&value.runId===runId&&/^[a-f0-9]{96}$/.test(value.credential),
  'buyer_storefront_private_init_required');
  const upstream=new URL(value.apiOrigin);assert.ok(upstream.protocol==='http:'&&upstream.hostname==='127.0.0.1'
    &&Number(upstream.port)>1024&&Number(upstream.port)<=65535&&upstream.origin===value.apiOrigin,
  'buyer_storefront_owned_upstream_required');
  return{type:value.type,runId,apiOrigin:upstream.origin,credential:value.credential,artifact:artifact(value.artifact)};
}
export function buyerStorefrontReady(value,runId,expected){
  assert.ok(exact(value,['type','runId','origin','artifact','actualNextApplication'])&&value.type==='buyer_storefront_ready'
    &&value.runId===runId&&value.origin===BUYER_STOREFRONT_ORIGIN&&value.actualNextApplication===true,
  'buyer_storefront_ready_invalid');
  const current=artifact(value.artifact);assert.deepEqual(current,expected,'buyer_storefront_artifact_changed');
  return{origin:BUYER_STOREFRONT_ORIGIN,actualNextApplication:true,artifact:current};
}
