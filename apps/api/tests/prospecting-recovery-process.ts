import "./test-network-guard.mjs";
import assert from "node:assert/strict";
import {PrismaClient} from "@prisma/client";
import {readProspectingTestConfig,validateProspectingTestConfig} from "./prospecting-fixture.js";
import {fixtureOffer,fixtureTemplate} from "./prospect-campaign-fixture.js";
import {PrismaCampaignRepository} from "../src/modules/platform-prospecting/infrastructure/campaigns/prisma-campaign.repository.js";
import {PrismaProspectConversationCommands} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-conversation-commands.js";
import {PrismaProspectConversationRepository} from "../src/modules/platform-prospecting/infrastructure/conversations/prisma-prospect-conversation.repository.js";
import {SenderReadinessService} from "../src/modules/platform-prospecting/application/campaigns/sender-readiness.service.js";
import {ProspectDispatchWorker} from "../src/modules/platform-prospecting/application/campaigns/prospect-dispatch.worker.js";
import {recoverProspectSubmissions} from "../src/modules/platform-prospecting/infrastructure/prospecting-recovery.js";

const url=process.env.RECOVERY_FIXTURE_DB!;
validateProspectingTestConfig({...readProspectingTestConfig(),databaseUrl:url});
assert.match(new URL(url).pathname,/^\/prospecting_test_[a-f0-9]{32}$/);
const target=new URL(process.env.RECOVERY_PROVIDER!);assert.equal(target.hostname,"127.0.0.1");
const stage=process.argv[2];assert.ok(["resume","accepted","unknown","crash"].includes(stage));
const db=new PrismaClient({datasources:{db:{url}}});
const keys={currentVersion:1,keys:{1:"a".repeat(64)}};
const quote=()=>({amountCents:25,currency:"BRL" as const,validUntil:new Date("2030-01-01")});
const now=new Date(stage==="resume"?"2026-11-20T15:04Z":"2026-11-20T15:00Z");
const campaign=new PrismaCampaignRepository(db,keys,quote);
try{
  const binding={id:"sender",version:1,appId:"app",wabaId:"waba",phoneNumberId:"phone",displayPhoneNumber:"fixture",connectedBy:"operator",connectedAt:new Date(0).toISOString(),authorizationVersion:1};
  const health=new SenderReadinessService({
    credential:async()=>({binding,businessId:"business",accessToken:"fixture"}),
    save:async(_,value)=>{await db.platformProspectSenderBinding.update({where:{id:"sender"},data:{health:JSON.parse(JSON.stringify(value))}});return true;},
    permission:async()=>"opted_in",
  },{read:async()=>({entities:[],templates:[fixtureTemplate],blockers:[],portfolioLimit:100,portfolioTier:"100"})});
  const worker=new ProspectDispatchWorker(campaign,health,{current:async()=>fixtureOffer,allowedUrl:()=>true},{
    async send(packet){
      const response=await fetch(target,{method:"POST",headers:{"x-effect-id":packet.attempt.id}});
      assert.equal(response.status,200);const {id}=await response.json();
      if(stage==="crash")process.exit(27);
      if(stage==="unknown")return {state:"outcome_unknown",errorCode:"provider_timeout"};
      return {state:"provider_accepted",providerMessageId:id,acceptedAt:now};
    }
  },()=>now);
  if(stage==="resume"){
    const commands=new PrismaProspectConversationCommands(new PrismaProspectConversationRepository(db),keys,quote);
    await recoverProspectSubmissions(db,campaign,commands,now);
  }
  await worker.processRecipient(process.env.RECOVERY_RECIPIENT!);
}finally{await db.$disconnect();}
