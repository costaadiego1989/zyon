import test from "node:test";
import assert from "node:assert/strict";
import { OpenRouterProvider } from "@zyon/conversation-engine";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

/** Opt-in, metered provider evaluation. All products/tools are isolated fixtures:
 * no production database, buyer, cart, checkout or payment is accessed. */
test("provider-backed consultative sales scenarios", { skip: process.env.ZYON_SALES_LIVE !== "1", timeout: 240_000 }, async t => {
  assert.ok(process.env.LOCAL_LLM_API_KEY, "Configure the provider key in the process environment, never in this file.");
  const provider = new OpenRouterProvider({ apiKey: process.env.LOCAL_LLM_API_KEY,
    baseUrl: process.env.LOCAL_LLM_BASE_URL, model: process.env.LOCAL_LLM_MODEL });
  const products = [
    { id: "qa_light", name: "Hidratante Leve QA", description: "Hidratante facial para pele oleosa, textura leve, sem perfume.", price: 7900 },
    { id: "qa_gel", name: "Gel Hidratante QA", description: "Hidratante em gel para pele oleosa, sem perfume, toque seco.", price: 9900 },
  ].map(product => ({ ...product, inStock: true, images: [], variants: [{ id: `${product.id}_30ml`, sku: product.id,
    attributes: { Volume: "30 ml" }, basePriceInCents: product.price, stockQuantity: 10, stockReserved: 0 }] }));
  // Optional case filter avoids paying to rerun unchanged provider scenarios.
  const scenario = (name: string, fn: () => Promise<void>) => t.test(name,
    { skip: !!process.env.ZYON_SALES_LIVE_CASE && !name.includes(process.env.ZYON_SALES_LIVE_CASE) }, fn);

  async function run(userMessage: string, history: Array<{ role: "user" | "assistant"; content: string }> = [], catalog = products) {
    const searches: Array<Record<string, any>> = [];
    const agent = new StorefrontLangGraphAgent({ provider, model: provider.model, fastModel: provider.model, strongModel: provider.model,
      toolHandlers: {
        searchProducts: async (args: Record<string, any>) => {
          searches.push(args);
          return { products: catalog.filter(product => !args.maxPrice || product.price <= args.maxPrice).slice(0, args.limit ?? 10) };
        },
        getProductDetails: async ({ productId }: { productId: string }) => ({ product: catalog.find(product => product.id === productId) }),
        addItemToCart: async () => assert.fail("A consultation must never mutate a cart"),
        createCheckoutSession: async () => assert.fail("A consultation must never start checkout"),
        applyCoupon: async () => assert.fail("A consultation must never authorize a discount"),
      } as never,
    });
    // Deliberately mismatched segment to catch the production electronics/skincare regression.
    const result = await agent.run({ merchantId: "qa_fixture", sessionId: "qa_fixture", storeCategory: "electronics", history, userMessage });
    assert.equal(result.safetyValidation.safe, true);
    assert.doesNotMatch(result.message, /s[oó] (?:com |vendemos |trabalhamos com )?eletr[oô]nicos|desconto de|frete gr[aá]tis/i);
    assert.doesNotMatch(result.message, /costuma|clientes adoram|frasco maior|mais vendido|bisnaga|absor[çc][aã]o r[aá]pida/i);
    assert.ok(result.message.length > 10 && result.message.length < 1400);
    t.diagnostic(JSON.stringify({ userMessage, message: result.message, searches, tools: result.toolsUsed, tokens: result.usage.totalTokens }));
    return { result, searches };
  }

  await scenario("unspecified intent asks one discovery question without catalog or writes", async () => {
    const { result, searches } = await run("quero comprar um produto");
    assert.deepEqual(searches, []);
    assert.ok(result.toolsUsed.every(tool => tool === "ask_product_preferences"));
    assert.ok(result.discoveryQuestion);
    assert.deepEqual(result.blocks, []);
    assert.equal(result.message.match(/\?/g)?.length, 1);
    assert.doesNotMatch(result.message, /or[çc]amento|faixa de valor/i);
  });
  await scenario("a broad skin request explores the profile and goal before recommending, with matching answer choices", async () => {
    const history:Array<{role:"user"|"assistant";content:string}>=[];
    const append=(userMessage:string,message:string)=>history.push({role:"user",content:userMessage},{role:"assistant",content:message});
    const first=await run("Quero um produto para pele",history);
    assert.equal(first.searches.length,0);
    assert.deepEqual(first.result.blocks,[]);
    assert.ok(first.result.discoveryQuestion);
    assert.match(first.result.message,/pele|tipo|cuidado|objetivo/i);
    assert.ok(first.result.discoveryQuestion.replies.length>0);
    assert.doesNotMatch(first.result.discoveryQuestion.replies.join(" "),/carrinho|finalizar|continuar comprando|semelhantes/i);
    append("Quero um produto para pele",first.result.message);
    const second=await run("Minha pele é oleosa",history);
    assert.equal(second.searches.length,0,"skin type alone is not a purpose");
    assert.ok(second.result.discoveryQuestion);
    assert.match(second.result.message,/objetivo|busca|procur|necessidade|prioridade|cuidado|hidrata|limpeza/i);
    append("Minha pele é oleosa",second.result.message);
    const informed=await run("Quero hidratação, textura leve e sem perfume, até R$ 100",history);
    assert.ok(informed.searches.length>0,"do not force a third question when enough is known");
    assert.ok(informed.searches.every(search=>search.limit<=3 && search.maxPrice===10000));
    assert.match(JSON.stringify(informed.searches),/oleosa/i);
    assert.match(JSON.stringify(informed.searches),/sem perfume/i);
    assert.ok(informed.result.blocks.some(block=>block.type==="product_carousel"));
    assert.equal(informed.result.discoveryQuestion,undefined);
  });
  await scenario("after three discovery questions the next turn searches instead of asking for more profile data",async()=>{
    const {result,searches}=await run("Sem perfume, até R$ 80",[
      {role:"user",content:"Quero um produto para pele"},{role:"assistant",content:"Como é sua pele?"},
      {role:"user",content:"Oleosa"},{role:"assistant",content:"Qual seu objetivo?"},
      {role:"user",content:"Hidratação"},{role:"assistant",content:"Tem preferência de fragrância ou orçamento?"},
    ]);
    assert.ok(searches.length>0);
    assert.ok(searches.every(search=>search.maxPrice===8000 && search.limit<=3));
    assert.equal(result.discoveryQuestion,undefined);
    assert.ok(result.blocks.some(block=>block.type==="product_carousel"));
  });
  await scenario("a sufficiently specific need receives grounded options without a redundant interview", async () => {
    const { result, searches } = await run("Quero um hidratante para pele oleosa, sem perfume");
    assert.ok(searches.length > 0);
    assert.ok(searches.every(search => search.query !== "*" && search.limit <= 3));
    assert.match(JSON.stringify(searches), /oleosa/i);
    assert.match(result.message, /leve|perfume|gel|toque seco/i);
    assert.ok(result.blocks.some(block => block.type === "product_carousel" || block.type === "product_card"));
  });
  await scenario("a short answer keeps the previously disclosed need, restriction and budget", async () => {
    const { result, searches } = await run("Hidratação", [
      { role: "user", content: "Quero um produto para pele oleosa, sem perfume, até R$ 80" },
      { role: "assistant", content: "Você procura limpeza ou hidratação?" },
    ]);
    assert.ok(searches.length > 0);
    assert.ok(searches.every(search => search.maxPrice === 8000 && search.limit <= 3));
    assert.match(JSON.stringify(searches), /oleosa/i);
    assert.match(JSON.stringify(searches), /sem perfume/i);
    assert.ok(result.blocks.some(block => block.type === "product_carousel" || block.type === "product_card"));
  });
  await scenario("price objection asks for a budget without inventing concessions", async () => {
    const { result } = await run("Está caro", [
      { role: "user", content: "Quero um hidratante para pele oleosa" },
      { role: "assistant", content: "O Hidratante Leve QA tem textura leve e custa R$ 79,00." },
    ]);
    assert.match(result.message, /faixa|or[çc]amento|valor|gastar|investir|pre[çc]o/i);
    assert.equal(result.message.match(/\?/g)?.length, 1);
    assert.equal(result.toolsUsed.some(tool => ["add_item_to_cart", "create_checkout_session", "apply_coupon"].includes(tool)), false);
  });
  await scenario("a price objection after two profile questions and a recommendation starts a fresh budget clarification", async () => {
    const { result, searches } = await run("Está caro", [
      { role: "user", content: "Quero comprar um produto" }, { role: "assistant", content: "Qual produto procura?" },
      { role: "user", content: "Quero hidratação com textura leve" }, { role: "assistant", content: "Para o rosto ou corpo?" },
      { role: "user", content: "Rosto, até R$ 150" },
      { role: "assistant", content: "Encontrei três opções. A Bruma tem hidratação leve, por R$ 79,90. Quer ver os detalhes dela?" },
    ]);
    assert.deepEqual(searches, []);
    assert.deepEqual(result.blocks, []);
    assert.ok(result.discoveryQuestion);
    assert.match(result.message, /faixa|orçamento|valor|gastar|investir|preço/i);
  });
  await scenario("empty matches broaden through bounded searches without dropping the buyer's restrictions",async()=>{
    const {result,searches}=await run("Quero hidratante para pele oleosa, sem perfume, até R$ 80",[],[]);
    assert.ok(searches.length>0 && searches.length<=3);
    assert.ok(searches.every(search=>search.query!=="*" && search.maxPrice===8000 && search.limit<=3));
    assert.ok(searches.every(search=>/sem (?:perfume|fragr[aâ]ncia)/i.test(search.query)));
    assert.ok(searches.every(search=>/pele oleosa/i.test(search.query)));
    assert.equal(result.blocks.some(block=>block.type==="product_carousel" || block.type==="product_card"),false);
    assert.match(result.message,/n[aã]o encontrei|sem (?:op[çc][oõ]es|resultados)|n[aã]o (?:tenho|temos|h[aá])|nenhum/i);
  });
});
