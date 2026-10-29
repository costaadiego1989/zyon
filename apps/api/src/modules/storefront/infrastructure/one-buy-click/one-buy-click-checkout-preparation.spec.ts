import assert from "node:assert/strict";
import test from "node:test";
import { appendOneBuyClickCheckout } from "./one-buy-click-checkout-preparation.js";

const cartBlock = {
  type: "cart_summary",
  data: {
    items: [{ variantId: "serum-50", productName: "Sérum", quantity: 1, price: 18990, subtotal: 18990 }],
    itemCount: 1,
    subtotal: 18990,
    total: 18990,
  },
} as const;

test("OneBuyClick prepares checkout after a successful cart addition", async () => {
  let calls = 0;
  const blocks = await appendOneBuyClickCheckout({
    blocks: [cartBlock] as any,
    toolsUsed: ["add_item_to_cart"],
    oneBuyClickEnabled: true,
    cartId: "conversation-1",
    createCheckoutSession: async () => {
      calls += 1;
      return {
        checkoutPrepared: true,
        actionId: "action-1",
        cartId: "conversation-1",
        shippingPreference: "fastest",
        paymentPreference: "pix",
      };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(blocks.at(-1), {
    type: "checkout_prepared",
    data: {
      actionId: "action-1",
      cartId: "conversation-1",
      shippingPreference: "fastest",
      paymentPreference: "pix",
    },
  });
});

test("OneBuyClick does not prepare checkout twice or after a failed addition", async () => {
  let calls = 0;
  const prepare = async () => {
    calls += 1;
    return { checkoutPrepared: true };
  };
  const alreadyPrepared = await appendOneBuyClickCheckout({
    blocks: [cartBlock, { type: "checkout_prepared", data: { actionId: "action", cartId: "conversation-1", shippingPreference: "fastest", paymentPreference: "pix" } }] as any,
    toolsUsed: ["add_item_to_cart", "create_checkout_session"],
    oneBuyClickEnabled: true,
    cartId: "conversation-1",
    createCheckoutSession: prepare,
  });
  const failedAddition = await appendOneBuyClickCheckout({
    blocks: [],
    toolsUsed: ["add_item_to_cart"],
    oneBuyClickEnabled: true,
    cartId: "conversation-1",
    createCheckoutSession: prepare,
  });

  assert.equal(calls, 0);
  assert.equal(alreadyPrepared.length, 2);
  assert.equal(failedAddition.length, 0);
});
