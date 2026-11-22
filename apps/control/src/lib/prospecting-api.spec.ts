import {test} from "node:test";
import assert from "node:assert/strict";
import {PlatformApi,PlatformApiError} from "./api.js";
import {ProspectCommandUnresolved} from "./prospecting-api.js";

test("PROS-31 AC1 resolves interrupted writes with the same operator and command identity before another submission",async t=>{
 const calls:{url:URL;init:RequestInit}[]=[];let resolved=false;
 t.mock.method(globalThis,"fetch",async(input:string,init:RequestInit)=>{
  const url=new URL(input);calls.push({url,init});
  assert.equal(new Headers(init.headers).get("Authorization"),"Bearer operator-session");
  if(init.method==="POST"){assert.deepEqual(JSON.parse(String(init.body)),{clientRequestId:"same-key",expectedEpoch:8,content:"OlÃ¡"});throw new TypeError("lost response");}
  assert.equal(url.pathname,"/v1/platform/prospecting/commands/same-key");
  return resolved?Response.json({clientRequestId:"same-key",state:"completed",result:{id:"m1",state:"prepared"},errorCode:null}):Response.json({message:"command_not_found"},{status:404});
 });
 const client=new PlatformApi("http://127.0.0.1:3019/v1").prospectingClient("operator-session");
 const body={clientRequestId:"same-key",expectedEpoch:8,content:"OlÃ¡"};
 await assert.rejects(client.send("conversation/id",body),e=>e instanceof ProspectCommandUnresolved&&e.clientRequestId==="same-key");
 assert.equal(calls[0].url.pathname,"/v1/platform/prospecting/conversations/conversation%2Fid/messages");
 resolved=true;
 assert.deepEqual(await client.send("conversation/id",body),{id:"m1",state:"prepared"});
 assert.equal(calls.filter(c=>c.init.method==="POST").length,1);
});
test("prospecting reads preserve exact filters, abort signals, forbidden, expired and stale responses",async t=>{
 const abort=new AbortController();let status=200;
 t.mock.method(globalThis,"fetch",async(input:string,init:RequestInit)=>{
  assert.equal(init.signal,abort.signal);
  init.signal?.throwIfAborted();
  const url=new URL(input);assert.equal(url.searchParams.get("cursor"),"opaque+/= &");
  assert.equal(url.searchParams.get("snapshotId"),"source/01");
  assert.deepEqual(JSON.parse(url.searchParams.get("filters")!),{cnpj:"00ABC34501DE35",capitalMinCents:"900719925474099317"});
  return Response.json(status===200?{items:[{cnpj:"00ABC34501DE35",capitalCents:"900719925474099317"}]}:{message:"version_conflict"},{status});
 });
 const api=new PlatformApi("http://127.0.0.1:3019").prospectingClient("session");
 const read=()=>api.companies({cursor:"opaque+/= &",snapshotId:"source/01",filters:{cnpj:"00ABC34501DE35",capitalMinCents:"900719925474099317"}},abort.signal);
 assert.deepEqual((await read()).items,[{cnpj:"00ABC34501DE35",capitalCents:"900719925474099317"}]);
 for(status of [401,403,409])await assert.rejects(read(),e=>e instanceof PlatformApiError&&e.status===status&&e.message==="version_conflict");
 abort.abort();await assert.rejects(read(),{name:"AbortError"});
});
