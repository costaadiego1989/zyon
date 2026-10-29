import test from "node:test";
import assert from "node:assert/strict";
import {remoteToolAuthorizer} from "../src/authorization.js";
test("MCP without authenticated credentials fails closed",async()=>{
  await assert.rejects(remoteToolAuthorizer({apiKey:"",bearerToken:""})({tool:"aacp_search_catalog",merchantId:"m1"}),/mcp_authenticated_access_required/);
});
test("MCP never forwards a credential over public plain HTTP",()=>{
  assert.throws(()=>remoteToolAuthorizer({baseUrl:"http://example.com",apiKey:"synthetic"}),/requires_https/);
});
test("MCP authorizes the tool with a bound tenant and rejects a forged scope",async()=>{
  let calls=0;
  const authorize=remoteToolAuthorizer({baseUrl:"https://api.example.test",apiKey:"synthetic",fetchFn:async(_url,init)=>{
    calls++;assert.equal(new Headers(init?.headers).get("x-aacp-api-key"),"synthetic");
    assert.equal(init?.redirect,"error");
    return new Response(JSON.stringify({allowed:true,merchantId:"m1"}));
  }});
  await authorize({tool:"aacp_search_catalog",merchantId:"m1"});
  await assert.rejects(authorize({tool:"aacp_search_catalog",merchantId:"m2"}),/scope_invalid/);
  assert.equal(calls,2);
});
test("MCP denial or unavailable authorization cannot execute a tool",async()=>{
  for(const response of [new Response("{}",{status:403}),new Response(JSON.stringify({allowed:false,merchantId:"m1"}))]){
    await assert.rejects(remoteToolAuthorizer({baseUrl:"https://api.example.test",apiKey:"synthetic",fetchFn:async()=>response})({tool:"aacp_search_catalog",merchantId:"m1"}),/mcp_access_denied|scope_invalid/);
  }
  await assert.rejects(remoteToolAuthorizer({baseUrl:"https://api.example.test",apiKey:"synthetic",fetchFn:async()=>{throw Error("timeout");}})({tool:"aacp_search_catalog"}),/unavailable/);
});
