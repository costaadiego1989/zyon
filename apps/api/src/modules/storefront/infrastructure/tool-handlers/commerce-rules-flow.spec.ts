import test from "node:test";
import assert from "node:assert/strict";
import { createCartHandlers } from "./cart.handlers.js";
import { createProductHandlers } from "./product.handlers.js";
import { buildConversationBlocks } from "../agents/conversation-block.builder.js";
import { productRuleNotices, conditionNotice } from "../../domain/services/advanced-rule-notices.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import type { CartHandlerDeps } from "./cart.handlers.js";

const rule: AdvancedRule = { id: "discount", enabled: true, priority: 1,
  conditions: [{ field: "cart_item_count", operator: ">=", value: 2 }],
  action: { type: "offer_discount", params: { percent: 50, maxDiscountReais: 10 } } };
const ctx = { merchantId: "merchant", sessionId: "session" };

function fixture(rules: AdvancedRule[] = [], postCart = false, preCart = false, promotion = false) {
  const product = (id: string) => ({ id, name: "Product " + id, isActive: true, type: "physical", hasStock: true, totalStock: 10,
    variants: [{ id: "v-" + id, sku: "sku-" + id, isActive: true, basePriceInCents: 10000, media: [], attributes: {} }],
    defaultVariant: { basePriceInCents: 10000, media: [] } });
  const products = [product("one"), product("two")];
  let base: StorefrontCart = { id: "cart", merchantId: ctx.merchantId, sessionId: ctx.sessionId, items: [], couponCode: null, discount: 0, freeShipping: false, total: 0, createdAt: new Date(), updatedAt: new Date() };
  const fresh = () => structuredClone(base);
  const recompute = () => { base.total = base.items.reduce((n, i) => n + i.unitPriceCents * i.quantity, 0); return fresh(); };
  const deps = {
    productRepo: { search: async () => ({ products }), findById: async (_m: string, id: string) => products.find((p) => p.id === id) ?? null },
    stockRepo: { getAvailableStock: async () => ({ quantity: 10 }) },
    prisma: { checkoutSetting: { findUnique: async () => ({ advancedRules: rules }) }, productVariant: { findMany: async () => [] } },
    merchantRepo: { getRules: async () => ({ maxDiscountPercent: 20, minimumMarginPercent: 0, allowFreeShipping: true }) },
    productPromotionRepo: promotion ? { findActiveBySku: async () => [{ discountType: "percent", discountValue: 20 }] } : undefined,
    loadCrossSellConfig: async () => ({ enabled: true, touchpoints: { browsing: false, pre_cart: preCart, post_cart: postCart, pre_payment: false, post_purchase: false },
      strategies: ["same_category"], limits: { maxSuggestionsPerSession: 2, cooldownSeconds: 0 },
      discount: { enabled: true, mode: "percent", percent: 15 }, display: { mode: "modal" } }),
    cartRepo: {
      getOrCreate: async () => fresh(),
      addItem: async (_m: string, _s: string, item: StorefrontCart["items"][number]) => {
        const current = base.items.find((i) => i.variantId === item.variantId);
        if (current) current.quantity += item.quantity; else base.items.push(item);
        return recompute();
      },
      updateItemQuantity: async (_m: string, _s: string, id: string, quantity: number) => {
        base.items = base.items.flatMap((i) => i.variantId === id ? quantity ? [{ ...i, quantity }] : [] : [i]);
        return recompute();
      },
      removeItem: async (_m: string, _s: string, id: string) => { base.items = base.items.filter((i) => i.variantId !== id); return recompute(); },
      applyRuleOutcome: async (_m: string, _s: string, out: { discountCents: number; freeShipping: boolean }) => {
        base.discount = out.discountCents; base.freeShipping = out.freeShipping; return fresh();
      },
    },
  } as unknown as CartHandlerDeps;
  return { deps, handlers: createCartHandlers(deps, ctx), products };
}

test("product promotion is applied once across add and read, including original-price metadata", async () => {
  const { handlers } = fixture([], false, false, true);
  const added = await handlers.addItemToCart({ variantId: "v-one", quantity: 1 }) as any;
  const read = await handlers.getCart({ cartId: ctx.sessionId }) as any;
  for (const cart of [added, read]) {
    assert.equal(cart.total, 80);
    assert.equal(cart.items[0].unitPrice, 80);
    assert.equal(cart.items[0].originalPrice, 100);
  }
});

test("global rule nudges reach chat, then confirm the capped amount and clear after quantity removal", async () => {
  const { handlers } = fixture([rule]);
  const added = await handlers.addItemToCart({ variantId: "v-one", quantity: 1 }) as any;
  assert.equal(added.nextNudge.gap, 1);
  assert.match(added.nextNudge.message, /20%/);
  const blocks = buildConversationBlocks({ merchantId: ctx.merchantId, userMessage: "", finalContent: "", toolResults: { add_item_to_cart: added } }).blocks;
  assert.equal((blocks[0] as any).data.nextNudge.gap, 1);
  const updated = await handlers.updateCartItem({ cartId: ctx.sessionId, variantId: "v-one", quantity: 2 }) as any;
  assert.equal(updated.discount, 10);
  assert.match(updated.activeRules[0].message, /10,00/);
  const updatedBlocks = buildConversationBlocks({ merchantId: ctx.merchantId, userMessage: "", finalContent: "", toolResults: { update_cart_item: updated } }).blocks;
  assert.equal((updatedBlocks[0] as any).data.total, 190);
  const removed = await handlers.removeCartItem({ cartId: ctx.sessionId, variantId: "v-one" }) as any;
  const empty = buildConversationBlocks({ merchantId: ctx.merchantId, userMessage: "", finalContent: "", toolResults: { remove_cart_item: removed } }).blocks;
  assert.equal((empty[0] as any).data.items.length, 0);
  assert.equal(removed.discount, 0);
  assert.equal(removed.activeRules, undefined);
});

test("post_cart independently enables suggestions only after a successful add; fallback has no fabricated discount", async () => {
  for (const enabled of [true, false]) {
    const { handlers } = fixture([], enabled, true);
    const result = await handlers.addItemToCart({ variantId: "v-one", quantity: 1 }) as any;
    assert.equal(Boolean(result.crossSellSuggestions?.length), enabled);
    if (enabled) {
      assert.equal(result.crossSellSuggestions[0].sku, "v-two");
      assert.equal(result.crossSellSuggestions[0].discountPercent, undefined);
      const blocks = buildConversationBlocks({ merchantId: ctx.merchantId, userMessage: "", finalContent: "", toolResults: { add_item_to_cart: result } }).blocks;
      assert.equal(blocks[1].type, "cross_sell");
      assert.equal((blocks[1] as any).data.displayMode, "modal");
    }
    const failed = await handlers.addItemToCart({ variantId: "missing", quantity: 1 }) as any;
    assert.equal(failed.error, "variant_not_resolved");
    assert.equal(failed.crossSellSuggestions, undefined);
  }
});

test("pre_cart suggestions appear with product details and can coexist with post_cart", async () => {
  const { deps } = fixture([], true, true);
  const detail = await createProductHandlers(deps, ctx).getProductDetails({ productId: "one" }) as any;
  assert.equal(detail.crossSellSuggestions[0].sku, "v-two");
  const blocks = buildConversationBlocks({ merchantId: ctx.merchantId, userMessage: "", finalContent: "", toolResults: { get_product_details: detail } }).blocks;
  assert.equal(blocks[0].type, "product_card");
  assert.equal(blocks[1].type, "cross_sell");
});

test("all seven configured actions have correct notice behavior, without false application or interest claims", () => {
  const actions: AdvancedRule["action"][] = [
    rule.action, { type: "offer_free_shipping", params: {} }, { type: "offer_coupon", params: { code: "REAL" } },
    { type: "show_message", params: { message: "Mensagem da loja" } }, { type: "suggest_product", params: { productName: "Complemento" } },
    { type: "offer_installments", params: { maxInstallments: 3 } }, { type: "do_nothing", params: {} },
  ];
  for (const action of actions) {
    const notices = productRuleNotices([{ ...rule, productId: "one", action }], ["sku-one"], "one");
    assert.equal(notices.length, action.type === "do_nothing" ? 0 : 1);
    if (notices.length) assert.doesNotMatch(notices[0].message, /sem juros|aplicado|compre 2/i);
  }
  assert.deepEqual(productRuleNotices([{ ...rule, productId: "other" }], ["sku-one"], "one"), []);
  assert.deepEqual(productRuleNotices([{ ...rule, productId: "one", enabled: false }], ["sku-one"], "one"), []);
});

test("all nine condition types have buyer-facing descriptions and preserve AND conditions", () => {
  for (const field of ["cart_total", "shipping_cost", "product_in_cart", "category_in_cart", "coupon_applied", "buyer_type", "payment_method", "trigger_fired", "cart_item_count"]) {
    assert.ok(conditionNotice({ field, operator: ">=", value: 2 }).length > 10);
  }
  const notice = productRuleNotices([{ ...rule, productId: "one", conditions: [
    { field: "cart_total", operator: ">", value: 100 }, { field: "payment_method", operator: "==", value: "pix" },
  ] }], ["sku-one"], "one")[0].message;
  assert.match(notice, /acima de/);
  assert.match(notice, /100,00 e pagamento/);
  assert.match(notice, /Pix/);
});
