import assert from "node:assert/strict";
import test from "node:test";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { shoppingSearchEvidence } from "../../application/services/shopping-search-evidence.js";

const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });
const postSale = ["track_order", "get_invoice", "cancel_order"];
const track = { id: "wrong-track", name: "track_order", args: {} };
const plan = { version: 1 as const, query: "*", attributes: [], unsupportedCriteria: [] };
const wirePlan = { schemaVersion: 1, plan: { ...plan, recovery: null, minPriceCents: null, maxPriceCents: null,
  minRating: null, sortBy: null, delivery: null } };
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", storeCategory: "others",
  userMessage: "Quais produtos vocês vendem? Não altere meu carrinho.", history: [
    { role: "user" as const, content: "Qual é o status do meu pedido?" },
    { role: "assistant" as const, content: "Informe o número do pedido para consultar o rastreamento." },
    { role: "user" as const, content: "Quais produtos estão com desconto?" },
    { role: "assistant" as const, content: "Ainda não consigo verificar produtos com desconto. Podemos ajustar a busca?" },
  ] };
const productSearch = { intent: "PRODUCT_SEARCH" as const, requiresTool: true, needsProductDiscovery: true };
const search = { id: "search", name: "search_products", args: { query: "*", criteria: plan } };
const searchResult = { products: [{ id: "product", name: "Caderno", price: 1200, inStock: true }], query: "*",
  searchEvidence: shoppingSearchEvidence(plan, 1) };
function phase(request: any) { try { return JSON.parse(request.messages[0]?.content)?.id; } catch { return undefined; } }
function assertNoPostSale(requests: any[]) {
  for (const request of requests) for (const name of request.tools?.map((tool: any) => tool.function.name) ?? [])
    assert.equal(postSale.includes(name), false, name);
}

test("a catalog question after order history cannot execute or project a main tracking clarification", async () => {
  const requests: any[] = []; let main = 0, orders = 0, searches = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    trackOrder: async () => { orders++; return { found: false, message: "Informe o número do pedido para consultar o rastreamento." }; },
    searchProducts: async () => { searches++; return searchResult; },
  } as never, provider: { chat: async (request: any) => {
    requests.push(request); if (phase(request) === "storefront.shopping-plan") return { content: JSON.stringify(wirePlan), usage };
    main++; return { content: "", toolCalls: [main === 1 ? track : search], usage };
  } } as never }, productSearch);
  const result = await agent.run(input);
  assert.equal(orders, 0); assert.equal(searches, 1); assertNoPostSale(requests);
  assert.doesNotMatch(result.message, /número do pedido|rastreamento/); assert.deepEqual(result.toolsUsed, ["search_products"]);
  assert.equal(result.safetyValidation.safe, true); assert.equal(result.blocks.some(block => block.type === "product_carousel"), true);
});

test("product fallback announces and executes the same scope as primary", async () => {
  const requests: any[] = []; let fallback = 0, orders = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    trackOrder: async () => { orders++; return { found: false, message: "Informe o número do pedido para consultar o rastreamento." }; },
    searchProducts: async () => searchResult,
  } as never, provider: { chat: async (request: any) => {
    requests.push(request); if (phase(request) === "storefront.shopping-plan") return { content: JSON.stringify(wirePlan), usage };
    throw Error("primary_unavailable");
  } } as never, fallbackProvider: { chat: async (request: any) => {
    requests.push(request); return { content: "", toolCalls: [++fallback === 1 ? track : search], usage };
  } } as never }, productSearch);
  const result = await agent.run(input);
  assert.equal(orders, 0); assertNoPostSale(requests); assert.deepEqual(result.toolsUsed, ["search_products"]);
  assert.doesNotMatch(result.message, /número do pedido/); assert.equal(result.safetyValidation.safe, true);
});

test("a product retry cannot execute a post-sale tool or count it as catalog evidence", async () => {
  const requests: any[] = []; let calls = 0, orders = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    trackOrder: async () => { orders++; return { found: false, message: "Informe o número do pedido para consultar o rastreamento." }; },
  } as never, provider: { chat: async (request: any) => {
    requests.push(request); if (phase(request) === "storefront.shopping-plan") return { content: JSON.stringify(wirePlan), usage };
    return ++calls === 2 ? { content: "", toolCalls: [track], usage } : { content: reply("Informe o número do pedido."), usage };
  } } as never }, productSearch);
  const result = await agent.run(input);
  assert.equal(orders, 0); assertNoPostSale(requests); assert.deepEqual(result.toolsUsed, []);
  assert.equal(result.safetyValidation.safe, false); assert.doesNotMatch(result.message, /Informe o número/);
});

test("recommendations also exclude tracking, invoice and cancellation tools", async () => {
  const requests: any[] = []; let effects = 0, main = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    getInvoice: async () => { effects++; return { invoiceAvailable: false, message: "Solicite a nota." }; },
    cancelOrder: async () => { effects++; return { cancellationAvailable: false, message: "Solicite cancelamento." }; },
    searchProducts: async () => searchResult,
  } as never, provider: { chat: async (request: any) => {
    requests.push(request); if (phase(request) === "storefront.shopping-plan") return { content: JSON.stringify(wirePlan), usage };
    return ++main === 1 ? { content: "", toolCalls: [{ id: "invoice", name: "get_invoice", args: { orderId: "ORDER-1" } },
      { id: "cancel", name: "cancel_order", args: { orderId: "ORDER-1" } }], usage } : { content: "", toolCalls: [search], usage };
  } } as never }, { ...productSearch, intent: "RECOMMEND_PERSONALIZED" });
  const result = await agent.run(input);
  assert.equal(effects, 0); assertNoPostSale(requests); assert.deepEqual(result.toolsUsed, ["search_products"]);
});

for (const intent of ["COMPARE_PRODUCTS", "ORDER_STATUS"] as const) for (const useFallback of [false, true]) {
  test(`${intent} cannot substitute get_cart for its expected read in ${useFallback ? "fallback" : "primary/retry"}`, async () => {
    const requests: any[] = []; let cartReads = 0;
    const wrong = { id: "wrong", name: "get_cart", args: { cartId: "owned" } };
    const provider = { chat: async (request: any) => { requests.push(request); return request.tools?.length
      ? { content: "", toolCalls: [wrong], usage } : { content: reply("Seu pedido está entregue; estes produtos são iguais."), usage }; } };
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      getCart: async () => { cartReads++; return { cartId: "owned", items: [], itemCount: 0, total: 0 }; },
    } as never, provider: useFallback ? { chat: async () => { throw Error("primary_unavailable"); } } as never : provider as never,
      ...(useFallback ? { fallbackProvider: provider as never } : {}) }, { intent, requiresTool: true, needsProductDiscovery: false });
    const result = await agent.run({ ...input, userMessage: intent === "ORDER_STATUS" ? "Qual é o status do meu pedido?" : "Compare os dois produtos.", history: [] });
    const expected = intent === "ORDER_STATUS" ? "track_order" : "compare_products";
    assert.equal(cartReads, 0); assert.deepEqual(result.toolsUsed, []); assert.equal(result.safetyValidation.safe, false);
    assert.deepEqual(result.blocks, []); assert.doesNotMatch(result.message, /Seu pedido está entregue|produtos são iguais/);
    for (const request of requests.filter(value => value.tools?.length)) {
      assert.deepEqual(request.tools.map((tool: any) => tool.function.name), [expected]);
      assert.deepEqual(request.toolChoice, { type: "function", function: { name: expected } });
    }
  });
}

test("mixed complex questions retain tools and review instead of the order-only terminal projection", async () => {
  let calls = 0, reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    trackOrder: async () => { reads++; return { found: false, message: "Informe o número do pedido para consultar o rastreamento." }; },
  } as never, provider: { chat: async (request: any) => {
    assert.ok(request.tools?.some((tool: any) => tool.function.name === "track_order"));
    return ++calls === 1 ? { content: "", toolCalls: [track], usage }
      : { content: reply("Para consultar um pedido, informe seu número; para ver produtos, escolha uma categoria."), usage };
  } } as never }, { intent: "COMPLEX_QUESTION", requiresTool: true, needsProductDiscovery: false });
  const result = await agent.run({ ...input, userMessage: "Quero conhecer os produtos e entender como rastrear um pedido.", history: [] });
  assert.equal(calls, 2); assert.equal(reads, 1); assert.equal(agent.outputReviewRequests.length, 1);
  assert.match(result.message, /categoria/);
});

test("a typed read turn cannot execute an unannounced model write even when the text requests one", async () => {
  let writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    addItemToCart: async () => { writes++; throw Error("unknown_write"); },
  } as never, provider: { chat: async (request: any) => request.tools?.length
    ? { content: "", toolCalls: [{ id: "add", name: "add_item_to_cart", args: { variantId: "essential", quantity: 1 } }], usage }
    : { content: reply("Produto adicionado."), usage } } as never }, { intent: "COMPARE_PRODUCTS", requiresTool: true });
  const result = await agent.run({ ...input, userMessage: "Adicione uma unidade do Kit ao carrinho.", history: [] });
  assert.equal(writes, 0); assert.deepEqual(result.toolsUsed, []); assert.equal(result.safetyValidation.safe, false);
  assert.doesNotMatch(result.message, /Produto adicionado/);
});

test("read scopes preserve the existing server-authorized zero writer and its unknown terminal outcome", async () => {
  for (const intent of ["COMPARE_PRODUCTS", "ORDER_STATUS"] as const) for (const unknown of [false, true]) {
    let writes = 0, modelCalls = 0;
    const selection = { cartId: "owned", variantId: "essential", quantity: 0, optionItemIds: [], serviceSlotId: null };
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
      inspectCartQuantity: async () => ({ status: "admitted", cartId: "owned", quantity: 0, selection }),
      updateCartItem: async (args: unknown) => {
        writes++; assert.deepEqual(args, selection); if (unknown) throw Error("unknown_write");
        return { cartId: "owned", items: [{ variantId: "r3", name: "Produto R$3", quantity: 1, unitPrice: 3, lineTotal: 3 }], itemCount: 1, total: 3 };
      },
    } as never, provider: { chat: async () => { modelCalls++; throw Error("no_model_after_admitted_zero"); } } as never }, { intent, requiresTool: true });
    const result = await agent.run({ ...input, userMessage: "Mude a quantidade do Kit Organizador Essencial no meu carrinho para 0 unidades.", history: [] });
    assert.equal(writes, 1); assert.equal(modelCalls, 0); assert.deepEqual(result.toolsUsed, ["update_cart_item"]);
    assert.match(result.message, unknown ? /Não consegui confirmar/ : /Carrinho atualizado/);
    if (!unknown) assert.equal(result.blocks.some(block => block.type === "cart_summary"), true);
  }
});
