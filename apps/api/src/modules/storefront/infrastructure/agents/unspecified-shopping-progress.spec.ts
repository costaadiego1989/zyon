import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

const usage={promptTokens:10,completionTokens:5,totalTokens:15};
const opening="Que tipo de produto você procura ou qual necessidade quer atender?";
const classifications=[
  {schemaVersion:2,domain:"STORE_COMMERCE",intent:"PRODUCT_SEARCH",confidence:1,requiresTool:true,needsProductDiscovery:false},
  {schemaVersion:2,domain:"STORE_COMMERCE",intent:"COMPLEX_QUESTION",confidence:1,requiresTool:true,needsProductDiscovery:false},
  {schemaVersion:2,domain:"STORE_COMMERCE",intent:"RECOMMEND_PERSONALIZED",confidence:1,requiresTool:true,needsProductDiscovery:true,shoppingPhase:"search"},
  ...(["ADD_CART","COMPARE_PRODUCTS","NEGOTIATE_PRICE","ORDER_STATUS","RETURN_REQUEST"] as const).map(intent=>({schemaVersion:2,domain:"STORE_COMMERCE",intent,confidence:1,requiresTool:true,needsProductDiscovery:false})),
  {schemaVersion:2,domain:"STORE_COMMERCE",intent:"GREETING",confidence:1,requiresTool:false,needsProductDiscovery:false},
] as const;
const variants=["Quero comprar um produto","Quero comprar algo!","Eu gostaria de comprar alguma coisa.","Oi, quero comprar","Preciso de um produto","Me ajude a escolher um produto"];
for(const classification of classifications)for(const userMessage of variants)
test(`an unspecified buyer request clarifies before facts or writes: ${classification.intent}/${userMessage}`,async()=>{
 let main=0,reads=0,writes=0;
 const history=[{role:"user" as const,content:"Ver carrinho"},{role:"assistant" as const,content:"Seu carrinho contém itens. Total R$ 798,51."}];
 const before=structuredClone(history);
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async request=>{
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.intent")return {content:JSON.stringify(classification),usage};
  main++;return {content:JSON.stringify({schemaVersion:1,message:"Vou procurar para você."}),usage};
 }},toolHandlers:{searchProducts:async()=>{reads++;throw Error("no concrete need yet");},listCategories:async()=>{reads++;throw Error("not requested yet");},addItemToCart:async()=>{writes++;throw Error("no selected product");},createCheckoutSession:async()=>{writes++;throw Error("no checkout consent");}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",cartId:"same",userMessage,history});
 assert.equal(result.discoveryQuestion?.question,opening);assert.equal(result.message,opening);
 assert.equal(result.safetyValidation.safe,true);assert.equal(main,0);assert.equal(reads,0);assert.equal(writes,0);
 assert.deepEqual(result.toolsUsed,[]);assert.deepEqual(history,before);
});

for(const userMessage of ["Não sei","Ainda não sei","Não sei escolher","Pode me ajudar a escolher?","Quero comprar um produto"])
test(`a buyer who cannot name a product sees actual scoped categories instead of the same question: ${userMessage}`,async()=>{
 let reads=0,main=0,writes=0;
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async request=>{
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.intent")return {content:JSON.stringify(classifications[1]),usage};
  main++;return {content:JSON.stringify({schemaVersion:1,message:"Você já sabe o que procura?"}),usage};
 }},toolHandlers:{listCategories:async()=>{reads++;return {categories:[{id:"owned-care",name:"Cuidados pessoais",productCount:2}]};},addItemToCart:async()=>{writes++;throw Error("no consent");}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage,history:[{role:"user",content:"Quero comprar um produto"},{role:"assistant",content:opening}]});
 assert.equal(reads,1);assert.equal(main,0);assert.equal(writes,0);assert.deepEqual(result.toolsUsed,["list_categories"]);
 assert(result.blocks.some(b=>b.type==="category_carousel"&&JSON.stringify(b.data).includes("owned-care")));
 assert.doesNotMatch(result.message,/já sabe|confirmar essa consulta|condição comercial/);
});

for(const mode of ["empty","failure","invalid"] as const)test(`optional category ${mode} gives a useful next step and never claims stock absence`,async()=>{
 let reads=0;
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async()=>({content:JSON.stringify(classifications[1]),usage})},toolHandlers:{listCategories:async()=>{reads++;if(mode==="failure")throw Error("unavailable");return mode==="empty"?{categories:[]}:{categories:[{name:"invalid without canonical ID"}]};}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage:"Não sei",history:[{role:"user",content:"Quero comprar um produto"},{role:"assistant",content:opening}]});
 assert.equal(reads,1);assert.match(result.message,/ver produtos|catálogo/);assert.doesNotMatch(result.message,/não tem produtos|sem estoque|condição comercial/);
 assert.deepEqual(result.blocks,[]);assert.equal(result.routing.needsProductDiscovery,false);
});

for(const userMessage of ["Não quero comprar agora","Quero ver meu pedido","Adicione o produto ao carrinho","Quanto custa esse sérum?","Quero algo até R$100","Quero um hidratante sem perfume"])
test(`an opening in history cannot replace a specific request or refusal: ${userMessage}`,async()=>{
 let categoryReads=0;
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async request=>{
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.intent")return {content:JSON.stringify({...classifications[1],requiresTool:false}),usage};
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.reply-review")return {content:JSON.stringify({schemaVersion:1,verdict:"ALLOW",confidence:1}),usage};
  return {content:JSON.stringify({schemaVersion:1,message:"Posso ajudar com a etapa solicitada da loja."}),usage};
 }},toolHandlers:{listCategories:async()=>{categoryReads++;return {categories:[]};}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage,history:[{role:"user",content:"Quero comprar um produto"},{role:"assistant",content:opening}]});
 assert.equal(categoryReads,0);assert.notEqual(result.discoveryQuestion?.question,opening);
});

test("a short body-area answer advances the existing care interview rather than restarting generic discovery",async()=>{
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async()=>({content:JSON.stringify({...classifications[1],requiresTool:false}),usage})},toolHandlers:{} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage:"Para minha pele",history:[{role:"user",content:"Quero comprar um produto"},{role:"assistant",content:opening}]});
 assert.equal(result.discoveryQuestion?.question,"Como você descreveria sua pele?");assert.deepEqual(result.toolsUsed,[]);
});

test("a second unknown answer keeps real categories available without restarting the product question",async()=>{
 let reads=0;
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async()=>({content:JSON.stringify(classifications[1]),usage})},toolHandlers:{listCategories:async()=>{reads++;return {categories:[{id:"owned",name:"Categoria real",productCount:1}]};}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage:"Não sei",history:[{role:"user",content:"Quero comprar um produto"},{role:"assistant",content:opening},{role:"user",content:"Não sei"},{role:"assistant",content:"Podemos começar pelas categorias da loja. Qual delas você gostaria de explorar?"}]});
 assert.equal(reads,1);assert.equal(result.discoveryQuestion,undefined);assert.doesNotMatch(result.message,/\?/);assert.match(result.message,/categoria no menu/);
 assert(result.blocks.some(b=>b.type==="category_carousel"));
});

test("a storefront payload containing its current user message twice still reads categories exactly once",async()=>{
 let reads=0;
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async()=>({content:JSON.stringify(classifications[1]),usage})},toolHandlers:{listCategories:async()=>{reads++;return {categories:[{id:"owned",name:"Categoria real",productCount:1}]};}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage:"Não sei",history:[{role:"user",content:"Quero comprar um produto"},{role:"assistant",content:opening},{role:"user",content:"Não sei"}]});
 assert.equal(reads,1);assert.deepEqual(result.toolsUsed,["list_categories"]);
});

for(const domain of ["STORE_SUPPORT","UNCLEAR","OUT_OF_SCOPE"] as const)test(`a valid ${domain} classification cannot open the new commerce recovery`,async()=>{
 let reads=0;
 const classification={...classifications[1],domain,requiresTool:false,confidence:1};
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async request=>{
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.intent")return {content:JSON.stringify(classification),usage};
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.reply-review")return {content:JSON.stringify({schemaVersion:1,verdict:"ALLOW",confidence:1}),usage};
  return {content:JSON.stringify({schemaVersion:1,message:"Posso ajudar com a etapa solicitada."}),usage};
 }},toolHandlers:{listCategories:async()=>{reads++;return {categories:[]};}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage:"Quero comprar um produto",history:[]});
 assert.notEqual(result.discoveryQuestion?.question,opening);assert.equal(reads,0);
});

test("an attachment cannot enter the server-owned object-free discovery recovery",async()=>{
 let categoryReads=0;
 const agent=new StorefrontLangGraphAgent({structuredRouting:true,provider:{chat:async request=>{
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.intent")return {content:JSON.stringify({...classifications[1],requiresTool:false}),usage};
  if(JSON.parse(request.messages[0]!.content!).id==="storefront.reply-review")return {content:JSON.stringify({schemaVersion:1,verdict:"ALLOW",confidence:1}),usage};
  return {content:JSON.stringify({schemaVersion:1,message:"Vou considerar a referência enviada."}),usage};
 }},toolHandlers:{listCategories:async()=>{categoryReads++;return {categories:[]};}} as never});
 const result=await agent.run({merchantId:"owned",sessionId:"same",userMessage:"Quero comprar um produto",attachmentContext:"Reference only",history:[]});
 assert.notEqual(result.discoveryQuestion?.question,opening);assert.equal(categoryReads,0);
});
