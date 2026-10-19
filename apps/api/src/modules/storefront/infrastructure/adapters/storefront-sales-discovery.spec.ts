import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontConversationAdapter } from "./storefront-conversation.adapter.js";

function adapterFixture(cartRepo: unknown = {}) {
  // Constructor wiring requires a key, but this projection test never calls a
  // provider: run() is replaced below. Restore the process environment at once.
  const previous = process.env.LOCAL_LLM_API_KEY;
  process.env.LOCAL_LLM_API_KEY = "qa-unused-provider-credential";
  try {
    return new StorefrontConversationAdapter({} as never,{} as never,{} as never,cartRepo as never,{} as never,{} as never);
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
