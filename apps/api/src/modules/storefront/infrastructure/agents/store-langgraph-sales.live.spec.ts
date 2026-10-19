import test from "node:test";
import assert from "node:assert/strict";
import { OpenRouterProvider } from "@zyon/conversation-engine";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

/** Opt-in, metered provider evaluation. All products/tools are isolated fixtures:
 * no production database, buyer, cart, checkout or payment is accessed. */
test("provider-backed consultative sales scenarios", { skip: process.env.ZYON_SALES_LIVE !== "1", timeout: 180_000 }, async t => {
  assert.ok(process.env.LOCAL_LLM_API_KEY, "Configure the provider key in the process environment, never in this file.");
  const provider = new OpenRouterProvider({ apiKey: process.env.LOCAL_LLM_API_KEY,
    baseUrl: process.env.LOCAL_LLM_BASE_URL, model: process.env.LOCAL_LLM_MODEL });
  const products = [
    { id: "qa_light", name: "Hidratante Leve QA", description: "Hidratante facial para pele oleosa, textura leve, sem perfume.", price: 7900 },
    { id: "qa_gel", name: "Gel Hidratante QA", description: "Hidratante em gel para pele oleosa, sem perfume, toque seco.", price: 9900 },
  ].map(product => ({ ...product, inStock: true, images: [], variants: [{ id: `${product.id}_30ml`, sku: product.id,
    attributes: { Volume: "30 ml" }, basePriceInCents: product.price, stockQuantity: 10, stockReserved: 0 }] }));

  async function run(userMessage: string, history: Array<{ role: "user" | "assistant"; content: string }> = []) {
    const searches: Array<Record<string, any>> = [];
    const agent = new StorefrontLangGraphAgent({ provider, model: provider.model, fastModel: provider.model, strongModel: provider.model,
      toolHandlers: {
        searchProducts: async (args: Record<string, any>) => {
          searches.push(args);
          return { products: products.filter(product => !args.maxPrice || product.price <= args.maxPrice).slice(0, args.limit ?? 10) };
        },
        getProductDetails: async ({ productId }: { productId: string }) => ({ product: products.find(product => product.id === productId) }),
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

  await t.test("unspecified intent asks one discovery question without catalog or writes", async () => {
    const { result, searches } = await run("quero comprar um produto");
    assert.deepEqual(searches, []);
    assert.deepEqual(result.toolsUsed, []);
    assert.deepEqual(result.blocks, []);
    assert.equal(result.message.match(/\?/g)?.length, 1);
    assert.doesNotMatch(result.message, /or[çc]amento|faixa de valor/i);
  });
  await t.test("a sufficiently specific need receives grounded options without a redundant interview", async () => {
    const { result, searches } = await run("Quero um hidratante para pele oleosa, sem perfume");
    assert.ok(searches.length > 0);
    assert.ok(searches.every(search => search.query !== "*" && search.limit <= 3));
    assert.match(JSON.stringify(searches), /oleosa/i);
    assert.match(result.message, /leve|perfume|gel|toque seco/i);
    assert.ok(result.blocks.some(block => block.type === "product_carousel" || block.type === "product_card"));
  });
  await t.test("a short answer keeps the previously disclosed need, restriction and budget", async () => {
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
  await t.test("price objection asks for a budget without inventing concessions", async () => {
    const { result } = await run("Está caro", [
      { role: "user", content: "Quero um hidratante para pele oleosa" },
      { role: "assistant", content: "O Hidratante Leve QA tem textura leve e custa R$ 79,00." },
    ]);
    assert.match(result.message, /faixa|or[çc]amento|valor|gastar|investir|pre[çc]o/i);
    assert.equal(result.message.match(/\?/g)?.length, 1);
    assert.equal(result.toolsUsed.some(tool => ["add_item_to_cart", "create_checkout_session", "apply_coupon"].includes(tool)), false);
  });
});
