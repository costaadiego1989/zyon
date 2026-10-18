import "reflect-metadata";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { PrismaAuthRepository } from "../src/modules/auth/infrastructure/prisma-auth.repository.js";
import { JwtService } from "../src/modules/auth/domain/services/jwt.service.js";
import { PlatformJwtService } from "../src/modules/platform-control/domain/services/platform-jwt.service.js";
import { PrismaPlatformOperatorRepository } from "../src/modules/platform-control/infrastructure/prisma-platform-operator.repository.js";

const environment=process.env.AI_COSTS_LIVE_ENV;if(environment!=="sandbox"&&environment!=="production")throw Error("explicit_environment_required");
const envId=environment==="sandbox"?"a347216c-86e3-4a75-8d73-5ae6e122408c":"604c900d-afcd-4e98-b5b5-d3a1a428997c";
const cli=path.join(process.env.APPDATA!,"npm/node_modules/@railway/cli/bin/railway.exe"),r=spawnSync(cli,["variables","--json","--project","b8421237-6557-4677-a08c-c93453b08568","--environment",envId,"--service","api"],{encoding:"utf8",windowsHide:true,timeout:20000});
if(r.status!==0)throw Error("runtime_configuration_unavailable");const vars=JSON.parse(r.stdout),url=new URL(vars.DATABASE_URL),proxy=process.env.AI_COSTS_DB_PROXY;
if(!proxy||!/^[a-z0-9.-]+\.proxy\.rlwy\.net:\d+$/.test(proxy))throw Error("verified_database_proxy_required");url.host=proxy;
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
const api=environment==="sandbox"?"https://api-sandbox-8146.up.railway.app":"https://api.zyon-payments.com.br";
const control=environment==="sandbox"?"https://control-sandbox.zyon-payments.com.br":"https://control.zyon-payments.com.br";
const tag="ai_meter_live_"+randomUUID().replaceAll("-",""),ids:string[]=[],ops:string[]=[],checks:string[]=[];
const evidence=process.env.AI_COSTS_EVIDENCE!;if(!evidence)throw Error("evidence_required");mkdirSync(evidence,{recursive:true});
const report:Record<string,unknown>={environment,tag,checks,startedAt:new Date().toISOString()};let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function request(route:string,token?:string,body?:unknown){const r=await fetch(api+"/v1"+route,{method:body?"POST":"GET",headers:{"Content-Type":"application/json",Origin:control,...(token?{Authorization:"Bearer "+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});return {status:r.status,data:await r.json().catch(()=>null)};}
try{
  const migration=await db.$queryRaw<Array<{finished_at:Date|null}>>`SELECT finished_at FROM _prisma_migrations WHERE migration_name='20261018190000_ai_cost_metering' AND rolled_back_at IS NULL`;assert(migration.some(x=>x.finished_at));checks.push("remote deployment migration applied");
  const auth=new PrismaAuthRepository(db),jwt=new JwtService(vars.JWT_SECRET,3600,auth),platform=new PlatformJwtService(new PrismaPlatformOperatorRepository(db),vars.PLATFORM_CONTROL_JWT_SECRET,3600);
  const merchants:Record<string,{id:string;token:string}>={};
  for(const name of ["first","other"]){const id=tag+"_"+name;ids.push(id);const {user}=await auth.createMerchantWithOwner({merchantId:id,merchantName:"Validação IA "+name,email:id+"@example.invalid",passwordHash:"temporary-test-no-password-login"});await db.merchant.update({where:{id},data:{plan:"STORE_ONLY"}});await db.merchantBillingSubscription.upsert({where:{merchantId:id},create:{merchantId:id,planKey:"growth",status:"active"},update:{planKey:"growth",status:"active"}});const steps={account:{status:"completed"},checkout_config:{status:"completed"},whatsapp:{status:"completed"},ai_engine:{status:"completed"}};await db.merchantOnboardingState.upsert({where:{merchantId:id},create:{merchantId:id,steps},update:{steps}});merchants[name]={id,token:await jwt.issue({userId:user.id,merchantId:id,email:user.email,role:"owner"})};}
  const operators:Record<string,{id:string;token:string;email:string;role:any}>={};for(const role of ["platform_admin","support_ops"] as const){const op=await db.platformOperator.create({data:{email:tag+role+"@example.invalid",role}});ops.push(op.id);operators[role]={...op,token:await platform.issue({operatorId:op.id,email:op.email,role},0)};}
  const m=merchants.first!,admin=operators.platform_admin!;
  // This public product endpoint executes the actual API's metered transport.
  const generated=await request(`/merchants/${m.id}/products/generate-description`,m.token,{name:"Produto temporário de validação",notes:"Responda com uma frase curta de teste. Não há produto real.",type:"physical"});
  const captured=await db.aiUsageEvent.findMany({where:{merchantId:m.id,source:"catalog_generation"}});assert(captured.length>0,"published_API_capture_missing");assert(captured.every(x=>x.measurementOrigin==="server_http"));
  report.descriptionRequestStatus=generated.status;report.textCalls=captured.map(x=>({provider:x.provider,model:x.model,usageKnown:x.usageKnown,status:x.executionStatus,costStatus:x.costStatus,costMicros:x.costMicros?.toString()}));
  assert(captured.some(x=>x.usageKnown),"provider_usage_not_received");checks.push("actual merchant API request persisted server-observed provider usage");
  assert.equal(await db.aiUsageEvent.count({where:{merchantId:merchants.other!.id}}),0);checks.push("other company receives no usage attribution");
  const forbidden=await request("/platform/ai-costs",operators.support_ops!.token);assert.equal(forbidden.status,403);const allowed=await request("/platform/ai-costs?merchantId="+m.id,admin.token);assert.equal(allowed.status,200);assert.equal(allowed.data.summary.calls,String(captured.length));checks.push("published admin aggregate matches remote persisted calls and enforces operator permissions");
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});await context.addInitScript(value=>sessionStorage.setItem("zyon.platform-control.session.v1",JSON.stringify(value)),{token:admin.token,operator:{operator_id:admin.id,email:admin.email,role:admin.role}});
  const page=await context.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto(control);await page.getByRole("button",{name:"Uso de IA",exact:true}).click();await page.getByRole("heading",{name:"Consumo e custos por empresa"}).waitFor();
  // Real WebRTC negotiation against the published API and the provider sideband.
  const conversation=await request("/storefront/conversations",undefined,{merchant_id:m.id});assert.equal(conversation.status,201,JSON.stringify(conversation.data));
  const proof=await page.evaluate(async args=>{
    const peer=new RTCPeerConnection(),audio=new AudioContext(),destination=audio.createMediaStreamDestination(),oscillator=audio.createOscillator(),gain=audio.createGain();gain.gain.value=0;oscillator.connect(gain).connect(destination);oscillator.start();peer.addTrack(destination.stream.getAudioTracks()[0]!,destination.stream);const channel=peer.createDataChannel("oai-events");
    const result=new Promise<{id:string;usage:unknown;status:string}>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("voice_response_timeout")),30000);channel.addEventListener("open",()=>channel.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:"Leia o resumo configurado."}]}})));channel.addEventListener("message",event=>{const value=JSON.parse(event.data);if(value.type==="response.done"){clearTimeout(timer);resolve({id:value.response.id,usage:value.response.usage,status:value.response.status});}});});
    try{await peer.setLocalDescription(await peer.createOffer());if(peer.iceGatheringState!=="complete")await new Promise<void>(resolve=>{const timer=setTimeout(resolve,2500);peer.addEventListener("icegatheringstatechange",()=>{if(peer.iceGatheringState==="complete"){clearTimeout(timer);resolve();}});});
      const r=await fetch(args.api+"/v1/storefront/conversations/"+args.id+"/realtime/narration",{method:"POST",headers:{Authorization:"Bearer "+args.token,"Content-Type":"application/json"},body:JSON.stringify({summary:"Teste de validação.",sdp:peer.localDescription!.sdp})});if(!r.ok)throw Error("voice_session_status_"+r.status);const answer=await r.json();await peer.setRemoteDescription({type:"answer",sdp:answer.sdp});return await result;
    }finally{channel.close();peer.close();oscillator.stop();await audio.close();}
  },{api,id:conversation.data.conversation_id,token:conversation.data.conversation_token});
  let voice;for(let i=0;i<60;i++){voice=await db.aiUsageEvent.findFirst({where:{merchantId:m.id,providerEventId:proof.id,usageKnown:true}});if(voice)break;await new Promise(r=>setTimeout(r,100));}assert(voice,"server_sideband_usage_not_persisted");assert.equal(voice.measurementOrigin,"server_sideband");assert(voice.voiceSessionId);assert(voice.costMicros!==null);report.voice={model:voice.model,inputTokens:voice.promptTokens,outputTokens:voice.completionTokens,costMicros:voice.costMicros?.toString(),audioCostMicros:voice.audioCostMicros?.toString()};checks.push("real browser WebRTC voice usage persisted by API sideband without browser accounting submission");
  await page.getByRole("searchbox").fill(m.id);await page.getByRole("button",{name:"Aplicar",exact:true}).click();await page.getByRole("button",{name:"Ver chamadas",exact:true}).first().waitFor();await page.getByRole("button",{name:"Ver chamadas",exact:true}).first().click();await page.getByRole("button",{name:"Detalhar",exact:true}).first().waitFor();
  await page.screenshot({path:path.join(evidence,environment+"-admin.png"),fullPage:true});const download=page.waitForEvent("download");await page.getByRole("button",{name:"Exportar CSV",exact:true}).click();await (await download).saveAs(path.join(evidence,environment+"-export.csv"));checks.push("published company call ledger and authorized CSV work");
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(evidence,environment+"-mobile.png"),fullPage:true});assert.deepEqual(errors,[]);checks.push("published mobile layout and browser runtime verified");
  const final=await request("/platform/ai-costs?merchantId="+m.id,admin.token);const rows=await db.aiUsageEvent.findMany({where:{merchantId:m.id}});assert.equal(final.data.summary.calls,String(rows.length));const usd=rows.filter(x=>x.currency==="USD").reduce((sum,x)=>sum+(x.costMicros??0n),0n);assert.equal(final.data.summary.costs.find((x:any)=>x.currency==="USD").costMicros,usd.toString());checks.push("final text and voice totals match database exactly");report.passed=true;
}catch(error){report.passed=false;report.error=error instanceof Error?error.message:"live_validation_failed";throw error;}
finally{
  await browser?.close();if(ids.length){await db.aiUsageEvent.deleteMany({where:{merchantId:{in:ids}}});await db.aiVoiceUsageSession.deleteMany({where:{merchantId:{in:ids}}});await db.merchant.deleteMany({where:{id:{in:ids}}});}if(ops.length){await db.platformAuditEvent.deleteMany({where:{actorOperatorId:{in:ops}}});await db.platformOperator.deleteMany({where:{id:{in:ops}}});}report.temporaryDataRemoved=true;report.finishedAt=new Date().toISOString();writeFileSync(path.join(evidence,environment+"-live-validation.json"),JSON.stringify(report,null,2));await db.$disconnect();console.log(JSON.stringify(report));
}
