import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontController } from "./storefront.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { createCartHandlers } from "../../infrastructure/tool-handlers/cart.handlers.js";

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
  const cart = { sessionId: "owned", items: [], total: 0, discount: 0 };
  const record = async (_merchant: string, ref: string) => { refs.push(ref); return cart; };
  const handlers = createCartHandlers({
    cartRepo: { getOrCreate: record, removeItem: record, updateItemQuantity: record, clear: record, removeCoupon: record },
    prisma: { checkoutSetting: { findUnique: async () => null } },
  } as never, { merchantId: "merchant", sessionId: "owned" } as never);
  await handlers.getCart({ cartId: "victim" });
  await handlers.removeCartItem({ cartId: "victim", variantId: "variant" });
  await handlers.updateCartItem({ cartId: "victim", variantId: "variant", quantity: 1 });
  await handlers.clearCart({ cartId: "victim" });
  await handlers.applyCoupon({ cartId: "victim", couponCode: "TEST" } as never);
  await handlers.removeCoupon({ cartId: "victim" });
  assert.deepEqual(refs, Array(6).fill("owned"));
});
