import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationBlocks } from "./conversation-block.builder.js";

test("cart summary preserves the public product image after an item is added", () => {
  const { blocks } = buildConversationBlocks({
    merchantId: "merchant_1",
    userMessage: "Adicionar ao carrinho",
    finalContent: "Produto adicionado.",
    toolResults: {
      add_item_to_cart: {
        cartId: "cart_1",
        itemCount: 1,
        total: 129.9,
        discount: 0,
        items: [{
          variantId: "variant_1",
          name: "Sérum",
          quantity: 1,
          unitPrice: 129.9,
          imageUrl: "https://cdn.example.test/serum.jpg",
        }],
      },
    },
  });

  const cart = blocks.find((block) => block.type === "cart_summary");
  assert.ok(cart && cart.type === "cart_summary");
  assert.equal(cart.data.items[0]?.imageUrl, "https://cdn.example.test/serum.jpg");
});
