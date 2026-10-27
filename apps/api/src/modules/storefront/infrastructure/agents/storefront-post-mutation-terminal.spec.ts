import assert from "node:assert/strict";
import test from "node:test";
import type { OpenRouterChatRequest, OpenRouterChatResult, OpenRouterProvider } from "@zyon/conversation-engine";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

// Real agent, classifier prompt, tool registry and Zod wrappers. Only the remote
// provider and repository-facing handlers are doubled; NOT SQL/HTTP evidence.
const usage={promptTokens:20,completionTokens:10,totalTokens:30};
const success="Carrinho atualizado. Confira os itens e valores.";
const unknown="Não consegui confirmar a alteração. Confira o carrinho antes de tentar novamente.";
const rejected="Para alterar o carrinho, escolha o produto e peça a alteração explicitamente.";
const cartId="actual-cart",sessionId="conversation";
const item=(variantId="target",quantity=2)=>({variantId,name:variantId,quantity,unitPrice:10,lineTotal:10*quantity});
const cart=(items:Array<ReturnType<typeof item>&{optionItemIds?:string[];serviceSlotId?:string|null}>=[item()])=>({cartId,items,
  total:items.reduce((sum,line)=>sum+line.lineTotal,0),itemCount:items.reduce((sum,line)=>sum+line.quantity,0)});
type Operation="update_cart_item"|"remove_cart_item";
function fixture(operation:Operation,options:{args?:Record<string,unknown>;output?:unknown;throws?:boolean;
  postWrite?:"whitespace"|"throw"|"unrelated";message?:string;generatedOnly?:boolean}={}){
  const requests:OpenRouterChatRequest[]=[],tokens:string[]=[],effects:Record<string,unknown>[]=[],seenArgs:unknown[]=[];
  let attempts=0,writes=0,fallbackCalls=0,mainCalls=0,reviewCalls=0;
  const args={cartId,variantId:"target",...(operation==="update_cart_item"?{quantity:2}:{}),...options.args};
  const provider={chat:async(request:OpenRouterChatRequest):Promise<OpenRouterChatResult>=>{
    requests.push(structuredClone(request));const prompt=JSON.parse(request.messages[0]!.content!).id;
    if(prompt==="storefront.intent")return {content:JSON.stringify({schemaVersion:2,domain:"STORE_COMMERCE",intent:"COMPLEX_QUESTION",
      confidence:1,requiresTool:!options.generatedOnly,needsProductDiscovery:false}),usage,finishReason:"stop"};
    if(prompt==="storefront.reply-review"){
      reviewCalls++;return {content:JSON.stringify({schemaVersion:1,verdict:"ALLOW",confidence:1}),usage,finishReason:"stop"};
    }
    mainCalls++;
    if(options.generatedOnly)return {content:JSON.stringify({schemaVersion:1,message:"Posso ajudar com os produtos desta loja."}),usage,finishReason:"stop"};
    if(mainCalls===1)return {content:"",toolCalls:[{id:"mutation",name:operation,args}],usage,finishReason:"tool_calls"};
    if(options.postWrite==="throw")throw new Error("PRIVATE_POST_COMMIT_PROVIDER_FAILURE");
    if(options.postWrite==="unrelated")return {content:JSON.stringify({schemaVersion:1,message:"PRIVATE_UNRELATED_ANSWER"}),usage,finishReason:"stop"};
    return {content:" \n\t",usage,finishReason:"stop"};
  }} as unknown as OpenRouterProvider;
  const handler=async(validatedArgs:unknown)=>{
    attempts++;seenArgs.push(structuredClone(validatedArgs));writes++;
    if(options.throws)throw new Error("PRIVATE_COMMIT_ACK_LOST");
    const output=Object.hasOwn(options,"output")?options.output:operation==="update_cart_item"?cart():cart([]);
    effects.push({operation,args:structuredClone(args)});return structuredClone(output);
  };
  const agent=new StorefrontLangGraphAgent({provider,structuredRouting:true,fastModel:"synthetic",model:"synthetic",budgetCents:500,
    fallbackProvider:{chat:async()=>{fallbackCalls++;throw new Error("PRIVATE_MUST_NOT_RETRY");}} as unknown as OpenRouterProvider,
    toolHandlers:{updateCartItem:handler,removeCartItem:handler} as unknown as StoreToolHandlers});
  return {requests,tokens,effects,seenArgs,counts:()=>({attempts,writes,mainCalls,reviewCalls,fallbackCalls}),run:()=>agent.run({
    merchantId:"merchant",sessionId,cartId,storeCategory:"books",history:[],
    userMessage:options.message??(operation==="update_cart_item"?"Altere a quantidade no carrinho para 2 unidades [variantId:target]":"Remova do carrinho [variantId:target]"),
    callbacks:{onToken:value=>{tokens.push(value);}},
  })};
}

for(const operation of ["update_cart_item","remove_cart_item"] as const)
  for(const postWrite of ["whitespace","throw","unrelated"] as const)
    test(`${operation} canonical commit is terminal before a ${postWrite} provider continuation/review`,async()=>{
      const f=fixture(operation,{postWrite}),result=await f.run();
      assert.equal(result.message,success);assert.deepEqual(f.tokens,[success]);
      assert.deepEqual(f.counts(),{attempts:1,writes:1,mainCalls:1,reviewCalls:0,fallbackCalls:0});
      assert.equal(f.requests.length,2,"one real classifier request and one main tool request only");
      assert.equal(JSON.parse(f.requests[0]!.messages[0]!.content!).id,"storefront.intent");
      assert.deepEqual(f.seenArgs,[{cartId,variantId:"target",...(operation==="update_cart_item"?{quantity:2}:{})}]);
      assert.equal(result.cartId,cartId);const blocks=result.blocks.filter(block=>block.type==="cart_summary");assert.equal(blocks.length,1);
      const summary=blocks[0]!;assert.equal(summary.data.cartId,cartId);
      assert.equal(summary.data.total,operation==="update_cart_item"?20:0);
      assert.equal(summary.data.items.length,operation==="update_cart_item"?1:0);
      if(operation==="update_cart_item")assert.equal(summary.data.items[0]!.quantity,2);
      assert.equal(result.blocks.some(block=>block.type==="cart_add_result"),false);
      assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
    });

test("update quantity zero uses the existing removal semantics without a generated confirmation",async()=>{
  const f=fixture("update_cart_item",{args:{quantity:0},output:cart([])}),result=await f.run();
  assert.equal(result.message,success);assert.equal(f.counts().writes,1);assert.equal(f.requests.length,2);
  assert.ok(result.blocks.some(block=>block.type==="cart_summary"&&block.data.items.length===0));
});
test("canonical selection IDs and slot are checked before confirming an option-bearing update",async()=>{
  const selected={...item(),optionItemIds:["large"],serviceSlotId:"slot-current"};
  const f=fixture("update_cart_item",{args:{optionItemIds:["large"],serviceSlotId:"slot-current"},output:cart([selected]),
    message:"Altere a quantidade no carrinho para 2 [variantId:target] [optionItemIds:large] [serviceSlotId:slot-current]"});
  const result=await f.run();assert.equal(result.message,success);assert.equal(f.requests.length,2);assert.equal(f.counts().writes,1);
  assert.ok(result.blocks.some(block=>block.type==="cart_summary"&&block.data.items[0]?.optionItemIds?.[0]==="large"));
});
test("exact option-bearing update can coexist with another selection of the same variant",async()=>{
  const output=cart([{...item(),optionItemIds:["large"]},{...item("target",1),optionItemIds:["small"]}]);
  const f=fixture("update_cart_item",{args:{optionItemIds:["large"]},output,
    message:"Altere a quantidade no carrinho para 2 [variantId:target] [optionItemIds:large]"}),result=await f.run();
  assert.equal(result.message,success);assert.equal(f.requests.length,2);assert.equal(f.counts().writes,1);
  const summary=result.blocks.find(block=>block.type==="cart_summary");assert.ok(summary);assert.equal(summary.data.items.length,2);
  assert.equal(summary.data.items.find(line=>line.optionItemIds?.includes("large"))?.quantity,2);
  assert.equal(summary.data.items.find(line=>line.optionItemIds?.includes("small"))?.quantity,1);
});
test("exact option-bearing removal may retain a different selection of the same variant",async()=>{
  const f=fixture("remove_cart_item",{args:{optionItemIds:["large"]},output:cart([{...item("target",1),optionItemIds:["small"]}]),
    message:"Remova do carrinho [variantId:target] [optionItemIds:large]"}),result=await f.run();
  assert.equal(result.message,success);assert.equal(f.requests.length,2);assert.equal(f.counts().writes,1);
  assert.ok(result.blocks.some(block=>block.type==="cart_summary"&&block.data.items.length===1&&block.data.items[0]?.optionItemIds?.[0]==="small"));
});

for(const operation of ["update_cart_item","remove_cart_item"] as const)test(`${operation} unknown commit stays unknown with one attempt and no provider continuation`,async()=>{
  const f=fixture(operation,{throws:true}),result=await f.run();
  assert.equal(result.message,unknown);assert.deepEqual(f.tokens,[unknown]);assert.equal(f.requests.length,2);
  assert.deepEqual(f.counts(),{attempts:1,writes:1,mainCalls:1,reviewCalls:0,fallbackCalls:0});
  assert.deepEqual(result.blocks,[]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
});

for(const [name,operation,output,args] of [
  ["foreign cart","update_cart_item",{...cart(),cartId:"foreign-cart"},{}],
  ["wrong variant","update_cart_item",cart([item("other")]),{}],
  ["wrong quantity","update_cart_item",cart([item("target",1)]),{}],
  ["duplicate selected variant","update_cart_item",cart([item(),item()]),{}],
  ["wrong options","update_cart_item",cart([{...item(),optionItemIds:["small"]}]),{optionItemIds:["large"]}],
  ["wrong slot","update_cart_item",cart([{...item(),serviceSlotId:"other-slot"}]),{serviceSlotId:"slot-current"}],
  ["target still present","remove_cart_item",cart(),{}],
  ["malformed output","update_cart_item",{cartId,items:[],total:"PRIVATE_MALFORMED"},{}],
] as const)test(`${name} result is not a successful terminal ACK`,async()=>{
  const f=fixture(operation,{output,args}),result=await f.run();
  assert.notEqual(result.message,success);assert.equal(result.message,unknown);assert.equal(f.requests.length,2);
  assert.equal(f.counts().attempts,1);assert.equal(f.counts().writes,1);assert.equal(f.counts().reviewCalls,0);assert.equal(f.counts().fallbackCalls,0);
  assert.deepEqual(result.blocks,[]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
});
for(const [name,args]of [["foreign argument cart",{cartId:"foreign-cart"}],["invalid quantity",{quantity:-1}],["foreign bound variant",{variantId:"foreign"}]]as const)
  test(`${name} refuses before handler write and cannot fabricate confirmation`,async()=>{
    const f=fixture("update_cart_item",{args}),result=await f.run();
    assert.equal(result.message,rejected);assert.equal(f.counts().writes,0);assert.equal(f.counts().attempts,0);
    assert.equal(f.requests.length,2);assert.equal(f.counts().reviewCalls,0);assert.equal(f.counts().fallbackCalls,0);assert.deepEqual(result.blocks,[]);
  });
for(const [name,tag,args,output]of [
  ["option","[optionItemIds:large]",{optionItemIds:["small"]},cart([{...item(),optionItemIds:["small"]}])],
  ["slot","[serviceSlotId:slot-current]",{serviceSlotId:"other-slot"},cart([{...item(),serviceSlotId:"other-slot"}])],
]as const)test(`explicit ${name} selector cannot be replaced by model arguments even when its output matches`,async()=>{
  const f=fixture("update_cart_item",{args,output,message:`Altere a quantidade no carrinho para 2 [variantId:target] ${tag}`});
  const result=await f.run();assert.equal(result.message,rejected);
  assert.deepEqual(f.counts(),{attempts:0,writes:0,mainCalls:1,reviewCalls:0,fallbackCalls:0});
  assert.equal(f.requests.length,2);assert.deepEqual(result.blocks,[]);assert.deepEqual(f.seenArgs,[]);
});
test("generated no-mutation reply retains the independent output review",async()=>{
  const f=fixture("update_cart_item",{generatedOnly:true,message:"Qual a política da loja?"}),result=await f.run();
  assert.equal(result.message,"Posso ajudar com os produtos desta loja.");assert.equal(f.requests.length,3);
  assert.deepEqual(f.counts(),{attempts:0,writes:0,mainCalls:1,reviewCalls:1,fallbackCalls:0});
  assert.deepEqual(result.blocks,[]);assert.equal(result.safetyValidation.safe,true);
});
