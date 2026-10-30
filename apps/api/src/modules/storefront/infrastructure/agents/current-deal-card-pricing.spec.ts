import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import { conversationBlockSchema } from "../../domain/contracts/conversation-block.schemas.js";

const variant = { id: "variant", sku: "sku", basePriceInCents: 10000, stockQuantity: 5, stockReserved: 0, isActive: true, attributes: { cor: "preto" } };
const product = { id: "product", name: "Kit", description: "Descrição publicada", type: "physical", stock: 5, inStock: true, variants: [variant] };
const deal = { id: "product", variantId: "variant", name: "Kit", price: 9000, originalPrice: 10000, discountPercent: 10,
  inStock: true, images: [], expiresAt: "2099-01-01T00:00:00.000Z" };
const build = (deals: unknown) => buildConversationBlocks({ merchantId: "merchant", userMessage: "Quais produtos estão com desconto?",
  finalContent: "O Kit está em oferta por R$ 90,00.", toolResults: { get_product_details: { product }, get_daily_deals: deals } });

test("the detail card and its selected variant show the same independently confirmed current offer", () => {
  const before = structuredClone(product);
  const result = build({ deals: [deal] });
  const block = result.blocks.find(block => block.type === "product_card")!;
  const parsed = conversationBlockSchema.parse(block);
  assert.equal(parsed.type, "product_card");
  if (parsed.type !== "product_card") assert.fail("detail card required");
  assert.equal(parsed.data.price, 9000);
  assert.equal(parsed.data.variants![0]!.price, 9000);
  assert.equal(parsed.data.originalPrice, 10000);
  assert.equal(parsed.data.discountPercent, 10);
  assert.deepEqual(product, before, "projection cannot reprice the catalog or mutate the tool result");
});

for (const [name, change] of [
  ["expired", { expiresAt: "2000-01-01T00:00:00.000Z" }],
  ["another product", { id: "foreign-product" }],
  ["another variant", { variantId: "other-variant" }],
  ["changed original basis", { originalPrice: 12000 }],
  ["coupon condition", { coupon: true }],
  ["unavailable stock", { inStock: false }],
  ["missing expiry", { expiresAt: undefined }],
] as const) test(`${name} cannot overwrite the detail card price`, () => {
  const result = build({ deals: [{ ...deal, ...change }] });
  const block = result.blocks.find(block => block.type === "product_card") as any;
  assert.equal(block.data.price, 10000);
  assert.equal(block.data.variants[0].price, 10000);
  assert.equal(block.data.originalPrice, undefined);
});

test("ambiguous or invalid current-deal data cannot change the catalog basis", () => {
  for (const value of [{ deals: [deal, deal] }, { deals: [{ ...deal, price: -1 }] }, { error: "read_unconfirmed" }]) {
    const block = build(value).blocks.find(block => block.type === "product_card") as any;
    assert.equal(block.data.price, 10000);
    assert.equal(block.data.originalPrice, undefined);
  }
});
