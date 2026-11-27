import {test} from "node:test";
import assert from "node:assert/strict";
import {createCampaignFixture} from "../../../../../tests/prospect-campaign-fixture.js";
import {encryptPii} from "../../../../shared/crypto/pii-cipher.service.js";
import {PrismaCampaignRepository} from "./prisma-campaign.repository.js";
import {PrismaSenderObservationStore} from "./prisma-sender-observation.store.js";
import {MetaProspectingSenderAdapter} from "./meta-prospecting-sender.adapter.js";
test("PROS-14 AC2 official phone/opaque BSUID payloads correlate the durable attempt and accepted is never delivered or read",async()=>{
 const f=await createCampaignFixture();
 try{
  const key="d".repeat(64);await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{appId:"11",wabaId:"12",phoneNumberId:"13",grantedAssets:{businessId:"14"},encryptedCredentials:encryptPii("fixture-token",{AACP_PII_ENC_KEY:key})}});
  const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);const store=new PrismaSenderObservationStore(f.prisma,key);
  const reservation=await repo.reserveAttempt(f.recipient.id,"owner",new Date());assert.ok(reservation);
  assert.equal(await repo.markSubmitting(reservation.attempt.id,"owner",new Date()),true);
  let reply=()=>Response.json({messages:[{id:"wamid.fixture"}]});
  const calls:{url:string;body:Record<string,unknown>;auth:string|null}[]=[];
  const capture:typeof fetch=async(input,init)=>{calls.push({url:String(input),body:JSON.parse(String(init?.body)),auth:new Headers(init?.headers).get("authorization")});return reply();};
  const adapter=new MetaProspectingSenderAdapter(store,capture);const current=(await store.credential())!.binding;
  const template={...reservation.template!,wabaId:"12"};const packet={...reservation,template};
  const accepted=await adapter.send(packet,current);assert.equal(accepted.state,"provider_accepted");
  const row=await repo.recordResult(packet.attempt.id,"owner",accepted);assert.equal(row.state,"provider_accepted");assert.equal(row.providerMessageId,"wamid.fixture");assert.equal(row.deliveredAt,null);assert.equal(row.readAt,null);
  assert.equal(calls[0].url,"https://graph.facebook.com/v27.0/13/messages");assert.equal(calls[0].auth,"Bearer fixture-token");assert.deepEqual(calls[0].body,{messaging_product:"whatsapp",recipient_type:"individual",to:packet.identity.value,type:"template",template:{name:template.name,language:{code:template.language}},biz_opaque_callback_data:row.id});
  const bsuid={kind:"bsuid" as const,value:"BR.Xy-007",businessScope:"14"};
  const textPacket={...packet,template:null,identity:bsuid,normalizedEndpoint:bsuid.value,content:"confirmed message"};
  assert.equal((await adapter.send(textPacket,current)).state,"provider_accepted");
  assert.deepEqual(calls[1].body,{messaging_product:"whatsapp",recipient_type:"individual",recipient:"BR.Xy-007",type:"text",text:{body:"confirmed message",preview_url:false},biz_opaque_callback_data:row.id});
  reply=()=>Response.json({messages:[]});assert.equal((await adapter.send(textPacket,current)).state,"outcome_unknown");
  reply=()=>{throw new Error("timeout");};assert.equal((await adapter.send(textPacket,current)).state,"outcome_unknown");
  reply=()=>Response.json({error:{code:131026}},{status:400});assert.equal((await adapter.send(textPacket,current)).state,"not_accepted");
  const count=calls.length;assert.equal((await adapter.send({...textPacket,identity:{...bsuid,businessScope:"foreign"}},current)).state,"not_accepted");
  assert.deepEqual(await adapter.send({...packet,template:{...template,requiresParameters:true}},current),{state:"not_accepted",errorCode:"template_unavailable"});
  assert.deepEqual(await adapter.send({...packet,content:"unreviewed free text"},current),{state:"not_accepted",errorCode:"template_binding_mismatch"});assert.equal(calls.length,count);
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{version:2}});
  assert.equal((await adapter.send(textPacket,current)).state,"not_accepted");assert.equal(calls.length,count);
 }finally{await f.close();}
});

test("SENDPERM AC2 definitive Meta rejections persist safe numeric diagnostics and release the reservation",async()=>{
 const f=await createCampaignFixture();
 try{
  const key="d".repeat(64);await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{appId:"11",wabaId:"12",phoneNumberId:"13",grantedAssets:{businessId:"14"},encryptedCredentials:encryptPii("fixture-token",{AACP_PII_ENC_KEY:key})}});
  const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote),store=new PrismaSenderObservationStore(f.prisma,key);
  const packet=await repo.reserveAttempt(f.recipient.id,"owner",new Date());assert.ok(packet);assert.equal(await repo.markSubmitting(packet.attempt.id,"owner",new Date()),true);
  let error:Record<string,unknown>={code:10,error_subcode:2494065,message:"private provider text fixture-token",error_data:{details:"private recipient"},fbtrace_id:"private trace"};
  const adapter=new MetaProspectingSenderAdapter(store,async()=>Response.json({error},{status:400}));
  const current=(await store.credential())!.binding,request={...packet,template:{...packet.template!,wabaId:"12"}};
  const rejected=await adapter.send(request,current);assert.deepEqual(rejected,{state:"not_accepted",errorCode:"meta_http_400_code_10_subcode_2494065"});
  const result=await repo.recordResult(packet.attempt.id,"owner",rejected);assert.equal(result.errorCode,"meta_http_400_code_10_subcode_2494065");assert.equal(result.state,"not_accepted");
  assert.equal(result.providerMessageId,null);assert.equal(result.acceptedAt,null);assert.equal(result.deliveredAt,null);assert.equal(result.readAt,null);
  const attempt=await f.prisma.outreachAttempt.findUniqueOrThrow({where:{id:packet.attempt.id}}),campaign=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});
  assert.equal(attempt.costState,"released");assert.equal(campaign.spentCents,0n);assert.equal(campaign.reservedCents,0n);
  error={code:131026,error_subcode:"not-an-integer",message:"private provider text"};
  assert.deepEqual(await adapter.send(request,current),{state:"not_accepted",errorCode:"meta_http_400_code_131026"});
  assert.equal(JSON.stringify(result).includes("private"),false);assert.equal(JSON.stringify(result).includes("fixture-token"),false);
 }finally{await f.close();}
});

test("SENDPERM AC3 ambiguous responses retain reservations without retries and accepted is never delivered",async()=>{
 const replies:(()=>Response)[]=[
  ()=>Response.json({error:{code:10}},{status:408}),
  ()=>Response.json({error:{code:10}},{status:409}),
  ()=>Response.json({error:{code:10}},{status:500}),
  ()=>Response.json({error:{code:"10"}},{status:400}),
  ()=>new Response("not json",{status:400}),
  ()=>Response.json({messages:[]}),
  ()=>{throw Error("private timeout");},
  ()=>Response.json({messages:[{id:"wamid.accepted"}]}),
 ];
 for(let i=0;i<replies.length;i++){
  const f=await createCampaignFixture();try{
   const key="d".repeat(64);await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{appId:"11",wabaId:"12",phoneNumberId:"13",grantedAssets:{businessId:"14"},encryptedCredentials:encryptPii("fixture-token",{AACP_PII_ENC_KEY:key})}});
   const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote),store=new PrismaSenderObservationStore(f.prisma,key);
   const packet=await repo.reserveAttempt(f.recipient.id,"owner",new Date());assert.ok(packet);assert.equal(await repo.markSubmitting(packet.attempt.id,"owner",new Date()),true);
   let calls=0;const adapter=new MetaProspectingSenderAdapter(store,async()=>{calls++;return replies[i]();});
   const result=await repo.recordResult(packet.attempt.id,"owner",await adapter.send({...packet,template:{...packet.template!,wabaId:"12"}},(await store.credential())!.binding));
   const accepted=i===replies.length-1;assert.equal(result.state,accepted?"provider_accepted":"outcome_unknown");assert.equal(result.errorCode,accepted?null:"provider_acceptance_unknown");assert.equal(result.providerMessageId,accepted?"wamid.accepted":null);
   assert.equal(result.deliveredAt,null);assert.equal(result.readAt,null);
   const row=await f.prisma.outreachAttempt.findUniqueOrThrow({where:{id:packet.attempt.id}}),campaign=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});
   assert.equal(row.costState,accepted?"committed":"reserved");assert.equal(campaign.spentCents,accepted?25n:0n);assert.equal(campaign.reservedCents,accepted?0n:25n);
   assert.equal(await repo.reserveAttempt(f.recipient.id,"other",new Date()),null);assert.equal(calls,1);assert.equal(await f.prisma.outreachAttempt.count(),1);
  }finally{await f.close();}
 }
});
