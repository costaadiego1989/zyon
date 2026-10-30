import test from "node:test";
import assert from "node:assert/strict";
import { createProductHandlers } from "./product.handlers.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { buildConversationBlocks } from "../agents/conversation-block.builder.js";

const variant = { id: "variant", sku: "sku", basePriceInCents: 10000, isActive: true, stockQuantity: 5, stockReserved: 0, attributes: { cor: "preto" }, media: [] };
const product = { id: "product", merchantId: "merchant", name: "Kit", description: "Descrição publicada", type: "physical", isActive: true,
  variants: [variant], defaultVariant: variant, metadata: {}, hasStock: true, totalStock: 5, averageRating: null, reviewCount: 0 };

function fixture(change: Record<string, unknown> = {}, missingPrice = false, entity = product) {
  let writes = 0;
  const handlers = createProductHandlers({ productRepo: { findById: async (merchant: string, id: string) => {
    assert.equal(merchant, "merchant"); assert.equal(id, "product"); return entity;
  } }, merchantRepo: { getExistingRules: async () => ({ maxDiscountPercent: 10, minimumMarginPercent: 0, allowFreeShipping: false }) },
  prisma: { checkoutSetting: { findUnique: async () => null }, productPromotion: { findMany: async (args: any) => {
    assert.equal(args.where.merchantId, "merchant"); return [{ id: "promotion", merchantId: "merchant", productId: "product", isActive: true,
      discountType: "percent", discountValue: 10, startsAt: new Date(0), endsAt: new Date("2099-01-01"), ...change }];
  } }, productPrice: { findMany: async (args: any) => {
    assert.equal(args.where.variant.product.merchantId, "merchant");
    const selected = entity.variants.find(variant => variant.id === args.where.variantId.in[0])!;
    return missingPrice ? [] : [{ variantId: selected.id, basePriceInCents: selected.basePriceInCents,
      costInCents: 100, variant: { productId: "product", product: { categoryId: "category", metadata: {} } } }];
  } } }, cartRepo: new Proxy({}, { get: () => () => { writes++; assert.fail("detail pricing must not create or change a cart"); } }),
  } as never, { merchantId: "merchant", sessionId: "conversation" });
  return { handlers, writes: () => writes };
}

test("a separate detail read revalidates the canonical offer before native single-product hydration", async () => {
  const f = fixture(), before = structuredClone(product);
  const details = storefrontToolOutputSchemas.get_product_details.parse(await f.handlers.getProductDetails({ productId: "product" }));
  assert.equal(details.product.variants![0]!.basePriceInCents, 10000);
  assert.equal(details.product.variants![0]!.price, 9000);
  const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Detalhes do Kit", finalContent: "Oferta vigente: R$90.",
    toolResults: { get_product_details: details } });
  const card = result.blocks.find(block => block.type === "product_card") as any;
  assert.equal(card.data.price, 9000); assert.equal(card.data.variants[0].price, 9000);
  assert.equal(f.writes(), 0); assert.deepEqual(product, before);
});

for (const change of [{ isActive: false }, { endsAt: new Date(1) }, { merchantId: "foreign" }, { productId: "other" }])
  test(`ineligible promotion cannot price the detail as discounted: ${JSON.stringify(change)}`, async () => {
    const f = fixture(change);
    const details = storefrontToolOutputSchemas.get_product_details.parse(await f.handlers.getProductDetails({ productId: "product" }));
    assert.equal(details.product.variants![0]!.price ?? details.product.variants![0]!.basePriceInCents, 10000);
    assert.equal(f.writes(), 0);
  });

test("unknown price authority never grants the advertised discount", async () => {
  const f = fixture({}, true);
  const details = storefrontToolOutputSchemas.get_product_details.parse(await f.handlers.getProductDetails({ productId: "product" }));
  assert.equal(details.product.variants![0]!.price, undefined);
  assert.equal(details.product.variants![0]!.basePriceInCents, 10000);
  assert.equal(f.writes(), 0);
});

test("detail hydration keeps the cheaper canonically priced variant first", async () => {
  const cheap = { ...variant, id: "cheap", sku: "cheap", basePriceInCents: 5000 };
  const entity = { ...product, variants: [variant, cheap] };
  const f = fixture({}, false, entity);
  const details = storefrontToolOutputSchemas.get_product_details.parse(await f.handlers.getProductDetails({ productId: "product" }));
  assert.deepEqual(details.product.variants!.map(variant => [variant.id, variant.price]), [["cheap", 4500], ["variant", 9000]]);
  const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "Detalhes", finalContent: "", toolResults: { get_product_details: details } });
  const card = result.blocks.find(block => block.type === "product_card") as any;
  assert.equal(card.data.price, 4500); assert.equal(card.data.variants[0].id, "cheap");
  assert.equal(f.writes(), 0);
});
