import test from "node:test";
import assert from "node:assert/strict";
import { resolveDeterministicShortcut, type DeterministicShortcutDeps } from "./deterministic-shortcuts.service.js";
import { appendOneBuyClickCheckout } from "../one-buy-click/one-buy-click-checkout-preparation.js";
import { ensureProductDiscovery } from "../agents/product-discovery-fallback.js";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";
import type { StorefrontConversationInput } from "../../domain/ports/conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { readStorefrontCartState } from "../adapters/read-storefront-cart-state.js";
import { createCartHandlers } from "../tool-handlers/cart.handlers.js";
import { wrapHandler } from "../../domain/tools/types.js";
import { executeStorefrontUiAction } from "../agents/storefront-ui-action.executor.js";
import { buildConversationBlocks } from "../agents/conversation-block.builder.js";
import { createAllowedScopeAgent } from "../agents/storefront-scope.fixture.js";
import type { OpenRouterProvider } from "@zyon/conversation-engine";

const input: StorefrontConversationInput = { merchantId: "merchant", sessionId: "conversation", cartId: "cart", history: [], storeCategory: "others", userMessage: "Aplicar cupom PROMO" };
const cart = { cartId: "cart", total: 10, discount: 1, itemCount: 1, items: [{ variantId: "v1", name: "Produto", quantity: 1, unitPrice: 10, lineTotal: 10 }],
  addedItem: { variantId: "v1", optionItemIds: [] } };
const coupon = { ...cart, applied: true, couponCode: "PROMO", discountCents: 100, newTotal: 9, reason: "success" };
const cartBlock: ConversationBlock = { type: "cart_summary", data: { cartId: "cart", items: [{ variantId: "v1", productName: "Produto", quantity: 1, price: 10, subtotal: 10 }], itemCount: 1, subtotal: 10, total: 9, discount: 1 } };
const prepared = { checkoutPrepared: true, actionId: "action", cartId: "cart", shippingPreference: "fastest", paymentPreference: "pix" };

function shortcutFixture(data: unknown, throws = false) {
  const calls = { writes: 0, reads: 0, catalog: 0, copy: 0, events: 0 };
  const deps: DeterministicShortcutDeps = {
    productRepo: { search: async () => { calls.catalog++; throw new Error("must_not_search"); } } as never,
    copyService: { generateVariantCopy: async () => { calls.copy++; throw new Error("must_not_generate"); } } as never,
    emitFunnelEvent: async () => { calls.events++; },
    applyCoupon: async () => { calls.writes++; if (throws) throw new Error("PRIVATE_FAILURE_AFTER_COMMIT"); return data; },
    addItemToCart: async () => { calls.writes++; return data; },
    getCartBlock: async () => { calls.reads++; return cartBlock; },
  };
  return { deps, calls };
}

test("direct coupon preserves an authorized success and refreshes the current cart once", async () => {
  const f = shortcutFixture(coupon);
  const result = await resolveDeterministicShortcut(f.deps, input);
  assert.ok(result); assert.match(result.message, /aplicado/); assert.match(result.message, /1,00/);
  assert.deepEqual(result.blocks, [cartBlock]);
  assert.equal(f.calls.writes, 1); assert.equal(f.calls.reads, 1); assert.equal(f.calls.copy, 0);
});

test("direct coupon preserves an explicit authoritative rejection", async () => {
  const f = shortcutFixture({ applied: false, reason: "COUPON_EXPIRED" });
  const result = await resolveDeterministicShortcut(f.deps, input);
  assert.ok(result); assert.match(result.message, /expirado/); assert.equal(f.calls.writes, 1);
});

for (const [name, data, throws] of [
  ["transport lost after write", undefined, true], ["null", null, false],
  ["string amount", { ...coupon, discount: "PRIVATE_RESULT" }, false],
  ["foreign cart", { ...coupon, cartId: "foreign" }, false],
  ["success-looking malformed payload", { applied: true, discount: 99 }, false],
  ["domain error without known application outcome", { error: "internal_error", detail: "PRIVATE_RESULT" }, false],
] as const) {
  test(`direct coupon ${name} is uncertain and cannot fall through to another write path`, async () => {
    const f = shortcutFixture(data, throws);
    const result = await resolveDeterministicShortcut(f.deps, input);
    assert.ok(result, "do not return null and let the agent retry a possibly committed write");
    assert.match(result.message, /confirmar/); assert.doesNotMatch(result.message, /PRIVATE_|aplicado!/);
    assert.deepEqual(result.blocks, []); assert.equal(f.calls.writes, 1); assert.equal(f.calls.reads, 0); assert.equal(f.calls.copy, 0);
  });
}

test("failed cart refresh cannot erase a confirmed coupon application or replay it", async () => {
  const f = shortcutFixture(coupon);
  f.deps.getCartBlock = async () => { f.calls.reads++; throw new Error("PRIVATE_REFRESH_FAILURE"); };
  const result = await resolveDeterministicShortcut(f.deps, input);
  assert.ok(result); assert.match(result.message, /aplicado/); assert.deepEqual(result.blocks, []);
  assert.equal(f.calls.writes, 1); assert.equal(f.calls.reads, 1);
});

test("a foreign refresh block is not attached to an otherwise confirmed coupon", async () => {
  const f = shortcutFixture(coupon);
  f.deps.getCartBlock = async () => ({ ...cartBlock, data: { ...cartBlock.data, cartId: "foreign" } } as ConversationBlock);
  const result = await resolveDeterministicShortcut(f.deps, input);
  assert.ok(result); assert.match(result.message, /aplicado/); assert.deepEqual(result.blocks, []);
});

for (const data of [{ ...cart, total: -1 }, { ...cart, total: "PRIVATE_RESULT" }, { ...cart, items: [{ ...cart.items[0], lineTotal: Infinity }] }]) {
  test(`direct add rejects malformed cart arithmetic after one attempt: ${JSON.stringify(data)}`, async () => {
    const f = shortcutFixture(data);
    const result = await resolveDeterministicShortcut(f.deps, { ...input, userMessage: "Adicionar ao carrinho [variantId:v1]" });
    assert.ok(result); assert.match(result.message, /confirmar/);
    assert.ok(result.blocks.some(block => block.type === "cart_add_result" && block.data.status === "unknown"));
    assert.ok(!result.blocks.some(block => block.type === "cart_summary"));
    assert.equal(f.calls.writes, 1); assert.equal(f.calls.events, 0);
  });
}

for (const data of [{ ...prepared, cartId: "foreign" }, { ...prepared, actionId: "" }, { ...prepared, success: false }]) {
  test(`OneBuyClick rejects malformed or foreign preparation: ${JSON.stringify(data)}`, async () => {
    let calls = 0;
    const blocks = await appendOneBuyClickCheckout({ blocks: [cartBlock], toolsUsed: ["add_item_to_cart"], oneBuyClickEnabled: true,
      cartId: "cart", createCheckoutSession: async () => { calls++; return data; } });
    assert.equal(calls, 1); assert.deepEqual(blocks, [cartBlock]);
  });
}

test("OneBuyClick does not prepare based on a foreign or malformed cart display", async () => {
  for (const evidence of [[{ ...cartBlock, data: { ...cartBlock.data, cartId: "foreign" } }],
    [{ ...cartBlock, data: { ...cartBlock.data, total: "PRIVATE_RESULT" } }],
    [cartBlock, { type: "cart_add_result", data: { cartId: "foreign", variantId: "v1", status: "succeeded" } }],
    [cartBlock, { type: "cart_add_result", data: undefined }]]) {
    let calls = 0;
    await appendOneBuyClickCheckout({ blocks: evidence as ConversationBlock[], toolsUsed: ["add_item_to_cart"], oneBuyClickEnabled: true,
      cartId: "cart", createCheckoutSession: async () => { calls++; return prepared; } });
    assert.equal(calls, 0);
  }
});

test("OneBuyClick does not prepare after an uncertain addition even with an older cart snapshot", async () => {
  let calls = 0;
  await appendOneBuyClickCheckout({ blocks: [cartBlock, { type: "cart_add_result", data: { cartId: "cart", variantId: "v1", status: "unknown" } }],
    toolsUsed: ["add_item_to_cart"], oneBuyClickEnabled: true, cartId: "cart", createCheckoutSession: async () => { calls++; return prepared; } });
  assert.equal(calls, 0);
});

for (const data of [null, { products: [{ id: "p1", name: "Produto", price: "PRIVATE_RESULT", inStock: true }] }]) {
  test(`direct product discovery fails closed on malformed output ${JSON.stringify(data)}`, async () => {
    let calls = 0;
    const result = await ensureProductDiscovery({ message: "Olá", blocks: [], toolsUsed: [], cartId: "cart" },
      { userMessage: "Quero um produto para pele oleosa", merchantId: "merchant", handlers: { searchProducts: async () => { calls++; return data; } } as never });
    assert.equal(calls, 1); assert.deepEqual(result.blocks, []); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RESULT/);
    assert.match(result.message, /consultar|confirmar/);
  });
}

test("adapter reads auxiliary cart state with a real merchant scope", async () => {
  const calls: unknown[] = [];
  const adapter = Object.create(StorefrontConversationAdapter.prototype) as StorefrontConversationAdapter;
  Object.assign(adapter, { handlerDeps: { prisma: {} }, agent: { prepare: async () => ({ allowed: true,
    run: async () => ({ message: "Olá", blocks: [], toolsUsed: [], cartId: "cart" }) }) },
    cartRepo: { getOrCreate: async (...args: unknown[]) => { calls.push(args); return { merchantId: "merchant", sessionId: "cart", total: 1000, couponCode: null, items: [{ variantId: "v1", name: "Produto", quantity: 1 }] }; } } });
  await adapter.reply({ ...input, userMessage: "Olá" });
  assert.deepEqual(calls, [["merchant", "cart"]]);
});

for (const args of [{ cartId: "foreign", couponCode: "PROMO" }, { cartId: "cart", couponCode: "PROMO", discount: 99 }, { cartId: "cart", couponCode: "" }]) {
  test(`shared direct-call boundary rejects invalid arguments before execution: ${JSON.stringify(args)}`, async () => {
    let calls = 0;
    const result = await callStorefrontTool("apply_coupon", args, async () => { calls++; return coupon; }, { cartId: "cart" });
    assert.equal(calls, 0); assert.deepEqual(result, { ok: false, error: "invalid_tool_arguments", code: "invalid_tool_arguments" });
  });
}

test("the shared boundary propagates exceptions without adding retries or leaking them as payloads", async () => {
  let calls = 0;
  await assert.rejects(callStorefrontTool("apply_coupon", { couponCode: "PROMO" }, async () => { calls++; throw new Error("lost_after_commit"); }), /lost_after_commit/);
  assert.equal(calls, 1);
});

test("option binding IDs survive projection so a mismatched saved selection cannot become success", async () => {
  const data = { ...cart, addedItem: { variantId: "v1", optionItemIds: ["expected"] },
    items: [{ ...cart.items[0], selectedOptions: [{ itemId: "different", groupName: "Extras", itemName: "Opção", priceModifier: 1 }] }] };
  const f = shortcutFixture(data);
  const result = await resolveDeterministicShortcut(f.deps, { ...input, userMessage: "Adicionar ao carrinho [variantId:v1] [optionItemIds:expected]" });
  assert.ok(result); assert.ok(result.blocks.some(block => block.type === "cart_add_result" && block.data.status === "unknown"));
  assert.equal(f.calls.writes, 1);
});

test("coupon reason lookup cannot resolve prototype properties", async () => {
  for (const reason of ["toString", "__proto__", "constructor"]) {
    const f = shortcutFixture({ applied: false, reason });
    const result = await resolveDeterministicShortcut(f.deps, input);
    assert.ok(result); assert.equal(typeof result.message, "string"); assert.match(result.message, /Não foi possível aplicar/);
  }
});

const snapshot = { merchantId: "merchant", sessionId: "cart", total: 1000, couponCode: null,
  items: [{ variantId: "v1", name: "Produto", quantity: 2, costInCents: 100, internal: "PRIVATE_RESULT" }], internal: "PRIVATE_RESULT" };

test("quick-reply state preserves cents and projects only display fields", async () => {
  const calls: unknown[] = [];
  const state = await readStorefrontCartState({ getOrCreate: async (...args: unknown[]) => { calls.push(args); return snapshot; } } as never, { merchantId: "merchant", cartId: "cart" });
  assert.deepEqual(state, { items: [{ variantId: "v1", name: "Produto", quantity: 2 }], total: 1000, itemCount: 2, couponCode: null });
  assert.deepEqual(calls, [["merchant", "cart"]]); assert.doesNotMatch(JSON.stringify(state), /PRIVATE_RESULT|costInCents/);
});

for (const [label, data] of [
  ["foreign merchant", { ...snapshot, merchantId: "foreign" }], ["foreign cart", { ...snapshot, sessionId: "foreign" }],
  ["string money", { ...snapshot, total: "PRIVATE_RESULT" }], ["negative money", { ...snapshot, total: -1 }],
  ["fractional quantity", { ...snapshot, items: [{ ...snapshot.items[0], quantity: 0.5 }] }], ["missing snapshot", null],
] as const) {
  test(`auxiliary cart state rejects ${label}`, async () => {
    let calls = 0;
    assert.equal(await readStorefrontCartState({ getOrCreate: async () => { calls++; return data; } } as never, { merchantId: "merchant", cartId: "cart" }), undefined);
    assert.equal(calls, 1);
  });
}

test("invalid auxiliary scope never reaches the repository", async () => {
  let calls = 0;
  for (const scope of [{ merchantId: "", cartId: "cart" }, { merchantId: "merchant", cartId: "" }]) {
    assert.equal(await readStorefrontCartState({ getOrCreate: async () => { calls++; return snapshot; } } as never, scope), undefined);
  }
  assert.equal(calls, 0);
});

test("auxiliary repository failure is best-effort without retry", async () => {
  let calls = 0;
  assert.equal(await readStorefrontCartState({ getOrCreate: async () => { calls++; throw new Error("PRIVATE_DB_FAILURE"); } } as never, { merchantId: "merchant", cartId: "cart" }), undefined);
  assert.equal(calls, 1);
});

test("OneBuyClick respects the budget path and never converts a redirect into a preparation", async () => {
  for (const data of [{ budgetRequired: true, cartId: "cart", message: "Solicite orçamento" }, { checkoutUrl: "https://checkout.example.test/chk", sessionId: "chk" }]) {
    let calls = 0;
    assert.deepEqual(await appendOneBuyClickCheckout({ blocks: [cartBlock], toolsUsed: ["add_item_to_cart"], oneBuyClickEnabled: true, cartId: "cart",
      createCheckoutSession: async () => { calls++; return data; } }), [cartBlock]);
    assert.equal(calls, 1);
  }
});

test("direct discovery cannot turn a read exception into a claim of no matching products", async () => {
  let calls = 0;
  const result = await ensureProductDiscovery({ message: "Olá", blocks: [], toolsUsed: [] }, { userMessage: "Quero um produto para pele oleosa", merchantId: "merchant",
    handlers: { searchProducts: async () => { calls++; throw new Error("PRIVATE_DB_FAILURE"); } } as never });
  assert.match(result.message, /consultar/); assert.doesNotMatch(result.message, /Não encontrei/); assert.deepEqual(result.blocks, []); assert.equal(calls, 1);
});

function realCouponFixture(mode: "success" | "business_rejection" | "unknown_authorization" | "lost_after_write") {
  const calls = { authorized: 0, persisted: 0 };
  const handlers = createCartHandlers({
    cartRepo: {
      getOrCreate: async () => ({ id: "cart-row", merchantId: "merchant", sessionId: "cart", items: [{ variantId: "v1", productId: "p1", sku: "SKU", name: "Produto", quantity: 1, unitPriceCents: 1000 }],
        total: 1000, discount: 0, freeShipping: false, couponCode: null }),
      applyCoupon: async () => { calls.persisted++; if (mode === "lost_after_write") throw new Error("PRIVATE_FAILURE_AFTER_COMMIT");
        return { sessionId: "cart", total: 1000, items: [{ variantId: "v1", name: "Produto", quantity: 1, unitPriceCents: 1000 }] }; },
    },
    prisma: { productPrice: { findMany: async () => [{ variantId: "v1", costInCents: 100 }] } }, merchantRepo: { getRules: async () => ({ maxDiscountPercent: 20, minimumMarginPercent: 0 }) },
    couponCart: { apply: async () => {
      calls.authorized++;
      if (mode === "business_rejection") return { applied: false, reason: "COUPON_EXPIRED", commercialNotices: [{ version: 1, code: "benefit_conditions_not_met", message: "As condições deste benefício não foram atendidas." }] };
      if (mode === "unknown_authorization") throw new Error("PRIVATE_RESERVATION_OUTCOME_UNKNOWN");
      calls.persisted++;
      if (mode === "lost_after_write") throw new Error("PRIVATE_FAILURE_AFTER_COMMIT");
      return { applied: true, reason: "success", couponCode: "PROMO", discountCents: 100, discount: 1, total: 10, newTotal: 9,
        cartId: "cart", itemCount: 1, items: [{ variantId: "v1", name: "Produto", quantity: 1, unitPrice: 10, lineTotal: 10 }] };
    } },
  } as never, { merchantId: "merchant", sessionId: "cart" });
  return { handlers, calls };
}

for (const mode of ["lost_after_write", "unknown_authorization"] as const) {
  test(`real coupon handler preserves uncertainty at ${mode} without exposing exception text`, async () => {
    const f = realCouponFixture(mode);
    const result = await wrapHandler("apply_coupon", f.handlers.applyCoupon).execute({ cartId: "cart", couponCode: "PROMO" });
    assert.deepEqual(result, { ok: false, error: "store_tool_outcome_unknown", code: "store_tool_outcome_unknown" });
    assert.equal(f.calls.authorized, 1); assert.equal(f.calls.persisted, mode === "lost_after_write" ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  });
}

test("real coupon business rejection remains explicit and does not persist", async () => {
  const f = realCouponFixture("business_rejection");
  const result = await f.handlers.applyCoupon({ couponCode: "PROMO" }) as { applied: boolean; reason: string; commercialNotices: { code: string }[] };
  assert.equal(result.applied, false); assert.equal(result.reason, "COUPON_EXPIRED");
  assert.equal(result.commercialNotices[0]?.code, "benefit_conditions_not_met");
  assert.equal(f.calls.authorized, 1); assert.equal(f.calls.persisted, 0);
});

test("real uncertain coupon cannot be retried by the direct shortcut or refreshed", async () => {
  const f = realCouponFixture("lost_after_write"); const shortcut = shortcutFixture(undefined);
  shortcut.deps.applyCoupon = f.handlers.applyCoupon;
  const result = await resolveDeterministicShortcut(shortcut.deps, input);
  assert.ok(result); assert.match(result.message, /confirmar/); assert.deepEqual(result.blocks, []);
  assert.equal(f.calls.authorized, 1); assert.equal(f.calls.persisted, 1); assert.equal(shortcut.calls.reads, 0);
});

test("UI preserves real coupon uncertainty without presenting a rejection or refreshing", async () => {
  const f = realCouponFixture("lost_after_write");
  const result = await executeStorefrontUiAction(f.handlers as never, { tool: "apply_coupon", args: { couponCode: "PROMO" } }, "merchant", "cart");
  assert.match(result.message, /confirmar/); assert.deepEqual(result.blocks, []);
  assert.equal(f.calls.authorized, 1); assert.equal(f.calls.persisted, 1);
});

test("the native tool projection presents a stable uncertain message for a coupon write", () => {
  const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Aplicar cupom PROMO", finalContent: "",
    toolResults: { apply_coupon: { error: "store_tool_outcome_unknown" } } });
  assert.match(result.finalContent, /confirmar/); assert.deepEqual(result.blocks, []);
});

test("the full native agent stops after a real uncertain coupon mutation without provider failover", async () => {
  const f = realCouponFixture("lost_after_write"); let calls = 0; let failovers = 0;
  const agent = createAllowedScopeAgent({ provider: { chat: async () => { calls++; return { content: "", toolCalls: [{ id: "coupon", name: "apply_coupon", args: { couponCode: "PROMO" } }],
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } }; } } as unknown as OpenRouterProvider,
    fallbackProvider: { chat: async () => { failovers++; throw new Error("must_not_retry"); } } as unknown as OpenRouterProvider, toolHandlers: f.handlers as never });
  const result = await agent.run(input);
  assert.equal(calls, 1); assert.equal(failovers, 0); assert.equal(f.calls.authorized, 1); assert.equal(f.calls.persisted, 1);
  assert.match(result.message, /confirmar/); assert.deepEqual(result.blocks, []); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

