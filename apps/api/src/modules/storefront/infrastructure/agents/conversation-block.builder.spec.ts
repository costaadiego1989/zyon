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

const localProduct = {
  id: "local_shirt", name: "Camiseta da loja", description: "Algodão",
  price: 12990, image: "https://cdn.example.test/local-front.jpg",
  images: ["https://cdn.example.test/local-front.jpg", "https://cdn.example.test/local-back.jpg"],
  inStock: true, rating: 4.8, reviewCount: 12,
  ruleNotices: [{ ruleId: "host-rule", message: "Frete grátis acima de R$ 200" }],
  variants: [{ id: "local_blue", sku: "LOCAL-BLUE", attributes: { color: "Azul" }, basePriceInCents: 12990 }],
  optionGroups: [{ id: "embroidery", name: "Bordado", required: false, selectionType: "single",
    items: [{ id: "initials", name: "Iniciais", priceModifierInCents: 1000 }] }],
};
test("zero reviews never render an invented rating, and real ratings remain available", () => {
  for (const [reviewCount, rating, expected] of [[0, 4.3, undefined], [0, undefined, undefined], [2, 4.7, 4.7], [2, 6, undefined], [2, NaN, undefined]]) {
    const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Detalhes", finalContent: "",
      toolResults: { get_product_details: { product: { ...localProduct, type: "physical", reviewCount, rating } } } });
    const card = result.blocks.find(block => block.type === "product_card");
    assert.equal(card?.data.rating, expected);
  }
});
test("digital detail grounds its narrative in server availability and keeps its product type", () => {
  for (const inStock of [true, false]) {
    const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Detalhes", finalContent: "Tem estoque zero mas podemos comprar.",
      toolResults: { get_product_details: { product: { ...localProduct, type: "digital", stock: 0, inStock } } } });
    assert.equal(result.blocks.find(block => block.type === "product_card")?.data.productType, "digital");
    assert.ok(!result.finalContent.includes("estoque zero"));
    assert.match(result.finalContent, inStock ? /está disponível/ : /está indisponível/);
  }
});
test("variant presentation preserves each SKU and excludes reservations from its quantity", () => {
  const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Detalhes", finalContent: "",
    toolResults: { get_product_details: { product: { ...localProduct, type: "physical", variants: [
      { id: "red", sku: "RED", attributes: { color: "Vermelho" }, stockQuantity: 4, stockReserved: 1, basePriceInCents: 1895 },
      { id: "blue", sku: "BLUE", attributes: { color: "Azul" }, stockQuantity: 1, stockReserved: 0, basePriceInCents: 2567 },
    ] } } } });
  const card = result.blocks.find(block => block.type === "product_card");
  assert.deepEqual(card?.data.variants?.map(variant => [variant.sku, variant.stock, variant.price]), [["RED", 3, 1895], ["BLUE", 1, 2567]]);
});
test("a direct add projects only the saved variant and its composition; generic snapshots do not confirm", () => {
  const cart = { cartId: "cart", items: [{ variantId: "food", name: "Food", quantity: 1, unitPrice: 13.52 }], total: 13.52, itemCount: 1 };
  for (const [addedItem, expected] of [[undefined, false], [{ variantId: "other" }, false], [{ variantId: "food", optionItemIds: ["extra"] }, true]] as const) {
    const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Adicionar ao carrinho", finalContent: "Adicionado",
      toolResults: { add_item_to_cart: { ...cart, addedItem } } });
    assert.equal(result.blocks.some(block => block.type === "cart_add_result"), expected);
    if (expected) assert.deepEqual(result.blocks.find(block => block.type === "cart_add_result")?.data.optionItemIds, ["extra"]);
  }
});
