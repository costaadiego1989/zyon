import {test} from "node:test";
import assert from "node:assert/strict";
import {OpenAIChatAdapter} from "./openai-chat.adapter.js";

test("text support uses DeepSeek when an old OpenAI key is also configured",async()=>{
  const keys=["DEEPSEEK_API_KEY","DEEPSEEK_MODEL","DEEPSEEK_BASE_URL","OPENAI_API_KEY","OPENROUTER_API_KEY"];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let requested="",model="";
  try{
    process.env.DEEPSEEK_API_KEY="synthetic-deepseek-key";
    process.env.DEEPSEEK_MODEL="deepseek-chat";
    process.env.DEEPSEEK_BASE_URL="https://api.deepseek.com/v1";
    process.env.OPENAI_API_KEY="synthetic-unfunded-openai-key";
    process.env.OPENROUTER_API_KEY="synthetic-router-key";
    const http={toFetch:()=>async(input:unknown,init:RequestInit)=>{
      requested=String(input);model=JSON.parse(String(init.body)).model;
      return new Response(JSON.stringify({choices:[{message:{content:"Resposta verificada"}}]}));
    }};
    const adapter=new OpenAIChatAdapter(http as never);
    assert.equal(await adapter.complete([{role:"user",content:"Qual é a política?"}]),"Resposta verificada");
    assert.equal(requested,"https://api.deepseek.com/v1/chat/completions");
    assert.equal(model,"deepseek-chat");
  }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
