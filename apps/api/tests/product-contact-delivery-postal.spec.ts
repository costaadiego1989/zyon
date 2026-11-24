import assert from 'node:assert/strict';
import test from 'node:test';
import {HttpClientService} from '../src/shared/http/http-client.service.js';
import {createOwnedPostalTransport} from './product-contact-delivery-postal.fixture.mjs';
const runId='11111111-1111-4111-8111-111111111111';
const casa='https://viacep.com.br/ws/01310100/json/',work='https://viacep.com.br/ws/01310200/json/';
test('S4 postal transport captures only two owned URLs through the same real HttpClientService instance',async()=>{
  const external:any[]=[],events:any[]=[],original=async(...args:any[])=>{external.push(args);return Response.json({original:true});};
  const client=new HttpClientService({timeout:15000,retries:3,fetchFn:original as any}),old=client.fetch,fixture=createOwnedPostalTransport(runId,(event:unknown)=>events.push(event)),installed=fixture.install(client);
  try{for(const[url,street,bairro]of[[casa,'Rua Casa Sintética','Centro'],[work,'Rua Trabalho Sintético','Jardins']]){const response=await client.toFetch()(url);assert.equal(response.status,200);const body=await response.json();assert.equal(body.logradouro,street);assert.equal(body.bairro,bairro);assert.equal(body.localidade,'São Paulo');assert.equal(body.uf,'SP');}
    assert.deepEqual(external,[]);assert.deepEqual(events.map(event=>[event.runId,event.sequence,event.zip]),[[runId,1,'01310100'],[runId,2,'01310200']]);assert.deepEqual(fixture.evidence(),{capturedPostalLookups:2,externalPostalCalls:0});
  }finally{installed.restore();fixture.close();}assert.equal(client.fetch,old);
});
test('S4 non-owned URL, query and origin remain on the unchanged original trap transport',async()=>{
  const external:any[]=[],client=new HttpClientService({timeout:15000,retries:3,fetchFn:(async(...args:any[])=>{external.push(args);return Response.json({original:true});})as any}),fixture=createOwnedPostalTransport(runId,()=>{}),installed=fixture.install(client);
  try{for(const url of['https://viacep.com.br/ws/99999999/json/',casa+'?x=1','https://other.example.test/ws/01310100/json/'])assert.equal((await(await client.toFetch()(url)).json()).original,true);
    assert.equal(external.length,3);assert.deepEqual(fixture.evidence(),{capturedPostalLookups:0,externalPostalCalls:0});
  }finally{installed.restore();fixture.close();}
});
test('S4 unexpected postal method/body or credential is rejected rather than widening the capture seam',async()=>{
  const client=new HttpClientService({timeout:15000,retries:3,fetchFn:(async()=>{throw Error('original trap');})as any}),fixture=createOwnedPostalTransport(runId,()=>{}),installed=fixture.install(client);
  try{for(const init of[{method:'POST'},{body:'private'},{headers:{Authorization:'Bearer not-allowed'}}])await assert.rejects(client.toFetch()(casa,init),/postal_fixture_request_invalid/);assert.deepEqual(fixture.evidence(),{capturedPostalLookups:0,externalPostalCalls:0});}
  finally{installed.restore();fixture.close();}
});
test('S4 original retries and timeout signal remain live when the captured delivery callback fails once',async()=>{
  let attempts=0;const client=new HttpClientService({timeout:15000,retries:3,fetchFn:(async()=>{throw Error('original trap');})as any}),fixture=createOwnedPostalTransport(runId,()=>{attempts++;if(attempts===1)throw Error('network controlled first attempt');}),installed=fixture.install(client);
  try{assert.equal((await client.toFetch()(casa)).status,200);assert.equal(attempts,2);assert.deepEqual(fixture.evidence(),{capturedPostalLookups:2,externalPostalCalls:0});}
  finally{installed.restore();fixture.close();}
});
test('S4 transport close restores the original method without changing options or another installed owner',async()=>{
  const client=new HttpClientService({timeout:15000,retries:3,fetchFn:(async()=>Response.json({original:true}))as any}),original=client.fetch,fixture=createOwnedPostalTransport(runId,()=>{}),installed=fixture.install(client);
  installed.restore();installed.restore();fixture.close();assert.equal(client.fetch,original);assert.equal((await(await client.toFetch()(casa)).json()).original,true);assert.deepEqual(fixture.evidence(),{capturedPostalLookups:0,externalPostalCalls:0});
});
