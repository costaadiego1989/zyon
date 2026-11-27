import assert from "node:assert/strict";
import test from "node:test";
import {io,type Socket} from "socket.io-client";
import {createConversationFixture} from "../../../../tests/prospect-conversation-fixture.js";
import {createProspectingFixture} from "../../../../tests/prospecting-fixture.js";
import {ProspectConversationService} from "../application/conversations/prospect-conversation.service.js";
import {ProspectConversationController} from "./prospect-conversation.controller.js";
import {ProspectConversationGateway} from "./prospect-conversation.gateway.js";

const once=(s:Socket,event:string)=>new Promise<unknown>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("timeout "+event)),5000);s.once(event,data=>{clearTimeout(timer);resolve(data);});});
test("PROS-17 AC4 commits precede protected socket invalidations, revoked sessions lose command and delivery, polling recovers status-only changes",async()=>{
 const f=await createConversationFixture();const sockets:Socket[]=[];
 const http=await createProspectingFixture({controllers:[ProspectConversationController],providers:[ProspectConversationGateway,{provide:ProspectConversationService,useValue:f.service}]});
 try{
  const admin=http.operators.admin;await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[admin.id]);
  const second=await http.operatorJwt.issue({operatorId:admin.id,email:admin.email,role:"platform_admin"},0);
  const connect=async(token:string,authorized:boolean)=>{const s=io(http.url+"/platform-prospecting",{autoConnect:false,forceNew:true,reconnection:false,transports:["websocket"],auth:{accessToken:token}});sockets.push(s);const p=once(s,authorized?"authenticated":"disconnect");s.connect();await p;return s;};
  const revokedWatch=await connect(admin.token,true),revokedCommand=await connect(admin.token,true),live=await connect(second,true);
  await connect(http.operators.auditor.token,false);
  const changes:unknown[]=[];revokedWatch.on("prospect_changed",v=>changes.push(v));
  for(const s of [revokedWatch,live])assert.equal((await s.timeout(2000).emitWithAck("watch",{conversationId:f.c.id,after:0})).success,true);
  const gw=http.app.get(ProspectConversationGateway);
  const sql=await f.pg.connect();
  try{
   await sql.query("BEGIN");await sql.query("UPDATE prospect_conversations SET revision=1 WHERE id=$1",[f.c.id]);
   await sql.query("INSERT INTO prospect_conversation_changes(id,conversation_id,revision,kind) VALUES ('unstored',$1,1,'ownership')",[f.c.id]);
   await gw.flush();assert.deepEqual(changes,[]);await sql.query("ROLLBACK");
  }finally{sql.release();}
  const jti=JSON.parse(Buffer.from(admin.token.split(".")[1],"base64url").toString()).jti;
  await http.pg.query("UPDATE platform_auth_sessions SET revoked_at=now() WHERE id=$1",[jti]);
  const lost=once(revokedWatch,"disconnect"),lostCommand=once(revokedCommand,"disconnect");
  revokedCommand.emit("mark_read",{conversationId:f.c.id,clientRequestId:"forbidden",sequence:0});
  const notice=once(live,"prospect_changed");await f.service.ownership(f.c.id,{action:"assume",expectedEpoch:0,clientRequestId:"switch"},f.actor);
  await gw.flush();const event=await notice as Record<string,unknown>;await Promise.all([lost,lostCommand]);
  assert.equal(event.conversationId,f.c.id);assert.equal(event.kind,"ownership");assert.equal(event.cursor,"1");assert.equal(JSON.stringify(event).includes("accessToken"),false);
  assert.deepEqual(changes,[]);assert.equal(await f.prisma.prospectCommand.count({where:{clientRequestId:"forbidden"}}),0);
  assert.equal((await live.timeout(2000).emitWithAck("mark_read",{conversationId:f.c.id,clientRequestId:"allowed",sequence:0})).success,true);
  await connect(admin.token,false);live.disconnect();
  await f.service.ownership(f.c.id,{action:"release",expectedEpoch:1,clientRequestId:"offline"},f.actor);
  const base=http.url+"/v1/platform/prospecting/conversations/"+f.c.id;
  const headers={Authorization:"Bearer "+second};const replay=await (await fetch(base+"/changes?after=1",{headers})).json();
  assert.deepEqual(replay.items.map((x:{kind:string})=>x.kind),["read","ownership"]);assert.equal(replay.nextCursor,"3");assert.equal((await fetch(base+"/changes",{headers:{Authorization:"Bearer "+admin.token}})).status,401);
  const history=await (await fetch(base+"?after=0",{headers})).json();assert.deepEqual(history.messages,[]);assert.equal(history.conversation.mode,"ai");assert.equal(history.conversation.lastInboundPreview,null);assert.equal(history.conversation.revision,3);
 }finally{for(const s of sockets)s.close();await http.close();await f.close();}
});
