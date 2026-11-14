import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { isCatalogBrowsingRequest } from "../../domain/services/sales-discovery.js";
import { shoppingSearchEvidence } from "../../application/services/shopping-search-evidence.js";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const requests = ["quais produtos tem a venda", "Quais produtos vocês vendem?", "quais produtos tem à venda?", "Quero ver os produtos disponíveis", "Mostre o catálogo", "Ver produtos"];
for (const messageFormat of ["whatsapp", "markdown"] as const) for (const userMessage of requests)
test(`whole catalog reads ten scoped products without a three-result recommendation: ${messageFormat}/${userMessage}`, async () => {
  let reads = 0, modelCalls = 0;
  const products = Array.from({ length: 10 }, (_, i) => ({ id: `owned-${i}`, name: `Produto ${i}`, price: 1000 + i, inStock: true, variants: [] }));
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async request => {
    modelCalls++;
    assert.equal(JSON.parse(request.messages[0]!.content!).id, "storefront.intent");
    return { content: JSON.stringify({ schemaVersion: 2, domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", confidence: 1,
      requiresTool: true, needsProductDiscovery: true, shoppingPhase: "search" }), usage };
  } }, toolHandlers: { searchProducts: async args => {
    reads++; assert.deepEqual(args, { query: "*", inStockOnly: true, limit: 10 });
    return { products, query: "*", nextCursor: null };
  }, recommendProducts: async () => assert.fail("catalog is not a recommendation"),
    addItemToCart: async () => assert.fail("browsing never grants a write") } as never });
  const result = await agent.run({ merchantId: "owned", sessionId: "same", userMessage, messageFormat, history: [] });
  assert.equal(reads, 1); assert.equal(modelCalls, 1);
  assert.equal(result.safetyValidation.safe, true); assert.match(result.message, /10 produtos desta lista/);
  assert.doesNotMatch(result.message, /3 opções|nesta página/);
  const catalog = result.blocks.find(b => b.type === "product_carousel");
  assert.equal((catalog?.data as any).products.length, 10);
  assert.deepEqual(result.toolsUsed, ["search_products"]);
});

test("filters, product references, exclusions and commerce mutations never enter whole-catalog browsing", () => {
  for (const text of ["quais produtos tem até 100 reais", "produtos para pele oleosa", "Quais produtos vocês vendem sem perfume?", "Compare os produtos", "Quero comprar esse produto", "Adicione todos os produtos", "Ver produtos com frete grátis", "Ver produtos da categoria áudio"]) assert.equal(isCatalogBrowsingRequest(text), false, text);
});

for (const mode of ["failed", "malformed", "empty", "cursor"] as const)
test(`catalog read distinguishes ${mode} from a confirmed inventory count`, async () => {
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async () => ({ content: JSON.stringify({ schemaVersion: 2,
    domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", confidence: 1, requiresTool: true, needsProductDiscovery: true }), usage }) },
    toolHandlers: { searchProducts: async () => {
      if (mode === "failed") throw Error("offline");
      return mode === "malformed" ? { products: [{ name: "Unverified" }] } : { products: mode === "empty" ? [] : [{ id: "p", name: "Produto", price: 500, inStock: true }], nextCursor: mode === "cursor" ? "next" : null };
    } } as never });
  const result = await agent.run({ merchantId: "owned", sessionId: "same", userMessage: "quais produtos tem a venda", history: [] });
  if (mode === "failed" || mode === "malformed") { assert.equal(result.safetyValidation.safe, false); assert.match(result.message, /Não consegui carregar/); assert.deepEqual(result.blocks, []); }
  else if (mode === "empty") { assert.equal(result.safetyValidation.safe, true); assert.match(result.message, /Não encontrei produtos disponíveis/); }
  else { assert.match(result.message, /próxima página/); assert.equal((result.blocks[0]?.data as any).nextCursor, "next"); }
});

test("specific recommendation copy describes its selection and preserves verified filters", () => {
  const evidence = shoppingSearchEvidence(shoppingSearchPlanSchema.parse({ version: 1, query: "mouse", maxPriceCents: 10000, minRating: 4.5 }), 3);
  assert.match(evidence.message, /3 opções nesta busca/); assert.match(evidence.message, /100,00/); assert.match(evidence.message, /4.5 estrelas/);
  assert.doesNotMatch(evidence.message, /nesta página|no catálogo da loja/);
});

test("shared block projection corrects a model count using the actual ten returned products", () => {
  const result = buildConversationBlocks({ merchantId: "owned", userMessage: "Quais produtos tem a venda", presentationMode: "structured",
    finalContent: "Encontrei 3 opções disponíveis nesta página no catálogo da loja. Preço até R$ 100; compatibilidade ainda não confirmada.",
    toolResults: { search_products: { products: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Produto ${i}`, price: 500, inStock: true })) } } });
  assert.match(result.finalContent, /10 opções nesta busca/); assert.doesNotMatch(result.finalContent, /3 opções|nesta página/);
  assert.match(result.finalContent, /até R\$ 100; compatibilidade ainda não confirmada/);
  assert.equal((result.blocks[0]?.data as any).products.length, 10);
});

test("WhatsApp starts an unspecified purchase with real categories and no cart or model narration", async () => {
  let reads = 0;
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async () => ({ content: JSON.stringify({ schemaVersion: 2,
    domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", confidence: 1, requiresTool: true, needsProductDiscovery: false }), usage }) },
    toolHandlers: { listCategories: async () => { reads++; return { categories: [{ id: "audio", name: "Áudio", productCount: 2 }] }; },
      addItemToCart: async () => assert.fail("no item selected") } as never });
  const result = await agent.run({ merchantId: "owned", sessionId: "same", userMessage: "Quero comprar um produto", history: [], messageFormat: "whatsapp" });
  assert.equal(reads, 1); assert.deepEqual(result.toolsUsed, ["list_categories"]);
  assert.equal(result.blocks[0]?.type, "category_carousel"); assert.match(result.message, /categorias da loja/);
});
