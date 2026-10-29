import "reflect-metadata";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { createSupportFixture } from "./platform-support-fixture.js";
import { AiMeteringService, credentialScope } from "../src/modules/ai-metering/ai-metering.service.js";
import { AiCostsReader } from "../src/modules/ai-metering/ai-costs.reader.js";

if(process.env.AI_COSTS_REAL_PROVIDER_TEST!=="1")throw Error("explicit_real_provider_test_required");
const r=spawnSync(path.join(process.env.APPDATA!,"npm/node_modules/@railway/cli/bin/railway.exe"),["variables","--json","--project","b8421237-6557-4677-a08c-c93453b08568","--environment","a347216c-86e3-4a75-8d73-5ae6e122408c","--service","api"],{encoding:"utf8",timeout:20000,windowsHide:true});
if(r.status!==0)throw Error("sandbox_provider_configuration_unavailable");const vars=JSON.parse(r.stdout);
const f=await createSupportFixture({aiMetering:true}),meter=f.second.app.get(AiMeteringService),reader=f.second.app.get(AiCostsReader),merchantId=f.merchants.growth!.id;
const checks:string[]=[],result:Record<string,unknown>={environment:"sandbox provider credentials, isolated local persistence",checks,startedAt:new Date().toISOString()};
let socket:WebSocket|undefined;
try{
  assert(vars.DEEPSEEK_API_KEY);const model=vars.CHECKOUT_LLM_MODEL||"deepseek-flash";
  const response=await meter.fetch({merchantId,source:"provider_validation"},"https://api.deepseek.com/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+vars.DEEPSEEK_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model,messages:[{role:"user",content:"Responda apenas OK."}],max_tokens:16,thinking:{type:"disabled"}}),signal:AbortSignal.timeout(30000)});
  assert(response.ok,"deepseek_response_status_"+response.status);const data=await response.json() as any;
  const text=await f.prisma.aiUsageEvent.findFirstOrThrow({where:{providerEventId:data.id}});assert(text.usageKnown);assert(text.costMicros!==null);checks.push("real DeepSeek tokens and versioned cost persisted");result.text={model:text.model,inputTokens:text.promptTokens,outputTokens:text.completionTokens,costMicros:text.costMicros?.toString(),costStatus:text.costStatus};
  assert(vars.OPENAI_API_KEY);const voiceModel=vars.OPENAI_REALTIME_MODEL||"gpt-realtime-2.1-mini";
  const session=await meter.openVoiceSession({merchantId,conversationId:"provider-validation"},voiceModel,vars.OPENAI_API_KEY,"voice_narration");
  socket=new WebSocket("wss://api.openai.com/v1/realtime?model="+encodeURIComponent(voiceModel),{headers:{Authorization:"Bearer "+vars.OPENAI_API_KEY},handshakeTimeout:10000});
  const live=socket;let chain=Promise.resolve();
  await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error("voice_provider_validation_timeout")),30000);
    live.on("error",()=>{clearTimeout(timeout);reject(Error("voice_provider_connection_failed"));});
    live.on("open",()=>{live.send(JSON.stringify({type:"session.update",session:{type:"realtime",model:voiceModel,output_modalities:["audio"],max_output_tokens:32,audio:{input:{turn_detection:null},output:{voice:"marin"}}}}));});
    live.on("message",raw=>{const event=JSON.parse(raw.toString());chain=chain.then(async()=>{
      if(event.type==="error"){clearTimeout(timeout);throw Error("voice_provider_"+(event.error?.code||"error"));}
      if(event.type==="session.updated"){live.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text:"Diga apenas: teste."}]}}));live.send(JSON.stringify({type:"response.create"}));}
      await meter.observeVoice({merchantId,source:"voice_narration",conversationId:"provider-validation",voiceSessionId:session.id,costCenter:"voice"},credentialScope("openai","Bearer "+vars.OPENAI_API_KEY),voiceModel,event);
      if(event.type==="response.done"){const row=await f.prisma.aiUsageEvent.findFirstOrThrow({where:{providerEventId:event.response.id}});assert(row.usageKnown);assert(row.costMicros!==null);checks.push("real OpenAI audio/text usage and audio cost persisted");result.voice={model:row.model,inputTokens:row.promptTokens,outputTokens:row.completionTokens,inputDetails:row.inputDetails,outputDetails:row.outputDetails,costMicros:row.costMicros?.toString(),audioCostMicros:row.audioCostMicros?.toString(),status:row.executionStatus};clearTimeout(timeout);resolve();}
    }).catch(error=>{clearTimeout(timeout);reject(error);});});
  });
  live.close();await meter.voiceSessionState(session.id,"closed");
  const report=await reader.report({merchantId});assert.equal(report.summary!.calls,"2");checks.push("company aggregate equals both provider captures");result.passed=true;result.finishedAt=new Date().toISOString();
  writeFileSync(path.join(process.env.AI_COSTS_EVIDENCE!,"real-provider-validation.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{socket?.terminate();await f.close();}
