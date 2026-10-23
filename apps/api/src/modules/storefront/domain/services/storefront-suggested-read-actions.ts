import type { StorefrontReadUiAction, StorefrontSuggestedReadAction, StorefrontSuggestedReadActions } from "@zyon/shared-types";
import type { ValidatedConversationBlock } from "../contracts/conversation-block.schemas.js";
import { storefrontSuggestedReadActionSchema, storefrontSuggestedReadActionsSchema } from "../contracts/storefront-suggested-read-actions.schemas.js";

/** Pure projection of already validated, server-scoped display blocks. Never
 * reads model suggestions, resolves names, repairs IDs, authorizes or executes. */
export function projectStorefrontSuggestedReadActions(
  blocks: readonly ValidatedConversationBlock[], merchantId: string,
): StorefrontSuggestedReadActions | undefined {
  const items: StorefrontSuggestedReadAction[] = [];
  const seen = new Set<string>();
  const add = (name: string, prefix: string, action: StorefrontReadUiAction) => {
    if (items.length >= 12 || !name.trim()) return;
    const candidate = storefrontSuggestedReadActionSchema.safeParse({
      id: `read-action-${items.length + 1}`, label: `${prefix}${name}`, action,
    });
    if (!candidate.success) return;
    const parsed = candidate.data.action;
    const identity = JSON.stringify([parsed.tool, parsed.tool === "search_products" ? parsed.args.categoryId : parsed.args.productId]);
    if (seen.has(identity)) return;
    seen.add(identity);
    items.push(candidate.data);
  };
  const local = (product: { source?: string; sellerMerchantId?: string }) => product.source !== "marketplace"
    && (product.sellerMerchantId === undefined || product.sellerMerchantId === merchantId);
  for (const block of blocks) {
    if (items.length >= 12) break;
    switch (block.type) {
      case "category_carousel":
        for (const category of block.data.categories) add(category.name, "Ver produtos de ", {
          tool: "search_products", args: { query: "*", categoryId: category.id },
        });
        break;
      case "product_card":
        if (local(block.data)) add(block.data.name, "Ver detalhes de ", { tool: "get_product_details", args: { productId: block.data.id } });
        break;
      case "product_carousel":
        if ((block.data.merchantId !== undefined && block.data.merchantId !== merchantId) || block.data.products.some(product => !local(product))) break;
        for (const product of block.data.products) add(product.name, "Detalhes ", { tool: "get_product_details", args: { productId: product.id } });
        break;
      case "cross_sell":
        for (const product of block.data.products) if (product.productId !== undefined) add(product.name, "Detalhes ", {
          tool: "get_product_details", args: { productId: product.productId },
        });
        break;
    }
  }
  return items.length ? storefrontSuggestedReadActionsSchema.parse({ version: 1, items }) : undefined;
}

