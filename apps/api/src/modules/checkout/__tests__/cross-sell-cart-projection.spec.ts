import assert from "node:assert/strict";
import test from "node:test";
import type { Cart } from "@zyon/shared-types";
import type { StorefrontCart } from "../../storefront/domain/ports/storefront-cart.port.js";
import type { StorefrontCrossSellCartPort } from "../../storefront/domain/ports/storefront-cross-sell-cart.port.js";
import { CartPromoResolutionService } from "../application/services/cart-promo-resolution.service.js";
import { CheckoutCartAuthorityService } from "../application/services/checkout-cart-authority.service.js";
import { reevaluateCartRules, type CartRulesDependencies } from "../../storefront/application/services/reevaluate-cart-rules.js";
import { createCartHandlers, type CartHandlerDeps } from "../../storefront/infrastructure/tool-handlers/cart.handlers.js";
import type { PrismaClient } from "@prisma/client";
import type { ValidateCartForPaymentUseCase } from "../../commerce/application/validate-cart-for-payment.use-case.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { StorefrontCartPort } from "../../storefront/domain/ports/storefront-cart.port.js";
import { StorefrontController } from "../../storefront/presentation/http/storefront.controller.js";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";

const intent = { version: 1 as const, promotionId: "promotion", promotionUpdatedAt: "2026-10-18T00:00:00.000Z",
  acceptedQuantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 };
const storefront = (): StorefrontCart => ({ id: "row", merchantId: "merchant", sessionId: "cart", createdAt: new Date(0), updatedAt: new Date(0),
  items: [{ variantId: "host", productId: "host-product", sku: "HOST", name: "Host", quantity: 1, unitPriceCents: 10000 },
    { variantId: "target", productId: "target-product", sku: "TARGET", name: "Target", quantity: 1, unitPriceCents: 10000, crossSellIntent: intent }],
  total: 20000, discount: 0, couponCode: null, freeShipping: false });
const projected = () => { const cart = storefront(); cart.items[1].unitPriceCents = 9000; cart.items[1].pricingOriginalUnitPriceCents = 10000;
  cart.total = 19000; cart.discount = 1000; cart.discountBudget = { version: 1, originalSubtotalCents: 20000, promotionDiscountCents: 1000 }; return cart; };
const checkout = (): Cart => ({ currency: "BRL", source: "storefront", cart_ref: "cart", total: 200,
  items: storefront().items.map(item => ({ variantId: item.variantId, product_id: item.productId, sku: item.sku, name: item.name,
    quantity: item.quantity, price: item.unitPriceCents / 100, ...(item.crossSellIntent ? { crossSellIntent: item.crossSellIntent } : {}) })) });
function reader(work: StorefrontCrossSellCartPort["project"]): StorefrontCrossSellCartPort {
  return { project: work,projectNormalSource:async()=>undefined, projectForCheckout: async scope => ({ cart: await work(scope), costsByVariant: new Map([["host", 20], ["target", 40]]) }),
    quote: async () => assert.fail("no_quote"), accept: async () => assert.fail("no_accept") };
}
function deniedLegacyDependencies(crossSellCart?: CartRulesDependencies["crossSellCart"]): CartRulesDependencies {
  const denied = async () => assert.fail("accepted_projection_must_not_call_legacy_collaborators");
  const merchantRepo: MerchantRepository = { getProfile: denied, getStripeConnectAccountId: denied, setStripeConnectAccountId: denied,
    getRules: denied, getExistingRules: denied, updateRules: denied, updateTheme: denied, updateStoreCategory: denied,
    getStoreSettings: denied, updateStoreSettings: denied };
  const cartRepo: StorefrontCartPort = { getOrCreate: denied, addItem: denied, removeItem: denied, updateItemQuantity: denied,
    clear: denied, applyCoupon: denied, removeCoupon: denied, applyRuleOutcome: denied };
  // No client construction: even a delegate/property read fails immediately.
  const prisma = new Proxy({} as PrismaClient, { get(_target, key) { assert.fail(`accepted_projection_must_not_read_prisma_${String(key)}`); } });
  return { prisma, merchantRepo, cartRepo, ...(crossSellCart ? { crossSellCart } : {}) };
}
test("storefront reevaluation uses the port before any legacy policy/read/cleanup and preserves P vs D", async () => {
  let calls = 0;
  const deps = deniedLegacyDependencies(reader(async (scope, expected) => { calls++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "cart" });
    assert.deepEqual(expected, storefront()); return projected(); }));
  const result = await reevaluateCartRules(deps, "merchant", "cart", storefront());
  assert.equal(calls, 1); assert.equal(result.cart.total, 19000); assert.equal(result.cart.discount, 1000);
  assert.equal(result.promoMeta?.get("target")?.originalPriceCents, 10000);
});
test("storefront accepted intent refuses absent authority instead of clearing or silently pricing base", async () => {
  await assert.rejects(reevaluateCartRules(deniedLegacyDependencies(), "merchant", "cart", storefront()));
});
test("storefront authorizer errors propagate without old cleanup, fallback or replay", async () => {
  const failure = new Error("synthetic-authority-failed"); let calls = 0;
  await assert.rejects(reevaluateCartRules(deniedLegacyDependencies(reader(async () => { calls++; throw failure; })),
    "merchant", "cart", storefront()), error => error === failure); assert.equal(calls, 1);
});
test("checkout promotion projection reauthorizes accepted metadata and never adds P again", async () => {
  let calls = 0;
  const service = new CartPromoResolutionService(undefined, undefined, reader(async scope => { calls++; assert.equal(scope.cartId, "cart"); return projected(); }));
  const input = checkout(), result = await service.resolveCartPromos(input, "merchant");
  assert.equal(calls, 1); assert.equal(result.total, 190); assert.equal(result.currentDiscount, 10); assert.equal(result.items[1].price, 90);
  assert.equal(result.items[1].originalPrice, 100); assert.deepEqual(result.items[1].crossSellIntent, intent); assert.equal(input.total, 200);
  assert.deepEqual((await service.resolveCartPromos(result, "merchant")).discountBudget, { version: 1, originalSubtotalCents: 20000, promotionDiscountCents: 1000 });
});
for (const change of ["missing-ref", "quantity", "base", "intent", "extra-line"])
  test(`checkout accepted projection refuses ${change} without legacy automatic fallback`, async () => {
    const service = new CartPromoResolutionService(undefined, undefined, reader(async () => projected())), value = checkout();
    if (change === "missing-ref") delete value.cart_ref;
    if (change === "quantity") value.items[1].quantity = 2;
    if (change === "base") value.items[1].price = 99;
    if (change === "intent") value.items[1].crossSellIntent = { ...intent, maximumUnitPriceCents: 8000 };
    if (change === "extra-line") value.items.pop();
    // Removing the only intent leaves legacy logic instead; ensure remaining
    // authoritative line count mismatch by retaining target when dropping host.
    if (change === "extra-line") value.items = [checkout().items[1]];
    await assert.rejects(service.resolveCartPromos(value, "merchant"));
  });
test("recovery refuses intent without exact stored cart_ref before reading/repricing", async () => {
  const authority = new CheckoutCartAuthorityService({} as never, {} as never, undefined, reader(async () => assert.fail("no_read")));
  const snapshot = checkout(); snapshot.cart_ref = "other";
  await assert.rejects(authority.resolveRecoveredStorefront("merchant", snapshot, "cart"), /checkout_price_review_required/);
});
test("visible accepted provenance refuses coupon before policy/PSP/reservation or cart write", async () => {
  const calls: string[] = [];
  const handlers = createCartHandlers({ cartRepo: { getOrCreate: async () => storefront() },
    merchantRepo: { getRules: async () => { calls.push("policy"); throw new Error("must_not_read"); } },
    applyCouponUseCase: { execute: async () => { calls.push("reserve"); throw new Error("must_not_reserve"); } },
    couponCart: { apply: async () => ({ applied: false, reason: "commercial_benefit_review_required" }) },
  } as unknown as CartHandlerDeps, { merchantId: "merchant", sessionId: "cart" });
  const result = await handlers.applyCoupon({ couponCode: "COUPON" });
  assert.ok(result !== null && typeof result === "object" && "applied" in result && "reason" in result);
  assert.equal(result.applied, false); assert.equal(result.reason, "commercial_benefit_review_required"); assert.deepEqual(calls, []);
});
function checkoutAuthorityFixture() {
  let reads = 0;
  const port = reader(async scope => { reads++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "cart" }); return projected(); });
  const rows = storefront().items.map(item => ({ id: item.variantId, productId: item.productId, sku: item.sku,
    product: { id: item.productId, merchantId: "merchant", name: item.name, type: "physical", metadata: {}, categoryId: null },
    price: { currency: "BRL", basePriceInCents: 10000, costInCents: 2000 }, stock: [{ quantity: 20, reserved: 0 }],
    media: [{ url: "https://synthetic.invalid/image" }], attributes: {} }));
  const prisma = { storefrontCart: { findUnique: async () => ({ ...storefront(), expiresAt: new Date("2100-01-01") }) },
    productVariant: { findMany: async (query: { where: { id?: { in: string[] }; sku?: { in: string[] } } }) => rows.filter(row =>
      query.where.id ? query.where.id.in.includes(row.id) : query.where.sku?.in.includes(row.sku)) } } as unknown as PrismaClient;
  const pricing = new CartPromoResolutionService(undefined, undefined, port);
  return { authority: new CheckoutCartAuthorityService(prisma, {} as ValidateCartForPaymentUseCase, pricing, port), reads: () => reads };
}
test("real checkout authority mapping preserves server intent through catalog/stock and reprojects current P+D", async () => {
  const f = checkoutAuthorityFixture(), result = await f.authority.resolveStorefront("merchant", "cart");
  assert.equal(f.reads(), 1); assert.equal(result.total, 190); assert.equal(result.currentDiscount, 10);
  assert.equal(result.items[1].price, 90); assert.equal(result.items[1].originalPrice, 100); assert.deepEqual(result.items[1].crossSellIntent, intent);
});
test("recovery preserves matching intent and current cart reference instead of silently repricing at base", async () => {
  const f = checkoutAuthorityFixture(), result = await f.authority.resolveRecoveredStorefront("merchant", checkout(), "cart");
  assert.equal(f.reads(), 2); assert.equal(result.total, 190); assert.deepEqual(result.items[1].crossSellIntent, intent);
});
test("recovery rejects changed accepted quantity/base before catalog fallback", async () => {
  const f = checkoutAuthorityFixture(), value = checkout(); value.items[1].quantity = 2;
  await assert.rejects(f.authority.resolveRecoveredStorefront("merchant", value, "cart"), /checkout_price_review_required/); assert.equal(f.reads(), 1);
});
test("public submitted cart cannot introduce accepted intent or cart_ref to gain a promotion", async () => {
  const f = checkoutAuthorityFixture(), result = await f.authority.resolve("merchant", checkout());
  assert.equal(f.reads(), 0); assert.equal(result.total, 200); assert.equal(result.cart_ref, undefined);
  assert.equal(result.items.some(item => item.crossSellIntent !== undefined), false);
});
test("checkout discards remembered cost and propagates current authoritative cost without exposing it to public quote", async () => {
  const port = reader(async () => projected()), value = checkout(); value.items[1].cost = 0;
  const result = await new CartPromoResolutionService(undefined, undefined, port).resolveCartPromos(value, "merchant");
  assert.equal(result.items[1].cost, 40); assert.equal(result.items[0].cost, 20); assert.equal(value.items[1].cost, 0);
});

function optionProjectionFixture() {
  const stored = storefront(), option = (itemId: string, priceModifierInCents: number) => ({ groupId: "extras", groupName: "Extras", itemId, itemName: itemId, priceModifierInCents });
  stored.items[0].selectedOptions = [option("size", 500)]; stored.items[0].unitPriceCents = 10500;
  stored.items.splice(1, 0, { ...stored.items[0], selectedOptions: [option("color", 1000)], unitPriceCents: 11000 });
  stored.items[2].selectedOptions = [option("target-size", 1500)]; stored.items[2].unitPriceCents = 11500;
  stored.items[2].crossSellIntent = { ...intent, originalUnitPriceCents: 11500, maximumUnitPriceCents: 10350, selectedOptionItemIds: ["target-size"] };
  stored.total = 33000;
  const expected = structuredClone(stored); expected.items[2].unitPriceCents = 10350; expected.items[2].pricingOriginalUnitPriceCents = 11500;
  expected.total = 31850; expected.discount = 500; expected.discountBudget = { version: 1, originalSubtotalCents: 33000, promotionDiscountCents: 1150 };
  const port = reader(async () => structuredClone(expected));
  const pricing = new CartPromoResolutionService(undefined, undefined, port);
  const rows = [stored.items[0], stored.items[2]].map(item => ({ id: item.variantId, productId: item.productId, sku: item.sku,
    product: { id: item.productId, merchantId: "merchant", name: item.name, type: "physical", categoryId: null, metadata: { optionGroups: [{
      id: "extras", name: "Extras", selectionType: "multiple", items: (item.variantId === "host" ? [option("size", 500), option("color", 1000)] : [option("target-size", 1500)])
        .map(option => ({ id: option.itemId, name: option.itemName, priceModifierInCents: option.priceModifierInCents })) }] } },
    price: { currency: "BRL", basePriceInCents: 10000, costInCents: null }, stock: [{ quantity: 20, reserved: 0 }], attributes: {}, media: [] }));
  const prisma = { storefrontCart: { findUnique: async () => ({ ...stored, expiresAt: new Date("2100-01-01") }) },
    productVariant: { findMany: async () => rows } } as unknown as PrismaClient;
  const authority = new CheckoutCartAuthorityService(prisma, {} as ValidateCartForPaymentUseCase, pricing, port);
  return { authority, pricing, stored, expected };
}
test("tool and HTTP GET/PATCH display badges belong to the exact option line, not the last matching variant", async () => {
  const f = optionProjectionFixture();
  f.expected.items[0].pricingOriginalUnitPriceCents = 10500; f.expected.items[0].unitPriceCents = 9450;
  f.expected.items[1].pricingOriginalUnitPriceCents = 11000; f.expected.items[1].unitPriceCents = 9900;
  f.expected.total = 29700; f.expected.discountBudget!.promotionDiscountCents = 3300;
  const deps = deniedLegacyDependencies(reader(async () => structuredClone(f.expected)));
  const cartRepo = { getOrCreate: async () => f.stored, updateItemQuantity: async () => f.stored };
  const handlers = createCartHandlers({ ...deps, cartRepo } as unknown as CartHandlerDeps, { merchantId: "merchant", sessionId: "cart" });
  const tool = await handlers.getCart({ cartId: "cart" }) as { items: Array<{ originalPrice: number; unitPrice: number }> };
  assert.deepEqual(tool.items.map(item => [item.originalPrice, item.unitPrice]), [[105, 94.5], [110, 99], [115, 103.5]]);
  const capabilities = new RealtimeCapabilityService("synthetic-option-badge-secret-at-least32-characters"), origin = "https://store.example";
  const token = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant", resourceId: "cart", origin });
  const request = { headers: { authorization: `Bearer ${token.token}`, origin } };
  const controller = Object.assign(Object.create(StorefrontController.prototype), { capabilities, cartRepo,
    priceCart: () => reevaluateCartRules(deps, "merchant", "cart", f.stored) }) as StorefrontController;
  for (const result of [await controller.getCart("cart", "merchant", request),
    await controller.updateCartItem("cart", "host", "merchant", { quantity: 1, optionItemIds: ["color"] }, request)]) {
    assert.deepEqual(result.items.map(item => [item.originalPrice, item.price]), [[105, 94.5], [110, 99], [115, 103.5]]);
  }
});
test("cross-sell checkout and recovery preserve distinct same-variant option lines and the full selected target base", async () => {
  const f = optionProjectionFixture(), initial = await f.authority.resolveStorefront("merchant", "cart");
  assert.deepEqual(initial.items.map(line => line.price), [105, 110, 103.5]);
  assert.equal(initial.total, 318.5); assert.equal(initial.currentDiscount, 5); assert.equal(initial.items[2].originalPrice, 115);
  const reversed = { ...initial, items: [...initial.items].reverse() };
  const recovered = await f.authority.resolveRecoveredStorefront("merchant", reversed, "cart");
  assert.equal(recovered.total, 318.5); assert.deepEqual(recovered.discountBudget, initial.discountBudget);
  assert.equal((await f.pricing.resolveCartPromos(initial, "merchant")).total, 318.5);
});
for (const changed of ["duplicate-line", "same-price-foreign-options", "option-label", "option-modifier"] as const)
  test(`cross-sell recovery and pricing refuse option identity tampering (${changed})`, async () => {
    const f = optionProjectionFixture(), snapshot = await f.authority.resolveStorefront("merchant", "cart");
    if (changed === "duplicate-line") snapshot.items[1] = structuredClone(snapshot.items[0]);
    if (changed === "same-price-foreign-options") snapshot.items[2].variant = JSON.stringify(["target", ["foreign"]]);
    if (changed === "option-label") snapshot.items[2].selected_options![0].item_name = "Foreign";
    if (changed === "option-modifier") snapshot.items[2].selected_options![0].price_modifier = 0;
    await assert.rejects(f.pricing.resolveCartPromos(snapshot, "merchant"), /checkout_price_review_required/);
    await assert.rejects(f.authority.resolveRecoveredStorefront("merchant", snapshot, "cart"), /checkout_price_review_required/);
  });

