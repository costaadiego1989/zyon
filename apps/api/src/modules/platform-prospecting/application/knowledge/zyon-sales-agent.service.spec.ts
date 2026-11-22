import assert from "node:assert/strict";
import {test} from "node:test";
import {createConversationFixture} from "../../../../../tests/prospect-conversation-fixture.js";
import {knowledgeDraft} from "../../../../../tests/prospect-knowledge-fixture.js";
import {fixtureOffer} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaSalesKnowledgeRepository} from "../../infrastructure/knowledge/prisma-sales-knowledge.repository.js";
import {PrismaProspectConversationCommands} from "../../infrastructure/conversations/prisma-prospect-conversation-commands.js";
import {PrismaCampaignRepository} from "../../infrastructure/campaigns/prisma-campaign.repository.js";
import {ProspectConversationService} from "../conversations/prospect-conversation.service.js";
import {ZyonSalesAgentService} from "./zyon-sales-agent.service.js";
import {formatSalesOffer} from "../../domain/sales-answer.js";
import {PlatformSalesOffers} from "../../../payment/public-platform-sales-offers.js";
import {quoteBilling} from "../../../payment/infrastructure/billing-offers.js";
import type {SalesLlmRequest} from "../../domain/prospecting.ports.js";
import type {SalesKnowledgeAnswer} from "@zyon/shared-types";
async function fixture(){
 const f=await createConversationFixture();
 const offers={value:structuredClone(fixtureOffer),async current(){return structuredClone(this.value);},allowedUrl:(url:string)=>url===fixtureOffer.canonicalUrl};
 const repo=new PrismaSalesKnowledgeRepository(f.prisma);
 const draft=await repo.save("product",knowledgeDraft("agent"),f.actor);
 const fact=draft.draft[0];
 await f.prisma.salesKnowledgePublication.update({where:{id:fact.publicationId},data:{state:"published",projectedHash:draft.contentHash,projectedCount:1}});
 await f.prisma.salesKnowledgeActivePublication.create({data:{sourceId:"product",version:1,publicationId:fact.publicationId}});
 const inbound=await f.prisma.prospectMessage.create({data:{conversationId:f.c.id,sequence:1,senderBindingId:"sender",direction:"inbound",authorType:"prospect",state:"received",providerId:"first-in",content:"Como funciona o Chat?"}});
 await f.prisma.prospectConversation.update({where:{id:f.c.id},data:{lastSequence:1}});
 await f.service.addNote(f.c.id,{clientRequestId:"note",content:"SECRET internal note"},f.actor);
 const commands=new PrismaProspectConversationCommands(f.repo,f.keys,()=>({amountCents:f.control.price,currency:"BRL",validUntil:new Date(Date.now()+60000)}),offers);
 const capture:string[]=[];
 const conversation=new ProspectConversationService(f.repo,commands,{readiness:async()=>({binding:f.binding,status:"ready",blockers:[],templates:[],portfolioLimit:1,portfolioUsed:null,updatedAt:new Date().toISOString()})},{async send(packet){capture.push(packet.content);return {state:"provider_accepted",providerMessageId:"sent."+packet.attempt.id,acceptedAt:new Date()};}});
 const good:SalesKnowledgeAnswer={answer:fact.value,facts:[fact],sources:[{id:fact.sourceId,version:1,publicationId:fact.publicationId}],handoff:false,reason:null,callMode:"controlled",offer:null};
 const requests:SalesLlmRequest[]=[];
 const control={get price(){return f.control.price;},set price(n:number){f.control.price=n;},facts:[fact],respond:async(_i:SalesLlmRequest)=>good};
 const agent=new ZyonSalesAgentService(commands,conversation,{async queryPublishedKnowledge(){return control.facts;}},offers,{async respond(i){requests.push(i);return control.respond(i);}}, {maximumCostCents:10,timeoutMs:100});
 const run=()=>agent.respond({conversationId:f.c.id,messageId:inbound.id,expectedEpoch:0,planKey:"growth",query:{operation:"explain_feature",params:{feature:"Chat"}}});
 return {...f,offers,commands,conversation,capture,good,control,requests,inbound,run,fact};
}
test("PROS-21 AC2 persisted ordinary AI reply uses reviewed sources, preserves notes and consumes zero automatic ordinals",async()=>{
 const f=await fixture();try{
 const m=await f.run();assert.ok(m.messageId);assert.equal((await f.conversation.dispatch(m.messageId)).state,"provider_accepted");assert.deepEqual(f.capture,[f.fact.value]);
 assert.equal(f.requests[0].input,"Como funciona o Chat?");assert.ok(!JSON.stringify(f.requests[0]).includes("SECRET"));
 assert.equal(await f.prisma.outreachAttempt.count(),0);
 const audit=await f.prisma.prospectAuditEvent.findFirstOrThrow({where:{action:"sales.reply.prepared"}});assert.equal((audit.details as any).facts[0].publicationId,f.fact.publicationId);assert.equal((audit.details as any).facts[0].id,f.fact.id);
 }finally{await f.close();}
});
test("PROS-21 AC3 unavailable, conflicting, fabricated and stale information retains inbound and hands the conversation to a human",async()=>{
 for(const mode of ["missing","conflict","invented","error","withdraw","handoff"]){
 const f=await fixture();try{
 if(mode==="missing")f.control.facts=[];
 if(mode==="conflict")f.control.facts.push({...f.fact,id:"other",value:"Contradictory"});
 f.control.respond=async()=>{if(mode==="error")throw Error("provider_down");if(mode==="withdraw")await f.prisma.salesKnowledgeActivePublication.deleteMany();if(mode==="handoff")await f.service.ownership(f.c.id,{action:"assume",expectedEpoch:0,clientRequestId:"human"},f.actor);return mode==="invented"?{...f.good,answer:"O decisor da sua empresa fatura milhões."}:f.good;};
 const result=await f.run();assert.equal(result.messageId,null,mode);assert.equal((await f.prisma.prospectConversation.findUniqueOrThrow({where:{id:f.c.id}})).mode,"human",mode);
 assert.equal(await f.prisma.prospectMessage.count({where:{direction:"outbound"}}),0);assert.equal((await f.prisma.prospectMessage.findUniqueOrThrow({where:{id:f.inbound.id}})).content,"Como funciona o Chat?");
 }finally{await f.close();}}
});
test("PROS-21 AC4 canonical offer, budget and current source versions are fenced during generation and on submission",async()=>{
 const canonical=new PlatformSalesOffers("https://dashboard.example.test");
 const offer=await canonical.current("growth");assert.equal(offer.price.amountCents,quoteBilling("growth").amountCents);
 for(const mode of ["good","discount","planned","slow","queued","source","unbound","model_unknown"]){
 const f=await fixture();try{
 f.control.respond=async(i)=>{if(mode==="slow")f.offers.value.version="new";return {...f.good,offer:i.offer,facts:[],sources:[],answer:mode==="discount"?"Desconto de 50%":mode==="planned"?"Já inclui um recurso em planejamento":formatSalesOffer(i.offer)};};
 if(mode==="unbound")f.control.price=5;
 if(mode==="model_unknown"){
 const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);
 assert.ok(await repo.reserveAttempt(f.recipient.id,"fund",new Date()));
 await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{state:"completed"}});
 const id="sales."+f.inbound.id,input={conversationId:f.c.id,controlEpoch:0,requestId:id} as SalesLlmRequest;
 await f.commands.reserve(id,input,5);await f.commands.settle(id,"unknown");
 await assert.rejects(f.commands.reserve(id,input,5),/model_attempt_exists/);
 const [usage]=await f.pg.query("SELECT state,amount_cents FROM prospect_model_usage WHERE request_id=$1",[id]).then(r=>r.rows);
 assert.equal(usage.state,"unknown");assert.equal(Number(usage.amount_cents),5);
 assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}})).reservedCents,30n);continue;
 }
 const m=await f.run();
 if(mode==="good"){assert.ok(m.messageId);await f.conversation.dispatch(m.messageId);assert.deepEqual(f.capture,[formatSalesOffer(f.offers.value)]);}
 else if(mode==="queued"||mode==="source"){
 assert.ok(m.messageId);if(mode==="queued")f.offers.value.price.amountCents++;else await f.prisma.salesKnowledgeActivePublication.deleteMany();
 assert.equal((await f.conversation.dispatch(m.messageId)).state,"cancelled_before_submit");assert.deepEqual(f.capture,[]);
 }else{assert.equal(m.messageId,null,mode);assert.deepEqual(f.capture,[]);}
 if(mode==="unbound"){assert.equal(m.reason,"reply_budget_unavailable");assert.equal(f.requests.length,0);}
 }finally{await f.close();}}
});
test("PROS-21 AC5 destination allowlist rejects foreign domains and same-origin redirect, path and query variants",async()=>{
 const offers=new PlatformSalesOffers("https://dashboard.example.test");const valid=await offers.current("growth");
 assert.equal(offers.allowedUrl(valid.canonicalUrl),true);
 for(const u of [valid.canonicalUrl+"&next=https://wrong.test",valid.canonicalUrl.replace("dashboard.","other."),"https://dashboard.example.test/redirect"])assert.equal(offers.allowedUrl(u),false);
 const f=await fixture();try{f.control.respond=async()=>({...f.good,answer:f.offers.value.canonicalUrl+"?redirect=outside"});assert.equal((await f.run()).messageId,null);assert.equal(await f.prisma.prospectMessage.count({where:{direction:"outbound"}}),0);}finally{await f.close();}
});
