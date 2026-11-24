import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import { executeStorefrontUiAction } from "./storefront-ui-action.executor.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { storefrontConversationOutputSchema, outputMatchesStorefrontScope, STOREFRONT_CONTRACT_FALLBACK } from "../../domain/contracts/storefront-conversation.schemas.js";
import { buyerHubRoute } from "../../../whatsapp-channel/domain/ui/buyer-hub.js";
import { buildMetaUiView, presentMetaUi } from "../../../whatsapp-channel/domain/ui/meta-ui-renderer.js";

// Product.description is nullable in persistence and in the tool contract.
// A missing optional description must not erase the authorized product at the
// stricter display boundary, including the first /produtos turn.
for (const description of [null, undefined, "Descrição publicada pela loja."] as const) {
  for (const path of ["catalog-shortcut", "search-detail", "product-details"] as const) {
    test(`${path} keeps a product selectable in the final packet with ${String(description)}`, async () => {
      const product = { id: "product-current", name: "Produto físico local", description, type: "physical", price: 5000,
        inStock: true, stock: 10, source: "local", variants: [{ id: "variant-current", sku: "CURRENT-SKU",
          attributes: {}, basePriceInCents: 5000, stockQuantity: 10, stockReserved: 0 }] };
      const before = structuredClone(product);
      const reads: string[] = [];
      const handlers = {
        searchProducts: async (args: any) => { reads.push("search"); assert.equal(args.query, "*"); return { products: [product], nextCursor: null }; },
        getProductDetails: async (args: any) => { reads.push("details"); assert.equal(args.productId, product.id); return { product }; },
      };
      let result;
      if (path === "search-detail") {
        const tool = validateStorefrontToolOutput("search_products", await handlers.searchProducts({ query: "*" }), { cartId: "cart-current" });
        assert.ok(tool.ok);
        const built = buildConversationBlocks({ merchantId: "merchant-current", userMessage: "Ver detalhes", finalContent: "Confira.",
          toolResults: { search_products: tool.data } });
        result = { message: built.finalContent, blocks: built.blocks };
      } else {
        const route = buyerHubRoute("/produtos");
        assert.ok(route?.action?.kind === "tool");
        assert.deepEqual(route.action, { kind: "tool", tool: "search_products", args: { query: "*" } });
        const action = path === "catalog-shortcut" ? { tool: route.action.tool, args: route.action.args }
          : { tool: "get_product_details", args: { productId: product.id } };
        result = await executeStorefrontUiAction(handlers as never, action, "merchant-current", "cart-current");
      }
      const parsed = storefrontConversationOutputSchema.safeParse({ ...result, cartId: "cart-current", suggestedNext: [] });
      assert.ok(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues));
      const packet = parsed.data;
      assert.equal(outputMatchesStorefrontScope(packet, { merchantId: "merchant-current", cartId: "cart-current" }), true);
      assert.notEqual(packet.message, STOREFRONT_CONTRACT_FALLBACK);
      assert.equal(packet.blocks.length, 1);
      const block = packet.blocks[0]!;
      assert.equal(block.type, path === "catalog-shortcut" ? "product_carousel" : "product_card");
      const data: any = block.type === "product_carousel" ? block.data.products[0] : block.data;
      assert.equal(data.id, product.id); assert.equal(data.name, product.name);
      assert.equal(data.price, 5000); assert.equal(data.inStock, true);
      assert.equal(data.variants[0].id, "variant-current"); assert.equal(data.variants[0].stock, 10);
      assert.equal(data.variants[0].price, 5000); assert.equal(data.description, description ?? undefined);
      if (block.type === "product_carousel") {
        assert.equal(block.data.merchantId, "merchant-current"); assert.equal(data.source, "local");
      }
      const presentation = presentMetaUi(buildMetaUiView({ agentMessage: packet.message, blocks: packet.blocks,
        merchantName: "Loja", quickReplies: [], state: { version: 1, conversationId: "conversation-current", stage: "store",
          history: [], revision: "first-turn", page: 0, previousViews: [] } }), "current-description");
      const expected = path === "catalog-shortcut" ? { kind: "tool", tool: "get_product_details", args: { productId: product.id } }
        : { kind: "tool", tool: "add_item_to_cart", args: { variantId: "variant-current", quantity: 1,
          selectedOptionItemIds: [], selectedServiceSlotId: undefined } };
      const controls = presentation.messages.flatMap(message => {
        if (message.type !== "interactive") return [];
        const action = message.interactive.action as any;
        return [...(action?.buttons ?? []).map((button: any) => button.reply?.id),
          ...(action?.sections ?? []).flatMap((section: any) => (section.rows ?? []).map((row: any) => row.id))];
      });
      const selection = Object.entries(presentation.selections).find(([id, action]) => controls.includes(id)
        && action.kind === "tool" && action.tool === expected.tool && (path === "catalog-shortcut"
          ? action.args.productId === product.id : action.args.variantId === "variant-current"));
      assert.ok(selection, "the actual Meta presentation must expose a current product control");
      assert.deepEqual(selection[1], expected);
      assert.deepEqual(product, before);
      assert.deepEqual(reads, [path === "product-details" ? "details" : "search"]);
    });
  }
}

test("a malformed present description still fails the unchanged final display contract", () => {
  const built = buildConversationBlocks({ merchantId: "merchant-current", userMessage: "/produtos", finalContent: "Confira.",
    toolResults: { search_products: { products: [{ id: "product-current", name: "Produto", description: 42, price: 5000, inStock: true }] } } });
  assert.equal(storefrontConversationOutputSchema.safeParse({ message: built.finalContent, blocks: built.blocks }).success, false);
});
