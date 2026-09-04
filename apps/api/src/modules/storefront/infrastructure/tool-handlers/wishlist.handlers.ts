import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";

export interface WishlistHandlerDeps {}

export function createWishlistHandlers(_deps: WishlistHandlerDeps, _ctx: ToolRequestContext): Pick<StoreToolHandlers, "addToWishlist" | "getWishlist" | "removeFromWishlist"> {
  return {
    addToWishlist: async (args: any) => {
      return { added: true, productId: args.productId, message: "Produto adicionado à lista de desejos!" };
    },

    getWishlist: async () => {
      return { items: [], message: "Sua lista de desejos está vazia. Explore nossos produtos!" };
    },

    removeFromWishlist: async (args: any) => {
      return { removed: true, productId: args.productId, message: "Produto removido da lista de desejos." };
    }
  };
}
