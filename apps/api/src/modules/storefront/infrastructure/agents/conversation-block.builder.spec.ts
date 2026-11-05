import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import { conversationBlockSchema } from "../../domain/contracts/conversation-block.schemas.js";

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

test("comparison blocks accept unrated products, retain source summaries and use cents consistently", () => {
  const result = buildConversationBlocks({ merchantId: "merchant_1", userMessage: "compare ambos", finalContent: "Confira a comparação.",
    toolResults: { compare_products: { comparison: [
      { id: "p1", name: "Primeiro", description: "Descrição publicada. ".repeat(40), price: 9990, stock: 2, rating: null, attributes: {} },
      { id: "p2", name: "Segundo", description: "Outro produto", price: 7990, stock: 0, rating: null, attributes: {} },
    ], requiresProductNames: false } } });
  const block = result.blocks.find(b => b.type === "product_comparison");
  assert.ok(block && block.type === "product_comparison");
  assert.equal(conversationBlockSchema.safeParse(block).success, true);
  assert(Array.from(block.data.products[0]!.description!).length <= 200);
  assert.equal(block.data.products[0]!.rating, undefined);
  assert.match(block.data.products[0]!.priceFormatted, /99,90/);
  assert.equal(block.data.products[1]!.inStock, false);
});
