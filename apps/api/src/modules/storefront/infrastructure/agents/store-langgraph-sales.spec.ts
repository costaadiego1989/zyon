import test from "node:test";
import assert from "node:assert/strict";
import type { OpenRouterChatRequest, OpenRouterProvider } from "@zyon/conversation-engine";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { storefrontQuickReplies } from "../../domain/services/storefront-quick-replies.service.js";
import { ensureProductDiscovery } from "./product-discovery-fallback.js";

const usage = { promptTokens: 20, completionTokens: 10, totalTokens: 30 };

test("vague purchase instructions survive primary and fallback routing without losing the shared sales policy", async () => {
  for (const failover of [false, true]) {
    const requests: OpenRouterChatRequest[] = [];
    const respond = async (request: OpenRouterChatRequest) => {
      requests.push(request);
      return { content: "Claro! Você já tem algo em mente ou quer ajuda para escolher?", toolCalls: [], usage };
    };
    const agent = new StorefrontLangGraphAgent({
      provider: { chat: failover ? async () => { throw Error("primary_unavailable"); } : respond } as unknown as OpenRouterProvider,
      fallbackProvider: { chat: respond } as unknown as OpenRouterProvider,
      toolHandlers: {} as never,
    });
    const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "electronics", history: [], userMessage: "quero comprar um produto" });
    assert.equal(requests.length, 1);
    const prompt = requests[0]!.messages[0]!.content;
    assert.match(prompt, /TURNO DE DESCOBERTA/);
    assert.match(prompt, /Não chame ferramentas para listar produtos, adicionar ao carrinho ou iniciar checkout/);
    assert.match(prompt, /vendedor consultivo profissional/);
    assert.match(prompt, /produtos retornados pelas ferramentas prevalecem/);
    assert.deepEqual(result.toolsUsed, []);
    assert.deepEqual(result.blocks, []);
    assert.equal(result.safetyValidation.safe, true);
  }
});

test("a disobedient provider cannot turn an object-free purchase into an arbitrary cart write", async () => {
  let writes = 0;
  const agent = new StorefrontLangGraphAgent({
    provider: { chat: async () => ({ content: "", toolCalls: [{ id: "wrong_add", name: "add_item_to_cart", args: { cartId: "qa", variantId: "arbitrary", quantity: 1 } }], usage }) } as unknown as OpenRouterProvider,
    toolHandlers: { addItemToCart: async () => { writes++; return { cartId: "qa", items: [{ variantId: "arbitrary", quantity: 1 }] }; } } as never,
  });
  const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", history: [], userMessage: "Quero comprar algo" });
  assert.equal(writes, 0);
  assert.equal(result.blocks.some(block => ["checkout_redirect", "checkout_prepared", "cart_summary"].includes(block.type)), false);
  assert.doesNotMatch(result.message, /adicionado ao carrinho!/);
});

test("specific follow-ups keep the need and budget history without receiving the vague-turn restriction", async () => {
  let seen: OpenRouterChatRequest | undefined;
  const agent = new StorefrontLangGraphAgent({ provider: { chat: async (request: OpenRouterChatRequest) => {
    seen = request;
    return { content: "Vou considerar a hidratação e suas preferências na seleção.", toolCalls: [], usage };
  } } as unknown as OpenRouterProvider, toolHandlers: {} as never });
  await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", userMessage: "Hidratação", history: [
    { role: "user", content: "Quero algo para pele oleosa, sem perfume, até R$ 80" },
    { role: "assistant", content: "Você procura limpeza ou hidratação?" },
    { role: "user", content: "Hidratação" }, // Real storefront payload includes the current message.
  ] });
  assert.ok(seen);
  assert.equal(seen.messages.at(-1)!.content, "Hidratação");
  assert.equal(seen.messages.filter(message=>message.role==="user" && message.content==="Hidratação").length,1);
  assert.match(seen.messages[1]!.content, /pele oleosa, sem perfume, até R\$ 80/);
  assert.doesNotMatch(seen.messages[0]!.content, /TURNO DE DESCOBERTA/);
});

test("product-result guidance reaches primary and fallback replies without an additional provider call", async () => {
  for (const failover of [false, true]) {
    let calls = 0;
    const respond = async (request: OpenRouterChatRequest) => {
      calls++;
      assert.equal(request.temperature, 0.2);
      if (calls === 1) return { content: "", toolCalls: [{ id: "search", name: "search_products", args: { query: "hidratante sem perfume", limit: 3 } }], usage };
      assert.match(request.messages.at(-1)!.content, /RESPOSTA APÓS CONSULTAR PRODUTOS/);
      assert.match(request.messages.at(-1)!.content, /Não complete com conhecimento genérico/);
      assert.match(request.messages.at(-1)!.content, /Volume não informa embalagem/);
      return { content: "Esta opção tem textura leve e não contém perfume. Quer ver os detalhes?", toolCalls: [], usage };
    };
    const agent = new StorefrontLangGraphAgent({ provider: { chat: failover ? async () => { throw Error("primary_unavailable"); } : respond } as unknown as OpenRouterProvider,
      fallbackProvider: { chat: respond } as unknown as OpenRouterProvider,
      toolHandlers: { searchProducts: async () => ({ products: [{ id: "qa", name: "Hidratante QA", price: 7900, inStock: true, variants: [], images: [], description: "Textura leve, sem perfume" }] }) } as never,
    });
    const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", history: [], userMessage: "Quero um hidratante sem perfume" });
    assert.equal(calls, 2, "one lookup call and one reply, not an extra evaluation model");
    assert.deepEqual(result.toolsUsed, ["search_products"]);
    assert.equal(result.safetyValidation.safe, true);
  }
});

test("three useful discovery rounds carry coherent answer choices and then search without a fourth interview", async () => {
  for (const failover of [false,true]) {
    const history:Array<{role:"user"|"assistant";content:string}>=[];
    const questions=[
      {question:"Como você descreveria sua pele?",replies:["Oleosa","Seca","Mista","Não sei"]},
      {question:"Qual seu principal objetivo?",replies:["Limpeza","Hidratação","Controle da oleosidade"]},
      {question:"Você prefere um cuidado com ou sem perfume?",replies:["Sem perfume","Com perfume","Sem preferência"]},
    ];
    let calls=0;
    let searches=0;
    const respond=async(request:OpenRouterChatRequest)=>{
      calls++;
      const names=request.tools?.map(tool=>tool.function.name)??[];
      const round=history.filter(item=>item.role==="assistant").length;
      if(round<3){
        assert.ok(names.includes("ask_product_preferences"));
        if(round===0) assert.deepEqual(names,["ask_product_preferences"],"broad need must not dump a catalog");
        assert.match(request.messages[0]!.content,new RegExp(`${round} de 3 rodadas`));
        return {content:"",toolCalls:[{id:`question_${round}`,name:"ask_product_preferences",args:questions[round]}],usage};
      }
      assert.equal(names.includes("ask_product_preferences"),false,"fourth interview tool is unavailable");
      assert.match(request.messages[0]!.content,/LIMITE DA DESCOBERTA ATINGIDO/);
      if(!searches) return {content:"",toolCalls:[{id:"search",name:"search_products",args:{query:"hidratação pele oleosa sem perfume",limit:3}}],usage};
      return {content:"Esta opção tem textura leve e é sem perfume.",toolCalls:[],usage};
    };
    const handlers:any={searchProducts:async(args:any)=>{searches++;assert.match(args.query,/oleosa.*sem perfume/);return {products:[{id:"qa",name:"Hidratante QA",price:7900,inStock:true,variants:[],images:[]}]};},
      addItemToCart:async()=>assert.fail("consultation cannot mutate cart"),createCheckoutSession:async()=>assert.fail("consultation cannot start checkout")};
    const agent=new StorefrontLangGraphAgent({provider:{chat:failover?async()=>{throw Error("primary_unavailable");}:respond} as unknown as OpenRouterProvider,
      fallbackProvider:{chat:respond} as unknown as OpenRouterProvider,toolHandlers:handlers});
    for(const [index,userMessage] of ["Quero um produto para pele","Oleosa","Hidratação","Sem perfume"].entries()){
      const result=await agent.run({merchantId:"qa",sessionId:"qa",storeCategory:"electronics",history:[...history],userMessage});
      if(index<3){
        assert.deepEqual(result.discoveryQuestion,questions[index]);
        assert.deepEqual(result.blocks,[]);
        assert.deepEqual(result.toolsUsed,["ask_product_preferences"]);
        assert.equal(await ensureProductDiscovery(result,{userMessage,merchantId:"qa",handlers,history}),result);
        assert.deepEqual(storefrontQuickReplies("ask_product_preferences",null,{items:[],total:0,itemCount:1},undefined,userMessage,undefined,
          {discoveryQuestion:result.discoveryQuestion,assistantMessage:result.message,hasBlocks:false}),questions[index]!.replies);
        assert.equal(searches,0);
      }else{
        assert.equal(result.discoveryQuestion,undefined);
        assert.ok(result.blocks.some(block=>block.type==="product_carousel"));
      }
      history.push({role:"user",content:userMessage},{role:"assistant",content:result.message});
    }
    assert.equal(calls,5,"one call per clarification, then lookup plus grounded response");
    assert.equal(searches,1);
  }
});

test("direct actions and attachments never expose the discovery tool",async()=>{
  for(const [userMessage,attachmentContext] of [["Ver Produtos",undefined],["Quero comprar este produto",undefined],["Finalizar compra",undefined],
    ["Detalhes desse produto",undefined],["Quero produto para pele","Extracted list"]]){
    const agent=new StorefrontLangGraphAgent({provider:{chat:async(request:OpenRouterChatRequest)=>{
      assert.equal(request.tools?.some(tool=>tool.function.name==="ask_product_preferences"),false,userMessage);
      return {content:"Entendido.",toolCalls:[],usage};
    }} as unknown as OpenRouterProvider,toolHandlers:{} as never});
    await agent.run({merchantId:"qa",sessionId:"qa",storeCategory:"others",history:[],userMessage:userMessage!,attachmentContext});
  }
});

test("a malformed question can be corrected in the next tool call without running commerce tools",async()=>{
  let calls=0;
  const agent=new StorefrontLangGraphAgent({provider:{chat:async()=>({content:"",toolCalls:[{id:`question_${++calls}`,name:"ask_product_preferences",
    args:calls===1?{question:"Qual a pele? E o objetivo?",replies:[]}:{question:"Qual seu objetivo?",replies:["Hidratação","Ver Carrinho"]}}],usage})} as unknown as OpenRouterProvider,toolHandlers:{} as never});
  const result=await agent.run({merchantId:"qa",sessionId:"qa",storeCategory:"others",history:[],userMessage:"Quero produto para pele"});
  assert.equal(calls,2);
  assert.deepEqual(result.discoveryQuestion,{question:"Qual seu objetivo?",replies:["Hidratação"]});
  assert.deepEqual(result.blocks,[]);
});

test("empty recommendation search budgets and buyer constraints survive primary-to-fallback routing",async()=>{
  for(const failover of [false,true]){
    let primaryCalls=0;
    let fallbackCalls=0;
    const searches:any[]=[];
    const respond=(id:string)=>({content:"",toolCalls:[{id,name:"search_products",args:{query:"hidratante",limit:20,maxPrice:50000}}],usage});
    const agent=new StorefrontLangGraphAgent({provider:{chat:async()=>{
      primaryCalls++;
      if(failover && primaryCalls===3) throw Error("primary_unavailable");
      return respond(`primary_${primaryCalls}`);
    }} as unknown as OpenRouterProvider,fallbackProvider:{chat:async()=>respond(`fallback_${++fallbackCalls}`)} as unknown as OpenRouterProvider,
      toolHandlers:{searchProducts:async(args:any)=>{searches.push(args);return {products:[]};}} as never});
    const result=await agent.run({merchantId:"qa",sessionId:"qa",storeCategory:"others",history:[],userMessage:"Quero um hidratante para pele oleosa sem perfume, até R$ 80"});
    assert.equal(searches.length,3);
    assert.ok(searches.every(search=>search.limit===3 && search.maxPrice===8000 && /sem perfume/.test(search.query) && /pele oleosa/.test(search.query)));
    assert.equal(primaryCalls,3);
    assert.equal(fallbackCalls,failover?1:0);
    assert.deepEqual(result.blocks,[]);
    assert.match(result.message,/Não encontrei uma correspondência confirmada/);
    assert.equal(result.discoveryQuestion,undefined);
  }
});

test("exhausted provider loops with confirmed matches introduce the results instead of restarting the greeting", async () => {
  for (const failover of [false, true]) {
    let searches = 0;
    const respond = async () => ({ content: "", toolCalls: [{ id: `lookup_${searches}`, name: "search_products", args: { query: "hidratante leve", limit: 3 } }], usage });
    const agent = new StorefrontLangGraphAgent({
      provider: { chat: failover ? async () => { throw Error("primary_unavailable"); } : respond } as unknown as OpenRouterProvider,
      fallbackProvider: { chat: respond } as unknown as OpenRouterProvider,
      toolHandlers: { searchProducts: async () => { searches++; return { products: [{ id: "qa", name: "Hidratante QA", price: 7900, inStock: true, variants: [], images: [], description: "Textura leve" }] }; } } as never,
    });
    const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", history: [], userMessage: "Quero um hidratante leve" });
    assert.equal(searches, 3);
    assert.ok(result.blocks.some(block => block.type === "product_carousel"));
    assert.match(result.message, /opções no catálogo/);
    assert.doesNotMatch(result.message, /Como posso ajudá|não encontrei/i);
    assert.equal(result.safetyValidation.safe, true);
  }
});

test("a bare price objection cannot search and repeat the same cards before clarifying the new budget", async () => {
  for (const failover of [false, true]) {
    let searches = 0;
    const respond = async (request: OpenRouterChatRequest) => {
      assert.deepEqual(request.tools?.map(tool => tool.function.name), ["ask_product_preferences"]);
      assert.match(request.messages[0]!.content, /faixa de valor confortável/);
      return { content: "", toolCalls: [{ id: "ignored_search", name: "search_products", args: { query: "hidratante" } }], usage };
    };
    const agent = new StorefrontLangGraphAgent({
      provider: { chat: failover ? async () => { throw Error("primary_unavailable"); } : respond } as unknown as OpenRouterProvider,
      fallbackProvider: { chat: respond } as unknown as OpenRouterProvider,
      toolHandlers: { searchProducts: async () => { searches++; return { products: [] }; } } as never,
    });
    const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", userMessage: "Está caro", history: [
      { role: "user", content: "Quero hidratação com textura leve, até R$ 150" },
      { role: "assistant", content: "Encontrei estas opções no catálogo. Confira os detalhes para escolher." },
    ] });
    assert.equal(searches, 0);
    assert.deepEqual(result.blocks, []);
    assert.match(result.message, /faixa de valor/);
    assert.ok(result.discoveryQuestion);
  }
});

test("a price objection during shipping does not become a product-discovery interview", async () => {
  const agent = new StorefrontLangGraphAgent({ provider: { chat: async (request: OpenRouterChatRequest) => {
    assert.ok(request.tools?.some(tool => tool.function.name === "quote_shipping"));
    assert.doesNotMatch(request.messages[0]!.content, /O comprador achou caro, mas não informou/);
    return { content: "Podemos conferir as opções de frete disponíveis.", toolCalls: [], usage };
  } } as unknown as OpenRouterProvider, toolHandlers: {} as never });
  await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", userMessage: "Está caro", history: [
    { role: "user", content: "Calcular frete" }, { role: "assistant", content: "O frete custa R$ 24,90." },
  ] });
});
