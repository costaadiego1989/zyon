import test from "node:test";
import assert from "node:assert/strict";
import { projectStorefrontSuggestedReadActions } from "./storefront-suggested-read-actions.js";
import { conversationBlockSchema, type ValidatedConversationBlock } from "../contracts/conversation-block.schemas.js";

const product = (id: string, name = "Mesmo nome") => ({ id, name, price: 1000, priceFormatted: "R$ 10,00", inStock: true });
const card = (id: string, name?: string) => ({ type: "product_card", data: product(id, name) });
const category = (id: string, name = "Mesmo nome") => ({ type: "category_carousel", data: { categories: [{ id, name, productCount: 1 }] } });
const validated = (...blocks: unknown[]) => blocks.map(block => conversationBlockSchema.parse(block));

test("projector preserves source order and duplicate names while deduplicating semantic identities", () => {
  const blocks = validated(category("category"), card("product"), { type: "product_carousel", data: { merchantId: "merchant", products: [product("product"), product("other")] } },
    { type: "cross_sell", data: { trigger: "Offer", products: [{ ...product("SKU_NOT_PRODUCT"), productId: "cross_product" }, { ...product("SKU_OTHER"), productId: "product" }] } });
  const result = projectStorefrontSuggestedReadActions(blocks, "merchant");
  assert.deepEqual(result, { version: 1, items: [
    { id: "read-action-1", label: "Ver produtos de Mesmo nome", action: { tool: "search_products", args: { query: "*", categoryId: "category" } } },
    { id: "read-action-2", label: "Ver detalhes de Mesmo nome", action: { tool: "get_product_details", args: { productId: "product" } } },
    { id: "read-action-3", label: "Detalhes Mesmo nome", action: { tool: "get_product_details", args: { productId: "other" } } },
    { id: "read-action-4", label: "Detalhes Mesmo nome", action: { tool: "get_product_details", args: { productId: "cross_product" } } },
  ] });
});

test("projector never converts SKU-only cross-sells, marketplace products, mixed carousels or foreign merchant metadata", () => {
  const blocks = validated({ type: "cross_sell", data: { trigger: "Offer", products: [product("SKU_ONLY")] } },
    { type: "product_card", data: { ...product("marketplace"), source: "marketplace", sellerMerchantId: "foreign" } },
    { type: "product_carousel", data: { merchantId: "merchant", products: [product("local"), { ...product("foreign"), source: "marketplace" }] } },
    { type: "product_carousel", data: { merchantId: "foreign", products: [product("foreign_metadata")] } });
  assert.equal(projectStorefrontSuggestedReadActions(blocks, "merchant"), undefined);
});

test("projector rejects explicit foreign seller hints even when source claims local or is omitted", () => {
  const blocks = validated({ type: "product_card", data: { ...product("claims_local"), source: "local", sellerMerchantId: "foreign" } },
    { type: "product_card", data: { ...product("no_source"), sellerMerchantId: "foreign" } },
    { type: "product_carousel", data: { merchantId: "merchant", products: [product("local"), { ...product("foreign_seller"), sellerMerchantId: "foreign" }] } });
  assert.equal(projectStorefrontSuggestedReadActions(blocks, "merchant"), undefined);
});

test("projector retains same-merchant detail reads even for sold-out products without granting purchase authority", () => {
  const blocks = validated({ type: "product_card", data: { ...product("owned"), source: "local", sellerMerchantId: "merchant", inStock: false } });
  assert.deepEqual(projectStorefrontSuggestedReadActions(blocks, "merchant")?.items[0].action,
    { tool: "get_product_details", args: { productId: "owned" } });
});

test("projector ignores legacy text, quick replies, coupons and checkout instead of parsing commands", () => {
  const blocks = validated({ type: "quick_replies", data: { options: ["Detalhes product", "Ver produtos de category", "Aplicar cupom TESTE"] } },
    { type: "coupon_list", data: { coupons: [{ code: "TESTE", description: "Detalhes product", expiresAt: null }] } },
    { type: "checkout_redirect", data: { url: "/checkout", sessionId: "session" } });
  assert.equal(projectStorefrontSuggestedReadActions(blocks, "merchant"), undefined);
});

test("projector skips invalid IDs and blank/oversized labels without trimming, coercing or repairing", () => {
  const blocks = validated(card(" "), card("blank", " "), card("long", "x".repeat(500)), category("longcategory", "x".repeat(500)), card("valid", "Nome original"));
  assert.deepEqual(projectStorefrontSuggestedReadActions(blocks, "merchant")?.items, [
    { id: "read-action-1", label: "Ver detalhes de Nome original", action: { tool: "get_product_details", args: { productId: "valid" } } },
  ]);
});

test("projector respects the complete label bound and preserves raw names and identifier values", () => {
  const prefix = "Ver produtos de ";
  const name = "x".repeat(500 - prefix.length);
  const blocks = validated(category(" raw_category ", name), card("raw_product", " Nome sem normalização "));
  const result = projectStorefrontSuggestedReadActions(blocks, "merchant")!;
  assert.equal(result.items[0].label.length, 500);
  assert.deepEqual(result.items[0].action.args, { query: "*", categoryId: " raw_category " });
  assert.equal(result.items[1].label, "Ver detalhes de  Nome sem normalização ");
});

test("projector caps unique suggestions at twelve, allocates unique bounded IDs and is deterministic", () => {
  const blocks = validated(...Array.from({ length: 20 }, (_, index) => card(`product-${index}`)));
  const result = projectStorefrontSuggestedReadActions(blocks, "merchant");
  assert.equal(result?.items.length, 12);
  assert.equal(new Set(result?.items.map(item => item.id)).size, 12);
  assert.deepEqual(result, projectStorefrontSuggestedReadActions(blocks, "merchant"));
  assert.equal(result?.items[11].id, "read-action-12");
});

test("projector does not mutate source blocks or share mutable action objects across responses", () => {
  const blocks = validated(category("category"), card("product"));
  const before = structuredClone(blocks);
  const first = projectStorefrontSuggestedReadActions(blocks, "merchant")!;
  const second = projectStorefrontSuggestedReadActions(blocks, "merchant")!;
  first.items[0].label = "Changed presentation";
  if (first.items[0].action.tool === "search_products") first.items[0].action.args.categoryId = "changed";
  assert.deepEqual(blocks, before);
  assert.equal(second.items[0].label, "Ver produtos de Mesmo nome");
  assert.deepEqual(second.items[0].action.args, { query: "*", categoryId: "category" });
  assert.equal(projectStorefrontSuggestedReadActions([] as ValidatedConversationBlock[], "merchant"), undefined);
});

