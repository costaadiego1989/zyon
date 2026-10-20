import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontConversationAdapter } from "./storefront-conversation.adapter.js";

function adapterFixture(cartRepo: unknown = {}, productRepo: unknown = {}) {
  // Constructor wiring requires a key, but this projection test never calls a
  // provider: run() is replaced below. Restore the process environment at once.
  const previous = process.env.LOCAL_LLM_API_KEY;
  process.env.LOCAL_LLM_API_KEY = "qa-unused-provider-credential";
  try {
    return new StorefrontConversationAdapter({} as never,productRepo as never,{} as never,cartRepo as never,{} as never,{} as never);
  } finally {
    if (previous === undefined) delete process.env.LOCAL_LLM_API_KEY;
    else process.env.LOCAL_LLM_API_KEY = previous;
  }
}

test("the storefront adapter projects discovery choices, even with a populated cart and custom action defaults",async()=>{
  const adapter=adapterFixture({getOrCreate:async()=>({items:[{variantId:"old",name:"Anterior",quantity:1}],total:100})});
  const discoveryQuestion={question:"Como você descreveria sua pele?",replies:["Oleosa","Seca","Mista","Não sei"]};
  (adapter as any).agent={run:async()=>({message:discoveryQuestion.question,blocks:[],toolsUsed:["ask_product_preferences"],discoveryQuestion,cartId:"cart"})};
  const result=await adapter.reply({merchantId:"qa",sessionId:"session",cartId:"cart",userMessage:"Quero um produto para pele",history:[],
    oneBuyClick:{enabled:true,status:"idle",shippingPreference:"cheapest",paymentPreference:"pix"},
    storeCategory:"electronics",storeSettings:{quick_replies:{stages:[{stage:"welcome",replies:["Ver Carrinho","Finalizar Compra"]}],fallback:["Ofertas"]}}});
  assert.equal(result.message,discoveryQuestion.question);
  assert.deepEqual(result.blocks,[]);
  assert.deepEqual(result.suggestedNext,discoveryQuestion.replies);
  assert.equal(result.cartId,"cart");
});

test("a plain-text open question returns no unrelated configured buttons",async()=>{
  const adapter=adapterFixture();
  (adapter as any).agent={run:async()=>({message:"Qual faixa de valor fica confortável?",blocks:[],toolsUsed:[]})};
  const result=await adapter.reply({merchantId:"qa",sessionId:"session",userMessage:"Está caro",history:[],storeCategory:"others"});
  assert.deepEqual(result.suggestedNext,[]);
  assert.deepEqual(result.blocks,[]);
});

test("browsing buttons after skin alternatives bypass the LLM, fallback search and quick-purchase cart", async () => {
  let searches = 0;
  let providerCalls = 0;
  let cartCalls = 0;
  const adapter = adapterFixture({ getOrCreate: async () => { cartCalls++; assert.fail("navigation cannot touch checkout/cart"); } },
    { search: async () => { searches++; assert.fail("navigation cannot repeat the carousel"); } });
  (adapter as any).agent = { run: async () => { providerCalls++; assert.fail("no paid model call for a browsing prompt"); } };
  const history: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: "Quero um produto para pele" }, { role: "assistant", content: "Como é sua pele?" },
    { role: "user", content: "Oleosa" },
    { role: "assistant", content: "Não encontrei exatamente, mas estas opções relacionadas valem a pena conhecer." },
  ];
  for (const userMessage of ["Selecionar Produto", "Filtrar Produtos", "Selecionar Produto"]) {
    const result = await adapter.reply({ merchantId: "qa", sessionId: "session", cartId: "cart", userMessage,
      history: [...history, { role: "user", content: userMessage }], storeCategory: "electronics",
      oneBuyClick: { enabled: true, status: "idle", shippingPreference: "cheapest", paymentPreference: "pix" },
      storeSettings: { quick_replies: { stages: [{ stage: "browsing", replies: ["Selecionar Produto", "Filtrar Produtos"] }], fallback: ["Finalizar Compra"] } } });
    assert.match(result.message, /qual/i);
    assert.doesNotMatch(result.message, /não encontrei|pele oleosa/i);
    assert.deepEqual(result.blocks, []);
    assert.deepEqual(result.suggestedNext, []);
    history.push({ role: "user", content: userMessage }, { role: "assistant", content: result.message });
  }
  assert.equal(searches, 0);
  assert.equal(providerCalls, 0);
  assert.equal(cartCalls, 0);
});
