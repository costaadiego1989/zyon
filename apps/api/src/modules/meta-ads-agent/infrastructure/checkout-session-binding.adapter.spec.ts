import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckoutSession } from "@zyon/shared-types";
import { CheckoutSessionBindingAdapter } from "./checkout-session-binding.adapter.js";
test("checkout binding accepts only the same tenant and server-authored storefront cart reference", async () => {
  for (const value of [undefined, { merchantId: "store-b", sessionId: "checkout-a", cart: { source: "storefront", cart_ref: "conversation-a" } }, { merchantId: "store-a", sessionId: "checkout-b", cart: { source: "storefront", cart_ref: "conversation-a" } }, { merchantId: "store-a", sessionId: "checkout-a", cart: { source: "checkout", cart_ref: "conversation-a" } }]) {
    const adapter = new CheckoutSessionBindingAdapter({ getSession: async () => value as CheckoutSession | undefined }); assert.equal(await adapter.parent("store-a", "checkout-a"), null);
  }
  const adapter = new CheckoutSessionBindingAdapter({ getSession: async () => ({ merchantId: "store-a", sessionId: "checkout-a", cart: { source: "storefront", cart_ref: "conversation-a" } }) as unknown as CheckoutSession }); assert.equal(await adapter.parent("store-a", "checkout-a"), "conversation-a");
});
