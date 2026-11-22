import assert from "node:assert/strict";
import test from "node:test";
import {createConversationFixture} from "../../../../tests/prospect-conversation-fixture.js";
import {createProspectingFixture} from "../../../../tests/prospecting-fixture.js";
import {ProspectConversationService} from "../application/conversations/prospect-conversation.service.js";
import {ProspectConversationController} from "./prospect-conversation.controller.js";
async function fixture(){
 const f=await createConversationFixture();
 try{
  const http=await createProspectingFixture({controllers:[ProspectConversationController],providers:[{provide:ProspectConversationService,useValue:f.service}]});
  const admin=http.operators.admin;await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[admin.id]);
  const base=http.url+"/v1/platform/prospecting/conversations";
  const req=(path:string,body?:unknown,token=admin.token)=>fetch(base+path,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",Authorization:token?"Bearer "+token:""},body:body===undefined?undefined:JSON.stringify(body)});
  return {...f,http,req,path:"/"+f.c.id,admin,async close(){await http.close();await f.close();}};
 }catch(error){await f.close();throw error;}
}
test("PROS-17 AC3 guarded note commands are operator-scoped, separate from history, recipient and AI context",async()=>{
 const f=await fixture();try{
  for(const [suffix,post] of [["",false],[f.path,false],[f.path+"/notes",false],[f.path+"/notes",true],[f.path+"/ownership",true],[f.path+"/messages",true],[f.path+"/read",true]] as const){
   for(const [token,status] of [["",401],["merchant",401],[f.http.operators.support.token,403]] as const)assert.equal((await f.req(suffix,post?{}:undefined,token)).status,status);
  }
  const note={clientRequestId:"note",content:"confidential note"};
  const created=await f.req(f.path+"/notes",note);assert.equal(created.status,201);const n=await created.json();
  assert.equal(n.operatorId,f.admin.id);assert.equal((await (await f.req(f.path+"/notes",note)).json()).id,n.id);
  assert.equal((await f.req(f.path+"/notes",{...note,content:"changed"})).status,409);
  const other=f.http.operators.billing;await f.http.pg.query("UPDATE platform_operators SET role='platform_admin' WHERE id=$1",[other.id]);await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[other.id]);
  const token=await f.http.operatorJwt.issue({operatorId:other.id,email:other.email,role:"platform_admin"},0);
  assert.equal((await f.req(f.path+"/notes",note,token)).status,409);
  const notes=await (await f.req(f.path+"/notes")).json();assert.deepEqual(notes.items.map((i:{content:string})=>i.content),["confidential note"]);
  const history=await (await f.req(f.path)).json();assert.deepEqual(history.messages,[]);assert.equal(JSON.stringify(history).includes("confidential note"),false);
  assert.equal(await f.prisma.prospectOutbox.count(),0);assert.deepEqual(f.captured,[]);
  assert.equal((await f.req("/missing")).status,404);assert.equal((await f.req("/missing/notes")).status,404);
  assert.equal((await f.req("?unknown=x")).status,400);
  await f.pg.query("ALTER TABLE prospect_messages RENAME TO unavailable_messages");assert.equal((await f.req(f.path)).status,503);
 }finally{await f.close();}
});
test("PROS-27 AC5 empty and oversized manual text reserve nothing; valid gestures expose paged history, ownership and monotonic reads",async()=>{
 const f=await fixture();try{
  const own=await f.req(f.path+"/ownership",{action:"assume",expectedEpoch:0,clientRequestId:"own"});assert.equal(own.status,200);assert.equal((await own.json()).mode,"human");
  for(const content of [""," ","a".repeat(4001)])assert.equal((await f.req(f.path+"/messages",{clientRequestId:"invalid",content,expectedEpoch:1})).status,400);
  assert.equal(await f.prisma.prospectMessage.count(),0);assert.deepEqual(f.captured,[]);
  const cmd={content:"one",expectedEpoch:1,clientRequestId:"first"};
  const first=await f.req(f.path+"/messages",cmd);assert.equal(first.status,202);const m=await first.json();assert.equal(m.state,"prepared");assert.equal(m.authorId,f.admin.id);
  assert.equal((await (await f.req(f.path+"/messages",cmd)).json()).id,m.id);assert.equal((await f.req(f.path+"/messages",{...cmd,content:"divergent"})).status,409);
  await f.req(f.path+"/messages",{...cmd,clientRequestId:"second",content:"two"});
  const page=await (await f.req(f.path+"?limit=1")).json();assert.equal(page.messages[0].content,"two");assert.equal(page.hasMore,true);
  const old=await (await f.req(f.path+"?before="+page.nextCursor)).json();assert.deepEqual(old.messages.map((m:{content:string})=>m.content),["one"]);
  assert.equal((await f.req(f.path+"?after=1&before=2")).status,400);
  assert.equal((await f.req(f.path+"/read",{clientRequestId:"over",sequence:3})).status,400);
  for(const n of [2,1])assert.equal((await (await f.req(f.path+"/read",{clientRequestId:"read"+n,sequence:n})).json()).readSequence,2);
  assert.equal((await (await f.req("?assignedOperatorId="+f.admin.id)).json()).items[0].id,f.c.id);
  assert.equal((await (await f.req(f.path+"/ownership",{action:"release",expectedEpoch:1,clientRequestId:"release"})).json()).mode,"ai");
  assert.equal(await f.prisma.prospectAuditEvent.count({where:{actorOperatorId:f.admin.id,action:"conversation.message"}}),2);
 }finally{await f.close();}
});
