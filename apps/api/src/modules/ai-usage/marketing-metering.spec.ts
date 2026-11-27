import test from "node:test";
import assert from "node:assert/strict";
import { RecordAiUsageUseCase } from "./public-api.js";
import { MarketingInterestClassifier } from "../marketing/infrastructure/marketing-interest-classifier.js";

test("release marketing classifier obtains metering admission before the model and records measured tokens",async()=>{
  const order:string[]=[];let completion:any;
  const recorder=new RecordAiUsageUseCase({
    begin:async(context:any,provider:string,model:string,_scope:string,channel:string,component:string,key:string)=>{
      order.push("admit");assert.equal(context.merchantId,"store");assert.equal(context.costCenter,"automation");
      assert.equal(provider,"deepseek");assert.equal(model,"deepseek-chat");assert.equal(channel,"chat");assert.equal(component,"text_generation");
      assert.equal(key,"marketing-interest:store:inbound");return {id:"durable-attempt"};
    },completeSafely:async(input:any)=>{order.push("record");completion=input;},
  } as never);
  const classifier=new MarketingInterestClassifier(recorder,{getBaseUrl:()=>"https://api.deepseek.com/v1",getModel:()=>"deepseek-chat",chat:async()=>{
    order.push("model");return {content:JSON.stringify({interested:true,evidence:"Quero tênis",interests:["tênis"]}),usage:{promptTokens:10,completionTokens:5,totalTokens:15}};
  }});
  assert.deepEqual(await classifier.classify({merchantId:"store",conversationId:"thread",messageId:"inbound",text:"Quero tênis"}),{evidence:"Quero tênis",interests:["tênis"]});
  assert.deepEqual(order,["admit","model","record"]);
  assert.equal(completion.id,"durable-attempt");assert.equal(completion.status,"succeeded");
  assert.deepEqual(completion.payload.usage,{prompt_tokens:10,completion_tokens:5,total_tokens:15});
});

test("release rejected metering admission cannot make a paid marketing model call",async()=>{
  let calls=0;
  const recorder=new RecordAiUsageUseCase({begin:async()=>{throw Error("budget_exhausted");}} as never);
  const classifier=new MarketingInterestClassifier(recorder,{getBaseUrl:()=>"https://api.deepseek.com/v1",getModel:()=>"deepseek-chat",chat:async()=>{
    calls++;return {content:"{}",usage:{promptTokens:0,completionTokens:0,totalTokens:0}};
  }});
  await assert.rejects(classifier.classify({merchantId:"store",conversationId:"thread",messageId:"inbound",text:"Quero tênis"}),/budget_exhausted/);
  assert.equal(calls,0);
});

test("release marketing references redact personal data and credentials before model IO",async()=>{
  let reference="";
  const classifier=new MarketingInterestClassifier({begin:async()=>"attempt",execute:async()=>{}} as never,{
    getBaseUrl:()=>"https://api.deepseek.com/v1",getModel:()=>"deepseek-chat",chat:async(input)=>{
      reference=input.messages[1].content;
      return {content:'{"interested":false}',usage:{promptTokens:1,completionTokens:1,totalTokens:2}};
    },
  });
  await classifier.classify({merchantId:"store",conversationId:"thread",messageId:"inbound",text:"Quero tênis. ana@example.test, (11) 99999-1234, 123.456.789-09, api_key=sk-test-secret-secret"});
  for(const secret of ["ana@example.test","99999-1234","123.456.789-09","sk-test-secret-secret"])assert.equal(reference.includes(secret),false);
  assert.equal(reference.includes("Quero tênis"),true);
});

test("release unknown provider usage remains unknown instead of becoming measured zero tokens",async()=>{
  let capture:any;
  const classifier=new MarketingInterestClassifier({begin:async()=>"attempt",execute:async(input:any)=>{capture=input;}} as never,{
    getBaseUrl:()=>"https://api.deepseek.com/v1",getModel:()=>"deepseek-chat",chat:async()=>({content:'{"interested":false}',usageKnown:false,
      usage:{promptTokens:0,completionTokens:0,totalTokens:0}}),
  });
  await classifier.classify({merchantId:"store",conversationId:"thread",messageId:"inbound",text:"Quero tênis"});
  assert.equal(capture.executionStatus,"unknown");assert.equal(capture.promptTokens,undefined);assert.equal(capture.totalTokens,undefined);
});
