import {createCampaignFixture} from "./prospect-campaign-fixture.js";
import {PrismaProspectConversationRepository} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-conversation.repository.js";
import {PrismaProspectConversationCommands} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-conversation-commands.js";
import {ProspectConversationService} from "../src/modules/platform-prospecting/application/conversations/prospect-conversation.service.js";
export async function createConversationFixture(){
 const f=await createCampaignFixture();
 try{
  const now=new Date();const c=await f.prisma.prospectConversation.create({data:{endpointId:f.endpoint.id,prospectId:f.lead.id,lastInboundEventId:"first-in",lastInboundAt:now,serviceWindowEndsAt:new Date(+now+86400000)}});
  const binding={id:"sender",version:1,wabaId:"waba",appId:"app",phoneNumberId:"phone",authorizationVersion:1,displayPhoneNumber:"phone",connectedBy:"operator",connectedAt:now.toISOString()};
  const captured:{id:string;text:string}[]=[];
  const control={unknown:false,price:0};
  const repo=new PrismaProspectConversationRepository(f.prisma);
  const commands=new PrismaProspectConversationCommands(repo,f.keys,()=>({amountCents:control.price,currency:"BRL",validUntil:new Date(Date.now()+60000)}));
  const service=new ProspectConversationService(repo,commands,{readiness:async()=>({binding,status:"ready",blockers:[],templates:[],portfolioLimit:100,portfolioUsed:null,updatedAt:now.toISOString()})},{async send(packet){captured.push({id:packet.attempt.id,text:packet.content});if(control.unknown)throw Error("timeout");return {state:"provider_accepted",providerMessageId:"wa."+packet.attempt.id,acceptedAt:new Date()};}});
  return {...f,c,repo,service,captured,control,actor:{operatorId:"operator",correlationId:"request"}};
 }catch(error){await f.close();throw error;}
}
