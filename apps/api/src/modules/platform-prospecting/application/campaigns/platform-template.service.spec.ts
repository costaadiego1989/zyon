import {test} from "node:test";
import assert from "node:assert/strict";
import {createProspectCrmFixture} from "../../../../../tests/prospect-crm-fixture.js";
import {PlatformTemplateService} from "./platform-template.service.js";
import {PrismaPlatformTemplateStore} from "../../infrastructure/campaigns/prisma-platform-template.store.js";
import {MetaPlatformTemplateAdapter} from "../../infrastructure/campaigns/meta-platform-template.adapter.js";
import {publicSender} from "../../infrastructure/campaigns/prisma-sender-binding.repository.js";
const actor={operatorId:"operator",correlationId:"templates"};
const draft={name:"zyon_introducao",language:"pt_BR",body:"Olá! Somos a Zyon, uma plataforma de comércio. Você tem interesse em conhecer a Zyon?",clientRequestId:"draft-message"};
test("CAMP-04 status compatibility preserves the campaign-selected body after reload instead of choosing the first approved message",async()=>{
 const messages=["first body","campaign selected body"].map((body,index)=>({id:"registry-"+index,name:"zyon_"+index,body,state:"APPROVED",bindingId:"sender",bindingVersion:1,wabaId:"own",providerId:"provider-"+index,providerRevision:"revision-"+index,language:"pt_BR"}));
 const templates=messages.map(d=>({id:d.providerId,name:d.name,previewText:d.body,wabaId:"own",revision:d.providerRevision,status:"APPROVED",category:"MARKETING",requiresParameters:false,language:"pt_BR"}));
 const service=new PlatformTemplateService({list:async()=>messages} as any,{} as any,{} as any,{readiness:async()=>({binding:{id:"sender",version:1,wabaId:"own"},templates} as any)});
 assert.deepEqual(await service.compatible("sender",1,undefined,"campaign selected body"),templates[1]);assert.equal(await service.compatible("sender",1,undefined,"not registered"),null);
 assert.equal(await service.compatible("sender",1,"registry-0","campaign selected body"),null);
});
test("CAMP-04 platform draft preserves full preview without binding and submission uses only own active platform authorization",async()=>{
 const f=await createProspectCrmFixture();try{
  let credential:any=null;const calls:{url:string;body:any;authorization:string|null}[]=[];
  const adapter=new MetaPlatformTemplateAdapter(async(url,init)=>{calls.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):null,authorization:new Headers(init?.headers).get("authorization")});return Response.json(init?.method==="POST"?{id:"meta-id",status:"PENDING",category:"MARKETING"}:{data:[]});});
  const service=new PlatformTemplateService(new PrismaPlatformTemplateStore(f.prisma),{credential:async()=>credential},adapter,{readiness:async()=>{throw Error("not_needed");}});
  const d=await service.create(draft,actor);assert.equal(d.state,"draft");assert.equal(d.body,draft.body);assert.equal(d.wabaId,null);assert.equal(d.providerId,null);assert.equal(d.purpose,"zyon_sales");assert.deepEqual(await service.create(draft,actor),d);
  await assert.rejects(service.submit(d.id,{expectedRevision:1,clientRequestId:"no-binding"},actor),/sender_unavailable/);assert.equal(calls.length,0);assert.equal((await service.list())[0].body,draft.body);
  const binding=publicSender(await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:"sender"}}));credential={binding,accessToken:"controlled-own-platform-token",businessId:"own"};
  const submitted=await service.submit(d.id,{expectedRevision:1,clientRequestId:"submit"},actor);assert.equal(submitted.state,"PENDING");assert.equal(submitted.wabaId,"waba");assert.equal(submitted.providerId,"meta-id");assert.equal(submitted.bindingId,"sender");
  const post=calls.find(c=>c.body);assert.ok(post);assert.match(post.url,/graph\.facebook\.com\/v27\.0\/waba\/message_templates/);assert.equal(post.authorization,"Bearer controlled-own-platform-token");assert.deepEqual(post.body.components,[{type:"BODY",text:draft.body}]);assert.equal(post.body.category,"MARKETING");assert.equal(JSON.stringify(submitted).includes("controlled-own-platform-token"),false);
  await service.submit(d.id,{expectedRevision:1,clientRequestId:"submit"},actor);await service.submit(d.id,{expectedRevision:1,clientRequestId:"second-submit"},actor);assert.equal(calls.filter(c=>c.body).length,1);
  credential={...credential,binding:{...binding,id:"merchant-binding"}};await assert.rejects(service.sync(d.id,{expectedRevision:1,clientRequestId:"merchant"},actor),/sender_identity_mismatch/);assert.equal(calls.filter(c=>c.body).length,1);
  await assert.rejects(service.create({...draft,body:"Olá {{1}}",clientRequestId:"parameter"},actor),/invalid_command/);
 }finally{await f.close();}
});
test("CAMP-04 status unknown submission never retries POST and reconciles real pending/rejected/approved static revision on the same WABA",async()=>{
 const f=await createProspectCrmFixture();try{
  const binding=publicSender(await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:"sender"}}));let state="absent",posts=0,body=draft.body;let name="",category="MARKETING";
  const adapter=new MetaPlatformTemplateAdapter(async(_url,init)=>{if(init?.method==="POST"){posts++;name=JSON.parse(String(init.body)).name;throw Error("timeout_after_acceptance");}return Response.json({data:state==="absent"?[]:[{id:"actual-meta",name,language:"pt_BR",category,status:state,rejected_reason:state==="REJECTED"?"Provider reason":undefined,components:[{type:"BODY",text:body}]}]});});
  let readiness:any={binding,status:"ready",blockers:[],templates:[],portfolioLimit:100,portfolioUsed:null,updatedAt:new Date().toISOString()};
  const service=new PlatformTemplateService(new PrismaPlatformTemplateStore(f.prisma),{credential:async()=>({binding,accessToken:"capture",businessId:"own"})},adapter,{readiness:async()=>readiness});
  const d=await service.create(draft,actor);const unknown=await service.submit(d.id,{expectedRevision:1,clientRequestId:"unknown"},actor);assert.equal(unknown.state,"submission_unknown");assert.equal(unknown.providerId,null);assert.equal(posts,1);
  await service.submit(d.id,{expectedRevision:1,clientRequestId:"do-not-repeat"},actor);assert.equal(posts,1);
  let observed=await service.sync(d.id,{expectedRevision:1,clientRequestId:"missing"},actor);assert.equal(observed.state,"submission_unknown");assert.equal(observed.reason,"template_not_found");
  for(const s of ["PENDING","REJECTED","APPROVED"]){state=s;observed=await service.sync(d.id,{expectedRevision:1,clientRequestId:"sync-"+s},actor);assert.equal(observed.state,s);assert.equal(observed.providerId,"actual-meta");assert.equal(observed.reason,s==="REJECTED"?"Provider reason":null);}
  const selected={id:observed.providerId!,wabaId:"waba",name:observed.name,language:"pt_BR",category:"MARKETING" as const,status:"APPROVED",revision:observed.providerRevision!,previewText:observed.body,requiresParameters:false};
  readiness.templates=[selected];assert.deepEqual(await service.compatible("sender",1),selected);
  for(const invalid of [{...selected,wabaId:"merchant-waba"},{...selected,revision:"stale"},{...selected,requiresParameters:true},{...selected,previewText:"changed"},{...selected,category:"UTILITY"}]){readiness.templates=[invalid];assert.equal(await service.compatible("sender",1),null);}
  readiness.templates=[selected];assert.equal(await service.compatible("foreign",1),null);
  body="Olá {{1}}";observed=await service.sync(d.id,{expectedRevision:1,clientRequestId:"parameterized-provider"},actor);assert.equal(observed.state,"APPROVED");assert.equal(observed.providerRevision,null);assert.equal(observed.reason,"template_content_mismatch");assert.equal(await service.compatible("sender",1),null);assert.equal(posts,1);
 }finally{await f.close();}
});
