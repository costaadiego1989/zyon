import {createProspectingRuntime} from "./prospecting-runtime.js";
import {readProspectingTestConfig} from "../../../../tests/prospecting-fixture.js";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {createCampaignFixture} from "../../../../tests/prospect-campaign-fixture.js";
import {createConversationFixture} from "../../../../tests/prospect-conversation-fixture.js";
import {PrismaCampaignRepository} from "./campaigns/prisma-campaign.repository.js";
import {PrismaProspectConversationCommands} from "./conversations/prisma-prospect-conversation-commands.js";
import {PrismaProspectConversationRepository} from "./conversations/prisma-prospect-conversation.repository.js";
import {PrismaProspectMetaInbox} from "./conversations/prisma-prospect-meta-inbox.js";
import {ProcessProspectInbound} from "../application/conversations/process-prospect-inbound.service.js";
import {recoverProspectSubmissions} from "./prospecting-recovery.js";

const root=fileURLToPath(new URL("../../../../../../",import.meta.url));
const time=new Date("2026-11-20T15:05:00Z");
for(const mode of ["accepted","unknown","crash"] as const){
  test("PROS-32 AC3 reinício após "+mode+" preserva tentativa, recibo, orçamento e uma única submissão HTTP",async()=>{
    const f=await createCampaignFixture();
    const provider=createServer(async(req,res)=>{
      const id=req.headers["x-effect-id"];
      if(req.method!=="POST"||typeof id!=="string"){res.writeHead(400).end();return;}
      await f.pg.query("INSERT INTO physical_request(effect_id) VALUES ($1)",[id]);
      res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({id:"wa."+id}));
    });
    try{
      await f.pg.query("CREATE TABLE physical_request(effect_id text NOT NULL)");
      await new Promise<void>(resolve=>provider.listen(0,"127.0.0.1",resolve));
      const address=provider.address();assert.ok(address&&typeof address==="object");
      const fork=async(stage:string)=>{
        const env={...process.env,RECOVERY_FIXTURE_DB:f.databaseUrl,RECOVERY_RECIPIENT:f.recipient.id,RECOVERY_PROVIDER:"http://127.0.0.1:"+address.port} as NodeJS.ProcessEnv;
        delete env.NODE_TEST_CONTEXT;
        const child=spawn(process.execPath,["--loader","./apps/api/tests/platform-support-loader.mjs","./apps/api/tests/prospecting-recovery-process.ts",stage],{cwd:root,env,windowsHide:true,stdio:["ignore","ignore","pipe"]});
        let error="";child.stderr.on("data",s=>error+=s);
        const code=await new Promise<number|null>((resolve,reject)=>{child.once("exit",resolve);child.once("error",reject);});
        assert.equal(code,stage==="crash"?27:0,error);
      };
      await fork(mode);
      const attempt=await f.prisma.outreachAttempt.findFirstOrThrow();
      const read=()=>f.prisma.outreachAttempt.findUniqueOrThrow({where:{id:attempt.id}});
      assert.equal(attempt.state,{accepted:"provider_accepted",unknown:"outcome_unknown",crash:"submitting"}[mode]);
      await fork("resume");await fork("resume");
      const saved=await read();
      assert.equal(saved.state,mode==="accepted"?"provider_accepted":"outcome_unknown");
      const before=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});
      assert.deepEqual([before.reservedCents,before.spentCents],mode==="accepted"?[0n,25n]:[25n,0n]);
      const inbox=new PrismaProspectMetaInbox(f.prisma,f.keys);
      const ingress={appId:"app",wabaId:"waba",phoneNumberId:"phone",value:{statuses:[{id:"wa."+attempt.id,status:"delivered",timestamp:String(+time/1000),biz_opaque_callback_data:attempt.id}]}};
      await inbox.accept(ingress);await inbox.accept(ingress);
      await new ProcessProspectInbound(new PrismaProspectConversationRepository(f.prisma)).processNext();
      await fork("resume");
      assert.equal((await read()).state,"delivered");
      assert.equal(await f.prisma.outreachAttempt.count(),1);
      assert.equal(await f.prisma.prospectInboxEvent.count({where:{state:"processed"}}),1);
      const after=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});
      assert.deepEqual([after.reservedCents,after.spentCents],[0n,25n]);
      const day=await f.prisma.prospectCampaignDailyUsage.findFirstOrThrow();
      assert.deepEqual([day.day,day.reservedRecipients,day.submittedRecipients],["2026-11-20",0,1]);
      assert.deepEqual((await f.pg.query("SELECT effect_id FROM physical_request")).rows,[{effect_id:attempt.id}]);
    }finally{await new Promise<void>(resolve=>provider.close(()=>resolve()));await f.close();}
  });
}
test("PROS-32 AC3 resposta comum interrompida segura a reserva, aceita confirmação tardia e mantém uma única mensagem",async()=>{
  const f=await createConversationFixture();
  try{
    const commands=new PrismaProspectConversationCommands(f.repo,f.keys,()=>({amountCents:0,currency:"BRL",validUntil:new Date(Date.now()+90000)}));
    const reservations=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);
    await f.service.ownership(f.c.id,{action:"assume",clientRequestId:"assume",expectedEpoch:0},f.actor);
    const m=await f.service.prepareManual(f.c.id,{clientRequestId:"restart-chat",content:"Exemplo de resposta",expectedEpoch:1},f.actor);
    assert.equal((await commands.beginSubmission(m.id,f.binding))?.attempt.id,m.id);
    const sweep=(now:Date)=>recoverProspectSubmissions(f.prisma,reservations,commands,now);
    await sweep(new Date());assert.equal((await commands.reply(m.id)).state,"submitting");
    await sweep(new Date(Date.now()+300000));assert.equal((await commands.reply(m.id)).state,"outcome_unknown");
    await f.service.dispatch(m.id);assert.deepEqual(f.captured,[]);
    await commands.settleReply(m.id,f.binding,{state:"provider_accepted",providerMessageId:"wa.confirmed",acceptedAt:new Date()});
    await sweep(new Date(Date.now()+600000));assert.equal((await commands.reply(m.id)).state,"provider_accepted");
    assert.equal(await f.prisma.outreachAttempt.count(),0);
    assert.equal(await f.prisma.prospectOutbox.count({where:{eventId:"chat."+m.id,state:"completed"}}),1);
  }finally{await f.close();}
});


test("PROS-32 AC3 lease expirado antes da submissão retoma o mesmo ordinal e recusa o dono antigo",async()=>{
  const f=await createCampaignFixture();
  try{
    const repo=new PrismaCampaignRepository(f.prisma,f.keys,()=>({amountCents:25,currency:"BRL",validUntil:new Date("2030-01-01")}));
    const start=new Date("2026-11-20T15:00Z");
    const original=await repo.reserveAttempt(f.recipient.id,"before-restart",start);
    assert.ok(original);
    assert.equal(await repo.reserveAttempt(f.recipient.id,"still-running",start),null);
    const recovered=await repo.reserveAttempt(f.recipient.id,"after-restart",time);
    assert.equal(recovered?.attempt.id,original.attempt.id);
    assert.equal(await repo.markSubmitting(original.attempt.id,"before-restart",time),false);
    assert.equal(await repo.markSubmitting(original.attempt.id,"after-restart",time),true);
    assert.equal(await f.prisma.outreachAttempt.count(),1);
    const totals=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});
    assert.deepEqual([totals.reservedCents,totals.spentCents],[25n,0n]);
  }finally{await f.close();}
});
test("PROS-32 AC3 parada graciosa aguarda consumo de entrada aceita e conserva handoff sem chamada paga",async(t)=>{
  const f=await createCampaignFixture();
  const cfg=readProspectingTestConfig();
  const runtime=createProspectingRuntime({
    PROSPECTING_ENABLED:"true",PROSPECTING_RUN_WORKERS:"true",PROSPECTING_DATABASE_URL:f.databaseUrl,PROSPECTING_DIRECTORY_DATABASE_URL:f.databaseUrl,
    PROSPECTING_NEO4J_READ_URI:cfg.neo4jUri,PROSPECTING_NEO4J_INGEST_URI:cfg.neo4jUri,PROSPECTING_NEO4J_READ_USER:cfg.neo4jUser,PROSPECTING_NEO4J_INGEST_USER:cfg.neo4jUser,
    PROSPECTING_NEO4J_READ_PASSWORD:cfg.neo4jPassword,PROSPECTING_NEO4J_INGEST_PASSWORD:cfg.neo4jPassword,PROSPECTING_SUPPRESSION_HMAC_KEY:f.keys.keys[1],PROSPECTING_CURSOR_HMAC_KEY:"b".repeat(64),
    PROSPECTING_PROPOSAL_SECRET:"local-dedicated-recovery-proposal-secret",PROSPECTING_PROPOSAL_TTL_SECONDS:"600",PROSPECTING_DASHBOARD_ORIGIN:"https://127.0.0.1:5180",
  });
  let signalEntered!:()=>void,release!:()=>void;
  const active=new Promise<void>(resolve=>signalEntered=resolve),continueWork=new Promise<void>(resolve=>release=resolve);
  const processInbound=runtime.history.processInbound.bind(runtime.history);
  t.mock.method(runtime.history,"processInbound",async(id:string)=>{signalEntered();await continueWork;return processInbound(id);});
  let closing:Promise<void>|undefined;
  try{
    await runtime.inbox.accept({appId:"app",wabaId:"waba",phoneNumberId:"phone",value:{messages:[{id:"shutdown-accepted",from:"5511999999999",timestamp:String(Math.floor(Date.now()/1000)),type:"text",text:{body:"Quero conversar sobre a Zyon."}}]}});
    runtime.onModuleInit();
    const processing=runtime.tick();await active;
    let closed=false;closing=runtime.onModuleDestroy().then(()=>{closed=true;});
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(closed,false);release();
    await Promise.all([processing,closing]);
    assert.equal(await f.prisma.prospectInboxEvent.count({where:{state:"processed"}}),1);
    assert.equal(await f.prisma.prospectMessage.count({where:{providerId:"shutdown-accepted",direction:"inbound"}}),1);
    assert.equal(await f.prisma.prospectConversation.count({where:{mode:"human"}}),1);
    assert.equal(await f.prisma.prospectModelUsage.count(),0);
  }finally{release();await (closing??runtime.onModuleDestroy());await f.close();}
});
