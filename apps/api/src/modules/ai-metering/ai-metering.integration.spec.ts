import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { OpenAIRealtimeVoiceService } from "../../shared/openai/openai-realtime-voice.service.js";
import { HttpClientService } from "../../shared/http/http-client.service.js";
import { createSupportFixture } from "../../../tests/platform-support-fixture.js";
import { meteredAiFetch, withAiMetering } from "../../shared/ai-metering.js";
import { AiMeteringService, credentialScope } from "./ai-metering.service.js";
import { AiCostsReader } from "./ai-costs.reader.js";

test("AI cost capture, guarded reports and durable usage run against real PostgreSQL and Redis",{skip:!process.env.PLATFORM_SUPPORT_TEST_DATABASE_URL,timeout:120000},async t=>{
  const f=await createSupportFixture({aiMetering:true}),db=f.prisma,meter=f.second.app.get(AiMeteringService),reader=f.second.app.get(AiCostsReader);
  const server=createServer((req,res)=>{let body="";req.on("data",b=>body+=b);req.on("end",()=>{const data=JSON.parse(body),status=data.mode==="reject"?429:200;res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data.mode==="missing"?{id:data.id,model:"gpt-4o-mini",choices:[]}:{id:data.id,model:data.model??"gpt-4o-mini",choices:[{message:{content:"ok"}}],usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100,prompt_tokens_details:{cached_tokens:200},...(data.mode==="reported"?{cost:0.000123}:{} )}}));});});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const port=(server.address() as any).port;
  const transport:typeof fetch=(input,init)=>fetch(`http://127.0.0.1:${port}/chat/completions`,init);
  const call=(merchantId:string,extra:Record<string,unknown>={},url="https://api.openai.com/v1/chat/completions")=>withAiMetering({merchantId,source:"fixture"},()=>meteredAiFetch("fixture",transport)(url,{method:"POST",headers:{Authorization:"Bearer fixture-not-a-secret"},body:JSON.stringify({id:randomUUID(),model:"gpt-4o-mini",...extra})}));
  const query={from:"2026-10-18T00:00:00.000Z",to:"2027-01-01T00:00:00.000Z"};
  const extras:string[]=[];
  try{
    await t.test("concurrent companies remain isolated and reported metadata persists without conversation content",async()=>{
      await Promise.all([call(f.merchants.growth!.id),call(f.merchants.scale!.id)]);
      const rows=await db.aiUsageEvent.findMany({where:{merchantId:{in:[f.merchants.growth!.id,f.merchants.scale!.id]}}});assert.equal(rows.length,2);
      for(const row of rows){assert.equal(row.costMicros,195n);assert.equal(row.usageKnown,true);assert.equal(row.costStatus,"estimated");assert.equal(row.metadata,null);assert.equal(row.billingAccountId,row.merchantId);}
    });
    await t.test("same provider response deduplicates; a physical new response is a new charge",async()=>{
      const id=randomUUID();await call(f.merchants.growth!.id,{id});await call(f.merchants.growth!.id,{id});
      assert.equal(await db.aiUsageEvent.count({where:{providerEventId:id}}),1);
      await call(f.merchants.growth!.id);assert.equal(await db.aiUsageEvent.count({where:{merchantId:f.merchants.growth!.id}}),3);
    });
    await t.test("missing usage and rejected calls remain distinct, provider-reported cost wins",async()=>{
      await call(f.merchants.growth!.id,{mode:"missing"});await call(f.merchants.growth!.id,{mode:"reject"});
      await call(f.merchants.growth!.id,{mode:"reported",model:"not-in-rate-card"},"https://openrouter.ai/api/v1/chat/completions");
      const rows=await db.aiUsageEvent.findMany({where:{merchantId:f.merchants.growth!.id}});assert(rows.some(x=>!x.usageKnown&&x.executionStatus==="unknown"));assert(rows.some(x=>x.executionStatus==="rejected"));assert(rows.some(x=>x.costStatus==="provider_reported"&&x.costMicros===123n));
    });
    await t.test("timeout leaves a persisted unknown attempt; unavailable persistence dispatches no paid request",async()=>{
      const id=f.merchants.growth!.id;
      await assert.rejects(withAiMetering({merchantId:id,source:"timeout"},()=>meteredAiFetch("timeout",async()=>{throw Error("timeout");})("https://api.openai.com/v1/chat/completions",{body:JSON.stringify({model:"gpt-4o-mini"})})),/timeout/);
      assert.equal(await db.aiUsageEvent.count({where:{merchantId:id,source:"timeout",executionStatus:"unknown"}}),1);
      let dispatched=false;await assert.rejects(withAiMetering({merchantId:"nonexistent",source:"fixture"},()=>meteredAiFetch("fixture",async()=>{dispatched=true;return new Response();})("https://api.openai.com/v1/chat/completions",{body:"{}"})));assert.equal(dispatched,false);
    });
    await t.test("existing HTTP retries keep their timeouts and record each physical provider attempt",async()=>{
      let attempts=0;const transport:typeof fetch=async()=>{attempts++;return attempts===1?new Response("temporary",{status:500}):Response.json({id:randomUUID(),model:"gpt-4o-mini",usage:{input_tokens:10,output_tokens:1,total_tokens:11}});};
      const http=new HttpClientService({retries:1,timeout:5000});
      const response=await withAiMetering({merchantId:f.merchants.growth!.id,source:"retry-proof"},()=>http.toFetch(meteredAiFetch("retry-proof",transport))("https://api.openai.com/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"gpt-4o-mini"})}));
      assert.equal(response.status,200);assert.equal(attempts,2);const rows=await db.aiUsageEvent.findMany({where:{merchantId:f.merchants.growth!.id,source:"retry-proof"}});assert.equal(rows.length,2);assert.equal(rows.filter(x=>x.usageKnown).length,1);
    });
    await t.test("voice text/audio count once; server identity persists session and permit correlation",async()=>{
      const merchantId=f.merchants.scale!.id,session=await meter.openVoiceSession({merchantId,conversationId:"voice-conversation"},"gpt-realtime-2.1-mini","fixture-not-a-secret","voice_checkout");
      const context={merchantId,conversationId:"voice-conversation",voiceSessionId:session.id,source:"voice_checkout",costCenter:"voice" as const},scope=credentialScope("openai","Bearer fixture-not-a-secret"),id=randomUUID();
      await meter.observeVoice(context,scope,session.model,{type:"response.created",response:{id}});
      const event={type:"response.done",response:{id,status:"completed",usage:{input_tokens:130,output_tokens:60,total_tokens:190,input_token_details:{text_tokens:100,audio_tokens:30,cached_tokens:0},output_token_details:{text_tokens:40,audio_tokens:20}}}};
      await meter.observeVoice(context,scope,session.model,event);await meter.observeVoice(context,scope,session.model,event);
      const row=await db.aiUsageEvent.findFirstOrThrow({where:{providerEventId:id}});assert.equal(row.costMicros,856n);assert.equal(row.audioCostMicros,700n);assert.equal(await db.aiUsageEvent.count({where:{providerEventId:id}}),1);
      await meter.observeVoice(context,scope,session.model,{type:"response.completed",response:{id,status:"completed"}});
      assert.equal((await db.aiUsageEvent.findUniqueOrThrow({where:{id:row.id}})).costMicros,856n);
      assert.equal((await db.aiUsageEvent.findUniqueOrThrow({where:{id:row.id}})).usageKnown,true);
      await meter.rememberVoicePermit("test-permit",context);assert.equal((await meter.voicePermitContext("test-permit",merchantId,"voice-conversation")).voiceSessionId,session.id);await assert.rejects(meter.voicePermitContext("test-permit",f.merchants.growth!.id,"voice-conversation"));
      await withAiMetering(context,()=>call(merchantId));const calls=await db.aiUsageEvent.findMany({where:{voiceSessionId:session.id}});assert.equal(calls.length,2);assert(calls.every(x=>x.costCenter==="voice"));
    });
    await t.test("guarded reports deny merchants/support and expose global data only to permitted operators",async()=>{
      for(const [token,status] of [[f.merchants.growth!.token,401],[f.operators.support!.token,403],[f.operators.billing!.token,200],[f.operators.admin!.token,200]]){const r=await fetch(f.first.url+"/v1/platform/ai-costs?"+new URLSearchParams(query),{headers:{Authorization:"Bearer "+token}});assert.equal(r.status,status,await r.text());}
      const exported=await fetch(f.first.url+"/v1/platform/ai-costs/export?"+new URLSearchParams(query),{headers:{Authorization:"Bearer "+f.operators.admin!.token}});assert.equal(exported.status,200);const csv=await exported.text();assert(csv.includes("costMicros"));assert(!csv.includes("fixture-not-a-secret"));
    });
    await t.test("server sideband captures final provider events without any browser usage submission",async()=>{
      const savedUrl=process.env.OPENAI_REALTIME_BASE_URL,savedKey=process.env.OPENAI_API_KEY,savedSecret=process.env.JWT_SECRET;
      const responseId=randomUUID();
      const provider=createServer((req,res)=>{res.writeHead(201,{Location:"/v1/realtime/calls/fixture_call"});res.end("v=0\r\na=fixture\r\n");});
      const sockets=new WebSocketServer({server:provider});
      sockets.on("connection",socket=>{socket.on("message",raw=>{const event=JSON.parse(raw.toString());if(event.type!=="response.create")return;socket.send(JSON.stringify({type:"response.created",response:{id:responseId,metadata:event.response.metadata}}));socket.send(JSON.stringify({type:"response.done",response:{id:responseId,status:"completed",usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_token_details:{text_tokens:100,audio_tokens:0,cached_tokens:0},output_token_details:{text_tokens:0,audio_tokens:20}}}}));});socket.send(JSON.stringify({type:"conversation.item.created",item:{id:"fixture_user_item",role:"user",content:[{type:"input_text",text:"test"}]}}));});
      await new Promise<void>(r=>provider.listen(0,"127.0.0.1",r));process.env.OPENAI_REALTIME_BASE_URL=`http://127.0.0.1:${(provider.address() as any).port}/v1`;process.env.OPENAI_API_KEY="sideband-fixture";process.env.JWT_SECRET="fixture-sideband-signing-secret-more-than-32-characters";
      const voice=new OpenAIRealtimeVoiceService({assertAllowed:async()=>undefined} as any,meter);
      try{
        const answer=await voice.createCall({sdp:"v=0\r\n",merchantId:f.merchants.scale!.id,conversationId:"sideband-conversation",aiUserId:"visitor:fixture-user",cart:{items:[]}});assert.equal(answer.providerCallId,"fixture_call");
        let row;for(let i=0;i<50;i++){row=await db.aiUsageEvent.findFirst({where:{providerEventId:responseId,usageKnown:true}});if(row)break;await new Promise(r=>setTimeout(r,50));}
        assert(row);assert.equal(row.measurementOrigin,"server_sideband");assert.equal(row.costMicros,460n);assert(row.voiceSessionId);
      }finally{await voice.onModuleDestroy();for(const socket of sockets.clients)socket.terminate();await new Promise<void>(r=>sockets.close(()=>r()));await new Promise<void>(r=>provider.close(()=>r()));for(const [k,v] of Object.entries({OPENAI_REALTIME_BASE_URL:savedUrl,OPENAI_API_KEY:savedKey,JWT_SECRET:savedSecret})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
    });
    await t.test("summary covers every company, pagination is deterministic and account grouping uses snapshots",async()=>{
      for(let n=0;n<105;n++)extras.push(f.tag+"_meter_"+n);
      await db.merchant.createMany({data:extras.map(id=>({id,name:"Meter fixture "+id}))});
      await db.aiUsageEvent.createMany({data:extras.map(id=>({idempotencyKey:randomUUID(),merchantId:id,billingAccountId:f.merchants.scale!.id,provider:"fixture",model:"fixture",source:"fixture_bulk",channel:"chat",component:"text_generation",executionStatus:"succeeded",usageKnown:true,costMicros:10n,currency:"USD",costStatus:"estimated",startedAt:new Date(),completedAt:new Date(),latencyMs:1,promptTokens:10,completionTokens:1,totalTokens:11,measurementOrigin:"server_http"}))});
      const report=await reader.report({...query,source:"fixture_bulk"});assert.equal(report.companiesTotal,"105");assert.equal(report.companies.length,30);assert.equal(report.summary!.calls,"105");assert.equal(report.summary!.costs[0]!.costMicros,"1050");
      await db.aiUsageEvent.create({data:{idempotencyKey:randomUUID(),merchantId:extras[0]!,source:"fixture_bulk",provider:"fixture",model:"fixture",channel:"chat",component:"text_generation",measurementOrigin:"budget_reservation",executionStatus:"succeeded",costMicros:999999n,currency:"USD",costStatus:"estimated",startedAt:new Date(),completedAt:new Date(),latencyMs:1}});
      assert.equal((await reader.report({...query,source:"fixture_bulk"})).summary!.costs[0]!.costMicros,"1050");
      const grouped=await reader.report({...query,source:"fixture_bulk",group:"account"});assert.equal(grouped.companiesTotal,"1");assert.equal(grouped.companies[0]!.stores,"105");
      const first=await reader.events({...query,source:"fixture_bulk"});assert.equal(first.items.length,50);const next=await reader.events({...query,source:"fixture_bulk",cursor:first.nextCursor!});assert.equal(next.items.length,50);assert(!first.items.some(x=>next.items.some(y=>x.id===y.id)));
      await assert.rejects(reader.events({...query,source:"different",cursor:first.nextCursor!}),/ai_costs_invalid_cursor/);
    });
  }finally{await db.aiUsageEvent.deleteMany({where:{merchantId:{in:extras}}});await db.merchant.deleteMany({where:{id:{in:extras}}});await new Promise<void>(resolve=>server.close(()=>resolve()));await f.close();}
});
