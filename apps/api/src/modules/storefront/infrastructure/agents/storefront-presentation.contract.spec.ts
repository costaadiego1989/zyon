import test from "node:test";
import assert from "node:assert/strict";
import type { OpenRouterChatRequest } from "@zyon/conversation-engine";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import { detectStoreStage, storefrontQuickReplies } from "../../domain/services/storefront-quick-replies.service.js";
import { DEFAULT_STORE_QUICK_REPLIES } from "../../domain/defaults/store-quick-replies.defaults.js";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { ensureProductDiscovery } from "./product-discovery-fallback.js";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import { BadRequestException } from "@nestjs/common";

const product = { id: "product", name: "Produto", price: 1000, inStock: true, variants: [] };
const base = { merchantId: "store", userMessage: "Detalhes do produto", finalContent: "Confira.",
  toolResults: { search_products: { products: [product] } } };
const context = { mode: "structured", source: "structured", intent: "PRODUCT_SEARCH", merchantId: "store", cartId: "cart", blocks: [] };
const defaults = (stage: string) => DEFAULT_STORE_QUICK_REPLIES.stages.find(value => value.stage === stage)!.replies;
const quick = (lastTool: string | null, ctx: unknown = context, config?: unknown, message = "Adicionar ao carrinho") =>
  storefrontQuickReplies(lastTool, config as never, undefined, undefined, message, undefined, ctx as never);
const cartBlock = { type: "cart_summary", data: { cartId: "cart", items: [{ variantId: "variant", productName: "Produto", quantity: 1, price: 1000, subtotal: 1000 }], itemCount: 1, subtotal: 1000, total: 1000 } };
const addBlock = (status: string) => ({ type: "cart_add_result", data: { cartId: "cart", variantId: "variant", status } });

for (const [message, stage] of [["Adicionar ao carrinho", "welcome"], ["Não quero adicionar", "welcome"],
  ["Filtrar por preço", "filter"], ["Detalhes", "product_detail"], ["Qual a diferença?", "welcome"]]) {
  test(`characterizes legacy presentation without certifying semantics: ${message}`, () => {
    assert.equal(detectStoreStage(null, { userMessage: message }), stage);
  });
}
test("legacy search still uses detail keyword promotion for compatibility", () => {
  assert.equal(buildConversationBlocks(base).blocks[0].type, "product_card");
});

for (const userMessage of ["Detalhes do produto", "Não quero detalhes", "me fale", "Mais informações"]) {
  test(`structured block rendering does not promote search using text: ${userMessage}`, () => {
    const built = buildConversationBlocks({ ...base, userMessage, presentationMode: "structured" } as never);
    assert.equal(built.blocks[0].type, "product_carousel");
  });
}
test("actual product-details result still renders a detailed card without keyword", () => {
  const built = buildConversationBlocks({ ...base, userMessage: "este aqui", presentationMode: "structured",
    toolResults: { get_product_details: { product } } } as never);
  assert.equal(built.blocks[0].type, "product_card");
});

for (const [intent, stage] of [["PRODUCT_SEARCH", "browsing"], ["RECOMMEND_PERSONALIZED", "browsing"],
  ["GREETING", "welcome"], ["ADD_CART", "browsing"], ["ORDER_STATUS", "post_purchase"],
  ["RETURN_REQUEST", "support"], ["COMPLEX_QUESTION", "welcome"]]) {
  test(`structured quick replies derive stage from validated intent ${intent}`, () => {
    assert.deepEqual(quick(null, { ...context, intent }), defaults(stage));
  });
}

test("invalid or fallback context never restores text heuristics", () => {
  for (const ctx of [{ ...context, intent: "DELETE" }, { ...context, source: "fallback", intent: "ADD_CART" },
    { ...context, blocks: [{ type: "unknown", data: {} }] }, { ...context, extra: true }]) {
    assert.deepEqual(quick(null, ctx), defaults("welcome"));
  }
});

for (const status of ["unknown", "rejected"]) {
  test(`uncertain/rejected add uses fixed review actions even with current cart and merchant config: ${status}`, () => {
    const config = { stages: [{ stage: "added_to_cart", label: "Cart", replies: ["Finalizar Compra"] }], fallback: ["Finalizar Compra"] };
    assert.deepEqual(quick("add_item_to_cart", { ...context, blocks: [cartBlock, addBlock(status)] }, config), ["Ver Carrinho", "Continuar Comprando"]);
  });
}
test("a tool name or cart snapshot alone is not acknowledgement of this add", () => {
  assert.deepEqual(quick("add_item_to_cart", { ...context, blocks: [cartBlock] }), ["Ver Carrinho", "Continuar Comprando"]);
  assert.deepEqual(quick("add_item_to_cart"), ["Ver Carrinho", "Continuar Comprando"]);
});
test("confirmed matching add plus nonempty cart preserves normal cart suggestions", () => {
  assert.deepEqual(quick("add_item_to_cart", { ...context, blocks: [cartBlock, addBlock("succeeded")] }), defaults("added_to_cart"));
});

for (const blocks of [[{ ...cartBlock, data: { ...cartBlock.data, cartId: "foreign" } }, addBlock("succeeded")],
  [cartBlock, { ...addBlock("succeeded"), data: { ...addBlock("succeeded").data, cartId: "foreign" } }],
  [cartBlock, addBlock("succeeded"), addBlock("unknown")]]) {
  test(`foreign or conflicting cart evidence never unlocks checkout suggestions ${JSON.stringify(blocks).slice(0, 55)}`, () => {
    assert.deepEqual(quick("add_item_to_cart", { ...context, blocks }), ["Ver Carrinho", "Continuar Comprando"]);
  });
}

test("real blocks take precedence over conflicting user text and classifier", () => {
  const blocks = buildConversationBlocks({ ...base, presentationMode: "structured" } as never).blocks;
  assert.deepEqual(quick("search_products", { ...context, intent: "ADD_CART", blocks }), defaults("browsing"));
});

for (const config of [{ stages: [null], fallback: [] }, { stages: [{ stage: "browsing", replies: [1] }] },
  { stages: [{ stage: "browsing", label: "x", replies: ["x".repeat(501)] }], fallback: [] },
  { stages: [{ stage: "browsing", label: "x", replies: Array(9).fill("more") }], fallback: [] },
  { stages: [{ stage: "browsing", label: "x", replies: [" "] }], fallback: [] }]) {
  test(`structured merchant config is validated, not blindly trusted ${JSON.stringify(config).slice(0, 70)}`, () => {
    assert.deepEqual(quick("search_products", context, config), defaults("browsing"));
  });
}
test("valid bounded merchant array and persisted map remain supported", () => {
  const array = { stages: [{ stage: "browsing", label: "Browse", replies: ["Ver catálogo"] }], fallback: ["Ajuda"] };
  assert.deepEqual(quick("search_products", context, array), ["Ver catálogo"]);
  assert.deepEqual(quick("search_products", context, { browsing: ["Ver catálogo"] }), ["Ver catálogo"]);
});

test("structured discovery keeps a carousel for a single match despite detail keyword", async () => {
  const result = await ensureProductDiscovery({ message: "Confira.", toolsUsed: [] as string[], blocks: [] as ConversationBlock[] },
    { userMessage: "informações sobre algo para a pele", merchantId: "store", discoveryDecision: true,
      handlers: { searchProducts: async () => ({ products: [product] }) } } as never);
  assert.equal(result.blocks[0].type, "product_carousel");
});

test("structured agent propagates presentation mode without extra classification call", async () => {
  let calls = 0;
  const criteria = { version: 1, query: "algo", attributes: [], unsupportedCriteria: [] };
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async (request: OpenRouterChatRequest) => {
    calls++;
    if (JSON.parse(request.messages[0]!.content!).id === "storefront.reply-review") return {
      content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }), usage, finishReason: "stop",
    };
    if (calls === 1) return { content: JSON.stringify({ schemaVersion: 2, domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", confidence: 0.9, requiresTool: true, needsProductDiscovery: true }), usage };
    if (calls === 2) return { content: "", toolCalls: [{ id: "search", name: "search_products", args: { query: "algo", criteria } }], usage };
    return { content: '{"schemaVersion":1,"message":"Confira as opções."}', usage };
  } } as never, toolHandlers: { searchProducts: async () => ({ products: [product], searchEvidence: {
    version: 1, status: "verified", appliedPlan: criteria, message: "Confira as opções.", unconfirmedPreferences: [],
  } }) } as never });
  const output = await agent.run({ merchantId: "store", sessionId: "cart", history: [], storeCategory: "others", userMessage: "Detalhes do produto" });
  assert.equal(output.blocks[0].type, "product_carousel");
  assert.equal(calls, 2);
});

test("adapter preserves clarification suppression without stale structured catalog choices", async () => {
  const adapter = Object.create(StorefrontConversationAdapter.prototype) as StorefrontConversationAdapter;
  Object.assign(adapter, { structuredRouting: true, handlerDeps: { prisma: {} },
    agent: { prepare: async () => ({ allowed: true,
      run: async () => ({ message: "Vamos escolher?", blocks: [], toolsUsed: [], routing: { source: "structured", intent: "PRODUCT_SEARCH", needsProductDiscovery: false } }) }) } });
  const output = await adapter.reply({ merchantId: "store", sessionId: "cart", history: [], storeCategory: "others", userMessage: "Não quero adicionar ao carrinho" });
  assert.deepEqual(output.suggestedNext, []);
});

test("adapter still uses validated structured stage for a non-question response", async () => {
  const adapter = Object.create(StorefrontConversationAdapter.prototype) as StorefrontConversationAdapter;
  Object.assign(adapter, { structuredRouting: true, handlerDeps: { prisma: {} },
    agent: { prepare: async () => ({ allowed: true,
      run: async () => ({ message: "Veja as opções da loja.", blocks: [], toolsUsed: [], routing: { source: "structured", intent: "PRODUCT_SEARCH", needsProductDiscovery: false } }) }) } });
  const output = await adapter.reply({ merchantId: "store", sessionId: "cart", history: [], storeCategory: "others", userMessage: "Não quero adicionar ao carrinho" });
  assert.deepEqual(output.suggestedNext, defaults("browsing"));
});

test("direct stage detector honors structured context without raw-text fallback", () => {
  assert.equal(detectStoreStage(null, { userMessage: "Adicionar ao carrinho", presentation: context as never }), "browsing");
  assert.equal(detectStoreStage(null, { userMessage: "Adicionar", presentation: { ...context, mode: "invalid" } as never }), "welcome");
});

for (const lastTool of ["apply_coupon", "remove_coupon", "clear_cart", "remove_cart_item", "update_cart_item", "create_checkout_session", "add_catalog_items"]) {
  test(`cart tool name without outcome does not enable checkout: ${lastTool}`, () => {
    assert.deepEqual(quick(lastTool, { ...context, blocks: [cartBlock] }), ["Ver Carrinho", "Continuar Comprando"]);
  });
}
test("prepared checkout is accepted only in current scope and without uncertain add", () => {
  const prepared = { type: "checkout_prepared", data: { actionId: "action", cartId: "cart", shippingPreference: "fastest", paymentPreference: "pix" } };
  assert.deepEqual(quick("create_checkout_session", { ...context, blocks: [prepared] }), defaults("added_to_cart"));
  assert.deepEqual(quick("create_checkout_session", { ...context, blocks: [prepared, addBlock("unknown")] }), ["Ver Carrinho", "Continuar Comprando"]);
  assert.deepEqual(quick("create_checkout_session", { ...context, blocks: [{ ...prepared, data: { ...prepared.data, cartId: "foreign" } }] }), ["Ver Carrinho", "Continuar Comprando"]);
});
test("a successful add with mismatched variant or missing cart id is not sufficient evidence", () => {
  assert.deepEqual(quick("add_item_to_cart", { ...context, blocks: [cartBlock, { ...addBlock("succeeded"), data: { ...addBlock("succeeded").data, variantId: "other" } }] }), ["Ver Carrinho", "Continuar Comprando"]);
  assert.deepEqual(quick("add_item_to_cart", { ...context, blocks: [{ ...cartBlock, data: { ...cartBlock.data, cartId: undefined } }, addBlock("succeeded")] }), ["Ver Carrinho", "Continuar Comprando"]);
});

test("coupon suggestions come only from validated displayed list, not a parallel code array", () => {
  const coupons = { type: "coupon_list", data: { coupons: [{ code: "PUBLIC", description: "Oferta", expiresAt: null }] } };
  assert.deepEqual(storefrontQuickReplies("list_promotions", undefined, undefined, undefined, "", ["INVENTED"],
    { ...context, blocks: [coupons] } as never), ["Aplicar cupom PUBLIC", "Ver Carrinho", "Ver Produtos"]);
  assert.equal(quick("list_promotions", context, undefined, "cupom INVENTED").some(value => value.includes("INVENTED")), false);
});
test("displayed coupon already applied in validated cart is not suggested twice", () => {
  const coupons = { type: "coupon_list", data: { coupons: [{ code: "PUBLIC", description: "Oferta", expiresAt: null }, { code: "OTHER", description: "Oferta", expiresAt: null }] } };
  const cart = { items: [{ variantId: "variant", name: "Produto", quantity: 1 }], total: 1000, itemCount: 1, couponCode: "public" };
  assert.deepEqual(storefrontQuickReplies("list_promotions", undefined, cart, undefined, "", ["INVENTED"],
    { ...context, blocks: [coupons] } as never), ["Aplicar cupom OTHER", "Ver Carrinho", "Finalizar Compra"]);
});
test("invalid auxiliary cart state does not unlock finalization from a public offer", () => {
  const coupons = { type: "coupon_list", data: { coupons: [{ code: "PUBLIC", description: "Oferta", expiresAt: null }] } };
  const output = storefrontQuickReplies("list_promotions", undefined,
    { items: [], total: "1000", itemCount: 1, couponCode: 2 } as never, undefined, "", undefined, { ...context, blocks: [coupons] } as never);
  assert.deepEqual(output, ["Aplicar cupom PUBLIC", "Ver Carrinho", "Ver Produtos"]);
});
test("empty projected cart cannot unlock checkout through a conflicting item count", () => {
  const coupons = { type: "coupon_list", data: { coupons: [] } };
  const inconsistentCart = { ...cartBlock, data: { ...cartBlock.data, items: [], itemCount: 2 } };
  assert.deepEqual(quick("list_promotions", { ...context, blocks: [coupons, inconsistentCart] }), ["Ver Carrinho", "Ver Produtos"]);
});

test("shipping suggestions use only validated block prices, ignoring parallel values", () => {
  const shipping = { type: "shipping_options", data: { options: [{ carrier: "carrier", name: "Entrega", price: 1250, priceFormatted: "R$ 12,50", days: 3 }] } };
  const output = storefrontQuickReplies("quote_shipping", undefined, undefined,
    [{ carrier: "other", name: "Falso", price: 0, days: 0 }], "", undefined, { ...context, blocks: [shipping] } as never);
  assert.equal(output.length, 1);
  assert.match(output[0], /Entrega \(3 dias\).*12,50/);
  assert.equal(output[0].includes("Falso"), false);
});
test("invalid shipping block cannot be replaced by parallel quoted values", () => {
  const shipping = { type: "shipping_options", data: { options: [{ carrier: "carrier", name: "Entrega", price: -1, priceFormatted: "bad", days: 3 }] } };
  const output = storefrontQuickReplies("quote_shipping", undefined, undefined,
    [{ carrier: "other", name: "Falso", price: 0, days: 0 }], "", undefined, { ...context, blocks: [shipping] } as never);
  assert.deepEqual(output, defaults("welcome"));
});

test("foreign merchant carousel is ignored without reinterpreting the raw message", () => {
  const blocks = buildConversationBlocks({ ...base, presentationMode: "structured", merchantId: "foreign" } as never).blocks;
  assert.deepEqual(quick("search_products", { ...context, blocks }), defaults("welcome"));
});
test("unknown and prototype tool names cannot affect structured stages", () => {
  for (const name of ["__proto__", "constructor", "toString", "unknown"]) assert.deepEqual(quick(name), defaults("browsing"));
});
test("duplicate stage config is rejected; returned arrays do not expose mutable defaults", () => {
  const duplicate = { stages: Array(2).fill({ stage: "browsing", label: "Browse", replies: ["Wrong"] }), fallback: ["Wrong"] };
  const output = quick("search_products", context, duplicate);
  assert.deepEqual(output, defaults("browsing"));
  output.push("MUTATED");
  assert.equal(defaults("browsing").includes("MUTATED"), false);
});

test("structured UI known failure keeps review suggestions and never falls back to keyword staging", async () => {
  const adapter = Object.create(StorefrontConversationAdapter.prototype) as StorefrontConversationAdapter;
  Object.assign(adapter, { structuredRouting: true, handlerDeps: { prisma: {}, cartRepo: { getOrCreate: async () => { throw new BadRequestException("cart_unavailable"); } } } });
  const output = await adapter.reply({ merchantId: "store", sessionId: "cart", history: [], storeCategory: "others", userMessage: "Adicionar ao carrinho",
    uiAction: { tool: "apply_coupon", args: { couponCode: "PUBLIC" } } });
  assert.deepEqual(output.suggestedNext, ["Ver Carrinho", "Continuar Comprando"]);
});

