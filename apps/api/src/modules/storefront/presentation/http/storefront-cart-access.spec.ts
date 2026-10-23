import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontController } from "./storefront.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { createCartHandlers } from "../../infrastructure/tool-handlers/cart.handlers.js";
import type { StorefrontCart, StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";

test("renewal preserves cart and merchant ownership and rejects other resources", () => {
  const capabilities = new RealtimeCapabilityService("storefront-cart-test-secret-32-characters");
  const controller = Object.assign(Object.create(StorefrontController.prototype), { capabilities }) as StorefrontController;
  const issued = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant", resourceId: "cart_a", origin: "https://store.example" }, Math.floor(Date.now() / 1000) - 4000);
  const request = { headers: { authorization: `Bearer ${issued.token}`, origin: "https://store.example" } };
  const renewed = controller.renewConversationAccess("cart_a", request);
  assert.equal(renewed.conversation_id, "cart_a");
  assert.equal(capabilities.verify(renewed.conversation_token, "storefront-conversation", request.headers.origin).merchantId, "merchant");
  assert.throws(() => controller.renewConversationAccess("cart_b", request), /invalid_conversation_token/);
  assert.throws(() => controller.renewConversationAccess("cart_a", { headers: {} }), /invalid_conversation_token/);
});

test("conversation capability binds an origin forwarded by the authenticated storefront proxy", async () => {
  const capabilities = new RealtimeCapabilityService("storefront-cart-test-secret-32-characters");
  const controller = Object.assign(Object.create(StorefrontController.prototype), {
    capabilities,
    startStoreConversation: {
      execute: async () => ({ conversation_id: "cart_a", merchant_id: "merchant", created_at: "2026-01-01T00:00:00.000Z" }),
    },
  }) as StorefrontController;

  const previous = process.env.INTERNAL_SERVICE_TOKEN;
  process.env.INTERNAL_SERVICE_TOKEN = "test-internal-service-token";
  try {
    const response = await controller.startConversation(
      { merchant_id: "merchant" },
      { headers: {
        origin: "https://gateway.example",
        "x-trusted-storefront-origin": "https://store.example",
        "x-internal-service-token": "test-internal-service-token",
      } },
    );

    assert.equal(
      capabilities.verify(response.conversation_token, "storefront-conversation", "https://store.example").resourceId,
      "cart_a",
    );
    assert.throws(
      () => capabilities.verify(response.conversation_token, "storefront-conversation", "https://gateway.example"),
      /realtime_origin_not_allowed/,
    );
    assert.equal(
      (controller as any).conversationAccess({ headers: {
        authorization: `Bearer ${response.conversation_token}`,
        origin: "https://gateway.example",
        "x-trusted-storefront-origin": "https://store.example",
        "x-internal-service-token": "test-internal-service-token",
      } }, "cart_a").merchantId,
      "merchant",
    );
    assert.throws(
      () => (controller as any).conversationAccess({ headers: {
        authorization: `Bearer ${response.conversation_token}`,
        origin: "https://gateway.example",
        "x-trusted-storefront-origin": "https://store.example",
      } }, "cart_a"),
      /invalid_conversation_token/,
    );

    const untrusted = await controller.startConversation(
      { merchant_id: "merchant" },
      { headers: { origin: "https://gateway.example", "x-trusted-storefront-origin": "https://store.example" } },
    );
    assert.equal(
      capabilities.verify(untrusted.conversation_token, "storefront-conversation", "https://gateway.example").resourceId,
      "cart_a",
    );
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = previous;
  }
});

test("cart read, update and clear require the cart owner's conversation capability", async () => {
  const capabilities = new RealtimeCapabilityService("storefront-cart-test-secret-32-characters");
  const calls: unknown[] = [];
  const cart = { sessionId: "cart_a", items: [], total: 0, discount: 0 };
  const controller = Object.assign(Object.create(StorefrontController.prototype), {
    capabilities,
    cartRepo: {
      getOrCreate: async (...args: unknown[]) => { calls.push(args); return cart; },
      updateItemQuantity: async (...args: unknown[]) => { calls.push(args); return cart; },
      clear: async (...args: unknown[]) => { calls.push(args); return cart; },
    },
  }) as StorefrontController;
  const access = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant", resourceId: "cart_a", origin: "https://store.example" });
  const request = { headers: { authorization: `Bearer ${access.token}`, origin: "https://store.example" } };
  await assert.rejects(controller.getCart("cart_a", "merchant", {}), /invalid_conversation_token/);
  await assert.rejects(controller.updateCartItem("cart_b", "variant", "merchant", { quantity: 1 }, request), /conversation_access_denied/);
  await assert.rejects(controller.clearCart("cart_a", "other-merchant", request), /conversation_access_denied/);
  assert.equal(calls.length, 0);
  await controller.getCart("cart_a", "merchant", request);
  await controller.updateCartItem("cart_a", "variant", "merchant", { quantity: 2 }, request);
  await controller.clearCart("cart_a", "merchant", request);
  assert.equal(calls.length, 3);
});

test("conversation tools ignore model-supplied references to another cart", async () => {
  const refs: string[] = [];
  const cart: StorefrontCart = { id: "owned-row", merchantId: "merchant", sessionId: "owned", items: [], total: 0,
    discount: 0, couponCode: null, freeShipping: false, createdAt: new Date("2026-10-20Z"), updatedAt: new Date("2026-10-20Z") };
  const record = async (merchantId: string, ref: string) => {
    assert.equal(merchantId, "merchant"); assert.equal(ref, "owned"); refs.push(ref); return structuredClone(cart);
  };
  let pricingReads = 0, ruleWrites = 0;
  const cartRepo = { getOrCreate: record, removeItem: record, clear: record, removeCoupon: record,
    updateItemQuantity: async () => { assert.fail("an empty owned cart must not update a nonexistent model-selected line"); },
    applyRuleOutcome: async (merchantId, ref, outcome, expectedCart) => {
      ruleWrites++; assert.equal(merchantId, "merchant"); assert.equal(ref, "owned");
      assert.deepEqual(outcome, { discountCents: 0, freeShipping: false }); assert.deepEqual(expectedCart, cart);
      return structuredClone(cart);
    },
  } satisfies Pick<StorefrontCartPort, "getOrCreate"|"removeItem"|"updateItemQuantity"|"clear"|"removeCoupon"|"applyRuleOutcome">;
  const handlers = createCartHandlers({
    cartRepo,
    couponCart: { apply: async (scope: { merchantId: string; cartId: string }) => {
      assert.deepEqual(scope, { merchantId: "merchant", cartId: "owned" }); refs.push(scope.cartId);
      return { applied: false, reason: "cart_empty" };
    } },
    prisma: { checkoutSetting: { findUnique: async (query: { where: { merchantId: string } }) => {
      assert.deepEqual(query.where, { merchantId: "merchant" }); return null;
    } }, productPrice: { findMany: async (query: { where: { variantId: { in: string[] }; currency: string;
      variant: { isActive: boolean; product: { merchantId: string; isActive: boolean; deletedAt: null } } } }) => {
      pricingReads++; assert.deepEqual(query.where, { variantId: { in: [] }, currency: "BRL",
        variant: { isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null } } }); return [];
    } } },
  } as never, { merchantId: "merchant", sessionId: "owned" } as never);
  const assertOwnedCart = (result: unknown) => {
    assert.ok(result !== null && typeof result === "object" && !Array.isArray(result) && "cartId" in result);
    assert.equal(result.cartId, "owned");
  };
  assertOwnedCart(await handlers.getCart({ cartId: "victim" }));
  assertOwnedCart(await handlers.removeCartItem({ cartId: "victim", variantId: "variant" }));
  assert.deepEqual(await handlers.updateCartItem({ cartId: "victim", variantId: "variant", quantity: 1 }), { error: "cart_item_not_found" });
  assertOwnedCart(await handlers.clearCart({ cartId: "victim" }));
  assert.deepEqual(await handlers.applyCoupon({ cartId: "victim", couponCode: "TEST" } as never), { applied: false, reason: "cart_empty" });
  assertOwnedCart(await handlers.removeCoupon({ cartId: "victim" }));
  assert.deepEqual(refs, Array(6).fill("owned"));
  assert.equal(pricingReads, 2); assert.equal(ruleWrites, 0, "complete canonical reads must not exercise a missing-dependency fallback");
});
